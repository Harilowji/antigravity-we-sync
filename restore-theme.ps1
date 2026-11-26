[CmdletBinding()]
param(
    [string]$AntigravityDir = "$env:LOCALAPPDATA\Programs\antigravity",
    [switch]$ForceStopApp
)

$ErrorActionPreference = "Stop"

$resourcesDir = Join-Path $AntigravityDir "resources"
$bakDir = Join-Path $resourcesDir ".bak"
$themeDir = Join-Path $resourcesDir "theme"

if (-not (Test-Path (Join-Path $bakDir "app.asar"))) {
    throw "Khong tim thay ban backup goc trong: $bakDir"
}

$running = Get-Process -ErrorAction SilentlyContinue | Where-Object {
    $_.Path -and ($_.Path -like "$AntigravityDir*")
}
if ($running) {
    if ($ForceStopApp) {
        Write-Host "[!] Dang dong Antigravity Desktop..." -ForegroundColor Yellow
        $running | Stop-Process -Force
        Start-Sleep -Milliseconds 900
    } else {
        throw "Antigravity Desktop dang chay. Hay dong app hoac chay lai voi -ForceStopApp."
    }
}

Write-Host "[1/2] Dang khoi phuc cac file goc tu $bakDir ..." -ForegroundColor Cyan
foreach ($name in @("app.asar", "app-update.yml", "default_app.asar")) {
    $bakFile = Join-Path $bakDir $name
    if (Test-Path $bakFile) {
        Copy-Item $bakFile (Join-Path $resourcesDir $name) -Force
        Write-Host "  -> Da khoi phuc $name" -ForegroundColor Gray
    }
}

$bakVer = Join-Path $bakDir "version"
if (Test-Path $bakVer) {
    Copy-Item $bakVer (Join-Path $AntigravityDir "version") -Force
}

Write-Host "[2/2] Dang don dep thu muc theme tam..." -ForegroundColor Cyan
if (Test-Path $themeDir) {
    Remove-Item $themeDir -Recurse -Force
}

Write-Host "`n[OK] Da khoi phuc Antigravity Desktop ve nguyen trang ban dau!" -ForegroundColor Green
