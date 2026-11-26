[CmdletBinding()]
param(
    [string]$WeSyncDir = "$env:APPDATA\WESync",
    [string]$AntigravityDir = "$env:LOCALAPPDATA\Programs\antigravity",
    [switch]$Uninstall
)

$ErrorActionPreference = "Stop"

$repoDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$weServer = Join-Path $WeSyncDir "WESyncServer.js"
$weServerBak = Join-Path $WeSyncDir "WESyncServer.js.bak"
$weCdpTarget = Join-Path $WeSyncDir "cdp-injector.js"
$cdpSource = Join-Path $repoDir "cdp-injector.js"
$vbsLauncher = Join-Path $repoDir "Start-Antigravity-Glass.vbs"
$desktopShortcut = Join-Path ([Environment]::GetFolderPath("Desktop")) "Antigravity Dark Glass.lnk"

if (-not (Test-Path $weServer)) {
    throw "Khong tim thay WESyncServer.js tai: $weServer"
}

function Restart-WeSyncDaemon {
    $nodeProcs = Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue | Where-Object {
        $_.CommandLine -and $_.CommandLine -like "*WESyncServer.js*"
    }
    foreach ($p in $nodeProcs) {
        Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
    }
    Start-Sleep -Milliseconds 600
    $silentVbs = Join-Path $WeSyncDir "WESyncServer_Silent.vbs"
    if (Test-Path $silentVbs) {
        Start-Process -FilePath "wscript.exe" -ArgumentList "`"$silentVbs`"" -WorkingDirectory $WeSyncDir
    } else {
        Start-Process -FilePath "node.exe" -ArgumentList "`"$weServer`"" -WorkingDirectory $WeSyncDir -WindowStyle Hidden
    }
}

if ($Uninstall) {
    if (Test-Path $weServerBak) {
        Copy-Item $weServerBak $weServer -Force
        Write-Host "[1/3] Da khoi phuc WESyncServer.js tu ban backup." -ForegroundColor Green
    }
    if (Test-Path $weCdpTarget) { Remove-Item $weCdpTarget -Force }
    if (Test-Path $desktopShortcut) { Remove-Item $desktopShortcut -Force }
    Write-Host "[2/3] Dang khoi dong lai WESyncServer..." -ForegroundColor Cyan
    Restart-WeSyncDaemon
    Write-Host "[3/3] Da go bo Auto-Sync khoi WESyncServer." -ForegroundColor Green
    exit 0
}

if (-not (Test-Path $weServerBak)) {
    Copy-Item $weServer $weServerBak -Force
    Write-Host "[1/4] Da sao luu WESyncServer.js -> WESyncServer.js.bak" -ForegroundColor Green
}

Copy-Item $cdpSource $weCdpTarget -Force
$serverCode = Get-Content $weServerBak -Raw -Encoding UTF8

$repoDirJson = ($repoDir | ConvertTo-Json)
$agyDirJson = ($AntigravityDir | ConvertTo-Json)

$hookBlock = @"

/* AGY_DARK_GLASS_AUTO_SYNC_START */
(function initAntigravityDarkGlassAutoSync() {
    const REPO_DIR = $repoDirJson;
    const AGY_DIR = $agyDirJson;

    // Cach 2: CDP Auto-Injector (Zero-Patch, bat tu qua moi ban update)
    try {
        const { startAntigravityCdpWatcher } = require(path.join(__dirname, "cdp-injector.js"));
        startAntigravityCdpWatcher({
            themeDir: REPO_DIR,
            port: 9229,
            intervalMs: 2500
        });
        console.log("[AGY Auto-Sync] CDP Auto-Injector da bat (port 9229).");
    } catch (e) {
        console.warn("[AGY Auto-Sync] Khong the khoi dong CDP Auto-Injector:", e.message);
    }

    // Cach 1: Auto-Healer cho app.asar (tu dong patch lai sau khi Antigravity update va dong app)
    let agyHealing = false;
    function checkAndHealAntigravityTheme() {
        if (agyHealing) return;
        const asarPath = path.join(AGY_DIR, "resources", "app.asar");
        const applyPs1 = path.join(REPO_DIR, "apply-theme.ps1");
        if (!fs.existsSync(asarPath) || !fs.existsSync(applyPs1)) return;

        try {
            const buf = fs.readFileSync(asarPath);
            if (buf.includes(Buffer.from("AGY_WE_DARK_GLASS_PATCH_START", "utf8"))) {
                return;
            }
        } catch (_) {
            return;
        }

        // Chi patch khi Antigravity.exe khong dang chay de khong ngat phien lam viec
        try {
            const running = execSync('tasklist /fi "imagename eq Antigravity.exe"', {
                encoding: "utf-8",
                timeout: 4000,
                windowsHide: true
            });
            if (running && running.toLowerCase().includes("antigravity.exe")) {
                return;
            }
        } catch (_) {}

        agyHealing = true;
        console.log("[AGY Auto-Healer] Phat hien Antigravity vua cap nhat (mat patch). Dang tu dong ap dung lai theme...");
        const proc = spawn("powershell.exe", [
            "-NoProfile",
            "-ExecutionPolicy", "Bypass",
            "-File", applyPs1,
            "-AntigravityDir", AGY_DIR
        ], { windowsHide: true, stdio: "ignore" });

        proc.on("close", (code) => {
            agyHealing = false;
            console.log("[AGY Auto-Healer] Hoan tat re-patch theme (exit=" + code + ").");
        });
        proc.on("error", () => { agyHealing = false; });
    }

    setTimeout(checkAndHealAntigravityTheme, 8000);
    setInterval(checkAndHealAntigravityTheme, 60000);
})();
/* AGY_DARK_GLASS_AUTO_SYNC_END */
"@

Write-Host "[2/4] Dang tich hop Auto-Healer + CDP Auto-Injector vao WESyncServer.js..." -ForegroundColor Cyan
[System.IO.File]::WriteAllText($weServer, $serverCode + $hookBlock, (New-Object System.Text.UTF8Encoding($false)))

Write-Host "[3/4] Dang tao shortcut Desktop 'Antigravity Dark Glass'..." -ForegroundColor Cyan
$wsh = New-Object -ComObject WScript.Shell
$lnk = $wsh.CreateShortcut($desktopShortcut)
$lnk.TargetPath = "$env:SystemRoot\System32\wscript.exe"
$lnk.Arguments = "//B `"$vbsLauncher`""
$lnk.WorkingDirectory = $repoDir
$agyExe = Join-Path $AntigravityDir "Antigravity.exe"
if (Test-Path $agyExe) { $lnk.IconLocation = "$agyExe,0" }
$lnk.Description = "Mo Antigravity Desktop voi Dark Glass Anime + WESync (Auto-Heal + CDP)"
$lnk.Save()

Write-Host "[4/4] Dang khoi dong lai WESyncServer..." -ForegroundColor Cyan
Restart-WeSyncDaemon

Write-Host "`n[OK] Da cai dat xong chong mat nen khi update (Cach 1 + Cach 2)!" -ForegroundColor Green
Write-Host "     - WESyncServer.js: tu dong re-patch khi Antigravity dong + bom theme live qua CDP (port 9229)" -ForegroundColor Gray
Write-Host "     - Shortcut Desktop: $desktopShortcut" -ForegroundColor Gray
