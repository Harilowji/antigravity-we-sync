# Antigravity Dark Glass + Wallpaper Engine Sync

Custom **Dark Glass Anime** theme for **Antigravity Desktop** (Windows, Electron Hub `v2.35+`) with real-time dynamic background synchronization from **Wallpaper Engine** via local `WESyncServer` (`127.0.0.1:8989`).

## Features
- **Full Dark Glass UI** ([antigravity-custom.css](antigravity-custom.css)):
  - Transparent main app shell, titlebar, standalone views, and chat viewport (`background: transparent !important`).
  - Left sidebar with readable dark glass tint (`rgba(14, 16, 24, 0.55)`), eliminating collapsed-drawer edge shadow and scroll gradient bars.
  - Prompt composer, Model selector dropdown, and Usage/Quota popups styled with `rgba(18, 20, 28, 0.86)`, `1px solid rgba(255, 255, 255, 0.09)`, `12px` radius, and subtitle-grade text contour for high legibility over bright wallpapers.
  - **Zero `backdrop-filter: blur()`** across all surfaces to prevent GPU bottlenecks; includes a configurable tint overlay (default `rgba(8, 10, 16, 0.28)`).
- **Wallpaper Engine Real-Time Sync** ([antigravity-we-sync.js](antigravity-we-sync.js)):
  - Injects a full-screen `#we-bg-video` (`autoplay loop muted playsinline`, `pointer-events: none`, `z-index: 0`) with `#we-bg-image` fallback for Scene/Image wallpapers.
  - Connects to `ws://127.0.0.1:8989` and `http://127.0.0.1:8989/status` with smooth fade transitions when wallpapers change.
  - Built-in **Browser-Hole clipping** (`clip-path: polygon(evenodd, ...)`) so Antigravity's split browser pane is never covered by the background video.
  - Transparent Windows Titlebar Overlay (`window.electronNative.setTitleBarOverlay`) and `#0b0d17` dark fallback when offline.
  - Auto `pause()`/`play()` on `visibilitychange` and `window.blur`/`focus`.
  - **Quick Glass Control HUD (`Alt + G`)**: live overlay opacity slider, presets (`12%`, `28%`, `46%`), pause-on-blur toggle, reconnect button, and optional Cat-Jam (`/catjam.webm`) companion.
- **Safe Patch & 1-Click Restore** ([apply-theme.ps1](apply-theme.ps1), [restore-theme.ps1](restore-theme.ps1)):
  - Automatically backs up original files to `%LOCALAPPDATA%\Programs\antigravity\resources\.bak` (and refreshes backups if Antigravity updates).
  - Injects CSS/JS cleanly into `app.asar` (`dist/utils.js`) and relaxes CSP for `127.0.0.1:8989` if needed.

## Requirements
- Windows 10/11 with **Antigravity Desktop** installed at `%LOCALAPPDATA%\Programs\antigravity`
- **Python 3** (either on `PATH` or Antigravity's bundled Python)
- **WESyncServer** running on `127.0.0.1:8989` (e.g., from `spotify-wallpaper-engine-sync`)

## Usage

### Apply Theme
Close Antigravity Desktop (or pass `-ForceStopApp`) and run:
```powershell
.\apply-theme.ps1 -ForceStopApp
```
Re-run `.\apply-theme.ps1 -ForceStopApp` anytime after Antigravity updates. Press `Alt + G` inside Antigravity Desktop to tweak overlay darkness or toggle Cat-Jam.

### Restore Original UI
```powershell
.\restore-theme.ps1 -ForceStopApp
```
