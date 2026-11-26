[CmdletBinding()]
param(
    [string]$AntigravityDir = "$env:LOCALAPPDATA\Programs\antigravity",
    [int]$CdpPort = 9229
)

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$exePath = Join-Path $AntigravityDir "Antigravity.exe"
$asarPath = Join-Path $AntigravityDir "resources\app.asar"
$applyScript = Join-Path $scriptDir "apply-theme.ps1"

if (-not (Test-Path $exePath)) {
    throw "Khong tim thay Antigravity.exe tai: $exePath"
}

# Cach 1: Kiem tra nhanh app.asar (< 20ms). Neu vua update va mat patch, tu dong patch lai truoc khi mo.
$needsPatch = $false
if (Test-Path $asarPath) {
    $bytes = [System.IO.File]::ReadAllBytes($asarPath)
    $marker = [System.Text.Encoding]::ASCII.GetBytes("AGY_WE_DARK_GLASS_PATCH_START")
    $found = $false
    for ($i = 0; $i -le ($bytes.Length - $marker.Length); $i++) {
        if ($bytes[$i] -eq $marker[0]) {
            $match = $true
            for ($j = 1; $j -lt $marker.Length; $j++) {
                if ($bytes[$i + $j] -ne $marker[$j]) { $match = $false; break }
            }
            if ($match) { $found = $true; break }
        }
    }
    if (-not $found) { $needsPatch = $true }
}

$alreadyRunning = Get-Process -ErrorAction SilentlyContinue | Where-Object {
    $_.Path -and ($_.Path -like "$AntigravityDir*")
}

if ($needsPatch -and -not $alreadyRunning -and (Test-Path $applyScript)) {
    try {
        & $applyScript -AntigravityDir $AntigravityDir
    } catch {
        # Neu patch that bai, van mo app va de CDP (Cach 2) tu inject theme
    }
}

# Cach 2: Mo kem --remote-debugging-port de WESyncServer CDP Auto-Injector luon du phong & hot-reload CSS
Start-Process -FilePath $exePath -ArgumentList "--remote-debugging-port=$CdpPort" -WorkingDirectory $AntigravityDir
