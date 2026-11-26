[CmdletBinding()]
param(
    [string]$AntigravityDir = "$env:LOCALAPPDATA\Programs\antigravity",
    [switch]$ForceStopApp
)

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$cssSource = Join-Path $scriptDir "antigravity-custom.css"
$jsSource = Join-Path $scriptDir "antigravity-we-sync.js"

if (-not (Test-Path $cssSource)) { throw "Khong tim thay file CSS: $cssSource" }
if (-not (Test-Path $jsSource)) { throw "Khong tim thay file JS: $jsSource" }

$resourcesDir = Join-Path $AntigravityDir "resources"
$asarPath = Join-Path $resourcesDir "app.asar"
$bakDir = Join-Path $resourcesDir ".bak"
$themeDir = Join-Path $resourcesDir "theme"

if (-not (Test-Path $asarPath)) {
    throw "Khong tim thay app.asar tai: $asarPath"
}

# Kiem tra Antigravity Desktop dang chay hay khong
$running = Get-Process -ErrorAction SilentlyContinue | Where-Object {
    $_.Path -and ($_.Path -like "$AntigravityDir*")
}
if ($running) {
    if ($ForceStopApp) {
        Write-Host "[!] Dang dong Antigravity Desktop..." -ForegroundColor Yellow
        $running | Stop-Process -Force
        Start-Sleep -Milliseconds 900
    } else {
        throw "Antigravity Desktop dang chay (file app.asar co the bi khoa). Hay dong app hoac chay lai voi -ForceStopApp."
    }
}

# Tim Python (uu tien python tren PATH, fallback python di kem Antigravity)
$pythonExe = (Get-Command python -ErrorAction SilentlyContinue).Source
if (-not $pythonExe) {
    $embeddedPy = Get-ChildItem "$env:LOCALAPPDATA\antigravity\python" -Filter "python.exe" -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty FullName
    if ($embeddedPy) { $pythonExe = $embeddedPy }
}
if (-not $pythonExe) {
    throw "Khong tim thay python.exe de unpack/repack app.asar."
}

# 1. Tao backup .bak an toan (tu dong lam moi neu Antigravity vua update)
if (-not (Test-Path $bakDir)) {
    New-Item -ItemType Directory -Path $bakDir -Force | Out-Null
}

$bakAsar = Join-Path $bakDir "app.asar"
$verFile = Join-Path $AntigravityDir "version"
$bakVerFile = Join-Path $bakDir "version"

$inspectPy = @'
import sys, struct, json
asar_path = sys.argv[1]
with open(asar_path, "rb") as f:
    hdr = struct.unpack("<IIII", f.read(16))
    meta = json.loads(f.read(hdr[3]).decode("utf-8"))
    data_start = 8 + hdr[1]
node = meta
for part in ["dist", "utils.js"]:
    node = node["files"][part]
with open(asar_path, "rb") as f:
    f.seek(data_start + int(node["offset"]))
    content = f.read(node["size"]).decode("utf-8", errors="replace")
print("PATCHED" if "AGY_WE_DARK_GLASS_PATCH_START" in content else "CLEAN")
'@

function Invoke-PyScript {
    param(
        [string]$Code,
        [string[]]$PyArgs
    )
    $tmp = [System.IO.Path]::Combine([System.IO.Path]::GetTempPath(), "agy_patch_" + [guid]::NewGuid().ToString("N") + ".py")
    try {
        [System.IO.File]::WriteAllText($tmp, $Code, (New-Object System.Text.UTF8Encoding($false)))
        & $pythonExe $tmp @PyArgs
        if ($LASTEXITCODE -ne 0) {
            throw "Python helper exited with code $LASTEXITCODE."
        }
    } finally {
        if (Test-Path $tmp) { Remove-Item $tmp -Force -ErrorAction SilentlyContinue }
    }
}

$currentState = (Invoke-PyScript -Code $inspectPy -PyArgs @($asarPath) | Select-Object -Last 1).Trim()
$needRefreshBak = $false

if (-not (Test-Path $bakAsar)) {
    $needRefreshBak = $true
} elseif ($currentState -eq "CLEAN") {
    if ((Test-Path $verFile) -and (Test-Path $bakVerFile)) {
        if ((Get-Content $verFile -Raw).Trim() -ne (Get-Content $bakVerFile -Raw).Trim()) {
            $needRefreshBak = $true
        }
    }
    if ((Get-Item $asarPath).Length -ne (Get-Item $bakAsar).Length) {
        $needRefreshBak = $true
    }
}

if ($needRefreshBak) {
    Write-Host "[1/4] Dang sao luu cac file goc vao $bakDir ..." -ForegroundColor Cyan
    foreach ($name in @("app.asar", "app-update.yml", "default_app.asar")) {
        $src = Join-Path $resourcesDir $name
        if (Test-Path $src) { Copy-Item $src (Join-Path $bakDir $name) -Force }
    }
    if (Test-Path $verFile) { Copy-Item $verFile $bakVerFile -Force }
} else {
    Write-Host "[1/4] Da co ban backup goc hop le tai $bakDir" -ForegroundColor Green
}

# 2. Copy CSS & JS vao resources\theme
Write-Host "[2/4] Dang dong bo theme CSS/JS vao $themeDir ..." -ForegroundColor Cyan
if (-not (Test-Path $themeDir)) {
    New-Item -ItemType Directory -Path $themeDir -Force | Out-Null
}
Copy-Item $cssSource (Join-Path $themeDir "antigravity-custom.css") -Force
Copy-Item $jsSource (Join-Path $themeDir "antigravity-we-sync.js") -Force

# 3. Unpack clean tu .bak\app.asar, patch dist/utils.js (inject CSS/JS + dark curtain + CSP bypass), repack app.asar
Write-Host "[3/4] Dang patch app.asar (inject CSS/JS + dark curtain + CSP)..." -ForegroundColor Cyan

$patchPy = @'
import sys, os, struct, json, shutil

bak_asar = sys.argv[1]
out_asar = sys.argv[2]
theme_dir = sys.argv[3]

with open(bak_asar, "rb") as f:
    header = struct.unpack("<IIII", f.read(16))
    meta_size_field = header[1]
    json_len = header[3]
    meta = json.loads(f.read(json_len).decode("utf-8"))
    old_data_start = 8 + meta_size_field
    old_bytes = f.read()

files = []
def collect(node, prefix=""):
    for k, v in node.get("files", {}).items():
        p = f"{prefix}/{k}" if prefix else k
        if "files" in v:
            collect(v, p)
        else:
            files.append((p, v))

collect(meta)

payloads = {}
for p, info in files:
    if info.get("unpacked"):
        continue
    off = int(info["offset"])
    sz = int(info["size"])
    payloads[p] = old_bytes[off:off + sz]

utils_js = payloads["dist/utils.js"].decode("utf-8")

# Dam bao nen curtain / BrowserWindow mac dinh la #0B0D17 tranh chop trang khi khoi dong
utils_js = utils_js.replace("'#131313'", "'#0B0D17'").replace("isLight ? '#FAFAFA' : '#0B0D17'", "'#0B0D17'")

injection_hook = """
/* AGY_WE_DARK_GLASS_PATCH_START */
function attachDarkGlassTheme(hubContents) {
    if (!hubContents || hubContents.isDestroyed?.() || hubContents.__agyDarkGlassAttached) {
        return;
    }
    hubContents.__agyDarkGlassAttached = true;
    const themeRoot = __agyThemeDirPath;
    const cssFile = path_1.default.join(themeRoot, 'antigravity-custom.css');
    const jsFile = path_1.default.join(themeRoot, 'antigravity-we-sync.js');

    try {
        const ses = hubContents.session;
        if (ses && !ses.__agyWeCspHooked && ses.webRequest && typeof ses.webRequest.onHeadersReceived === 'function') {
            ses.__agyWeCspHooked = true;
            ses.webRequest.onHeadersReceived((details, callback) => {
                const headers = { ...(details.responseHeaders || {}) };
                for (const key of Object.keys(headers)) {
                    if (key.toLowerCase() === 'content-security-policy' && Array.isArray(headers[key])) {
                        headers[key] = headers[key].map((val) => {
                            let updated = String(val);
                            const allow = ' http://127.0.0.1:8989 ws://127.0.0.1:8989';
                            for (const dir of ['connect-src', 'media-src', 'img-src', 'default-src']) {
                                const re = new RegExp(`(${dir}\\\\b[^;]*)`, 'i');
                                if (re.test(updated) && !updated.includes('127.0.0.1:8989')) {
                                    updated = updated.replace(re, `$1${allow}`);
                                }
                            }
                            return updated;
                        });
                    }
                }
                callback({ responseHeaders: headers });
            });
        }
    } catch (_) {}

    let lastCssKey;
    const applyThemeNow = async () => {
        if (hubContents.isDestroyed?.()) return;
        try {
            if (fs.existsSync(cssFile)) {
                const css = fs.readFileSync(cssFile, 'utf-8');
                const nextKey = await hubContents.insertCSS(css, { cssOrigin: 'user' }).catch(() => undefined);
                if (lastCssKey && lastCssKey !== nextKey) {
                    await hubContents.removeInsertedCSS?.(lastCssKey).catch(() => undefined);
                }
                if (nextKey) lastCssKey = nextKey;
            }
            if (fs.existsSync(jsFile)) {
                const script = fs.readFileSync(jsFile, 'utf-8');
                await hubContents.executeJavaScript(script, true).catch(() => undefined);
            }
        } catch (err) {
            console.warn('[DarkGlassTheme] Injection error:', err?.message ?? String(err));
        }
    };

    hubContents.on('dom-ready', () => { void applyThemeNow(); });
    hubContents.on('did-finish-load', () => { void applyThemeNow(); });
}
/* AGY_WE_DARK_GLASS_PATCH_END */
""".replace("__agyThemeDirPath", json.dumps(theme_dir))

marker = "    const hubContents = getHubWebContents(win);"
if marker not in utils_js:
    raise RuntimeError("Khong tim thay diem neo hubContents trong dist/utils.js")

utils_js = utils_js.replace(
    marker,
    marker + "\n    if (hubContents) { attachDarkGlassTheme(hubContents); }",
    1
) + "\n" + injection_hook

payloads["dist/utils.js"] = utils_js.encode("utf-8")

# Xay dung lai payload va metadata offset moi
new_chunks = []
offset = 0
def rebuild_meta(node, prefix=""):
    global offset
    for k, v in node.get("files", {}).items():
        p = f"{prefix}/{k}" if prefix else k
        if "files" in v:
            rebuild_meta(v, p)
        else:
            if v.get("unpacked"):
                continue
            data = payloads[p]
            v["offset"] = str(offset)
            v["size"] = len(data)
            new_chunks.append(data)
            offset += len(data)

rebuild_meta(meta)

json_bytes = json.dumps(meta, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
# Electron ASAR header: 4B pickle_size(4) + 4B size_field + 4B json_padded_len + 4B json_len + json + 0..3 pad
pad = (4 - (len(json_bytes) % 4)) % 4
padded_json = json_bytes + (b"\x00" * pad)
hdr = struct.pack("<IIII", 4, len(padded_json) + 8, len(padded_json) + 4, len(json_bytes))

tmp_out = out_asar + ".tmp"
with open(tmp_out, "wb") as out:
    out.write(hdr)
    out.write(padded_json)
    for chunk in new_chunks:
        out.write(chunk)

shutil.move(tmp_out, out_asar)
print("Repacked app.asar successfully!")
'@

Invoke-PyScript -Code $patchPy -PyArgs @($bakAsar, $asarPath, $themeDir)

# 4. Kiem tra Electron Fuses & product.json (neu co checksum VS Code-style)
Write-Host "[4/4] Dang kiem tra co che toan ven (checksum / Electron fuses)..." -ForegroundColor Cyan
$productJson = Join-Path $resourcesDir "app\product.json"
if (Test-Path $productJson) {
    $prod = Get-Content $productJson -Raw | ConvertFrom-Json
    if ($prod.checksums) {
        $prod.PSObject.Properties.Remove("checksums")
        $prod | ConvertTo-Json -Depth 16 | Set-Content $productJson -Encoding UTF8
        Write-Host "  -> Da go bo checksums trong product.json." -ForegroundColor Yellow
    }
}

$exePath = Join-Path $AntigravityDir "Antigravity.exe"
$fusePy = @'
import sys
exe = sys.argv[1]
sentinel = b"dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX"
with open(exe, "rb") as f:
    data = f.read()
idx = data.find(sentinel)
if idx != -1:
    flen = data[idx + 33]
    vals = [chr(b) for b in data[idx + 34:idx + 34 + flen]]
    if len(vals) > 4:
        print(f"EnableEmbeddedAsarIntegrityValidation={vals[4]}")
'@
if (Test-Path $exePath) {
    $fuseStatus = (Invoke-PyScript -Code $fusePy -PyArgs @($exePath) | Select-Object -Last 1)
    Write-Host "  -> Electron Fuse: $fuseStatus (0 = khong chan app.asar da patch)" -ForegroundColor Gray
}

Write-Host "`n[OK] Da ap dung Dark Glass Anime Theme + WESync thanh cong!" -ForegroundColor Green
Write-Host "     Hay mo lai Antigravity Desktop de kiem tra giao dien." -ForegroundColor Green
