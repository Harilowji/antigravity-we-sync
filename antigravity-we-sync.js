/* ============================================================================
 * Antigravity Desktop - Wallpaper Engine Sync v2.0 (WESyncServer Client)
 * - Connects to ws://127.0.0.1:8989 and http://127.0.0.1:8989/status
 * - Transparent Windows Titlebar Overlay + Built-in Browser-Hole Clipping
 * - Auto pause/play on visibilitychange + window blur/focus
 * - Quick Glass Control HUD (Alt + G) with Overlay Dimming & Cat-Jam toggle
 * ============================================================================ */

(function () {
  "use strict";

  if (window.__AGY_WE_SYNC_INITIALIZED__) return;
  window.__AGY_WE_SYNC_INITIALIZED__ = true;

  const WS_URL = "ws://127.0.0.1:8989";
  const STATUS_URL = "http://127.0.0.1:8989/status";
  const CATJAM_URL = "http://127.0.0.1:8989/catjam.webm";
  const RECONNECT_DELAY_MS = 2500;
  const FADE_MS = 380;
  const FALLBACK_BG_COLOR = "#0b0d17";
  const STORAGE_KEY = "agy-we-sync-settings-v2";
  const FALLBACK_VIDEO_KEY = "agy-we-fallback-video";

  const DEFAULT_SETTINGS = {
    overlayOpacity: 0.28,
    pauseOnBlur: true,
    fitMode: "cover",
    catJamEnabled: false,
    enabled: true
  };

  function loadSettings() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
    } catch (_) {}
    return { ...DEFAULT_SETTINGS };
  }

  function saveSettings(partial) {
    settings = { ...settings, ...partial };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch (_) {}
    applySettingsToDOM();
  }

  let settings = loadSettings();
  let activeWs = null;
  let wsConnected = false;
  let reconnectTimer = null;
  let currentMediaKey = "";
  let currentStatusText = "Chưa kết nối WESync (127.0.0.1:8989)";
  let switchToken = 0;
  let isWindowFocused = typeof document.hasFocus === "function" ? document.hasFocus() : true;

  function applyNativeTitleBarTransparency() {
    try {
      if (window.electronNative && typeof window.electronNative.setTitleBarOverlay === "function") {
        window.electronNative.setTitleBarOverlay({
          color: "#00000000",
          symbolColor: "#f8fafc"
        });
      }
    } catch (_) {}
  }

  function ensureBackgroundNodes() {
    if (!document.documentElement || !document.body) return null;

    document.documentElement.style.backgroundColor = FALLBACK_BG_COLOR;

    let layer = document.getElementById("we-bg-layer");
    if (!layer) {
      layer = document.createElement("div");
      layer.id = "we-bg-layer";
      layer.style.cssText = [
        "position: fixed",
        "inset: 0",
        "width: 100vw",
        "height: 100vh",
        "z-index: 0",
        "pointer-events: none",
        "overflow: hidden"
      ].join("; ") + ";";
      document.body.prepend(layer);
    }

    let video = document.getElementById("we-bg-video");
    if (!video) {
      video = document.createElement("video");
      video.id = "we-bg-video";
      video.autoplay = true;
      video.loop = true;
      video.muted = true;
      video.defaultMuted = true;
      video.playsInline = true;
      video.preload = "auto";
      video.style.cssText = [
        "position: fixed",
        "inset: 0",
        "width: 100vw",
        "height: 100vh",
        `object-fit: ${settings.fitMode}`,
        "z-index: 0",
        "pointer-events: none",
        "opacity: 0",
        `transition: opacity ${FADE_MS}ms ease`,
        "background: transparent"
      ].join("; ") + ";";
      layer.appendChild(video);
    }

    let img = document.getElementById("we-bg-image");
    if (!img) {
      img = document.createElement("img");
      img.id = "we-bg-image";
      img.alt = "";
      img.draggable = false;
      img.style.cssText = [
        "position: fixed",
        "inset: 0",
        "width: 100vw",
        "height: 100vh",
        `object-fit: ${settings.fitMode}`,
        "z-index: 0",
        "pointer-events: none",
        "opacity: 0",
        `transition: opacity ${FADE_MS}ms ease`
      ].join("; ") + ";";
      layer.appendChild(img);
    }

    let overlay = document.getElementById("we-bg-overlay");
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.id = "we-bg-overlay";
      overlay.style.cssText = [
        "position: fixed",
        "inset: 0",
        "width: 100vw",
        "height: 100vh",
        "z-index: 0",
        "pointer-events: none",
        `background: rgba(8, 10, 16, ${settings.overlayOpacity})`
      ].join("; ") + ";";
      layer.appendChild(overlay);
    }

    return { layer, video, img, overlay };
  }

  function applySettingsToDOM() {
    document.documentElement.style.setProperty("--we-overlay-alpha", String(settings.overlayOpacity));
    const nodes = ensureBackgroundNodes();
    if (!nodes) return;

    nodes.overlay.style.background = `rgba(8, 10, 16, ${settings.overlayOpacity})`;
    nodes.video.style.objectFit = settings.fitMode;
    nodes.img.style.objectFit = settings.fitMode;
    nodes.layer.style.display = settings.enabled ? "block" : "none";

    syncCatJamWidget();
    syncVideoPlayback();
    syncHudUI();
  }

  function syncBrowserHoleClip() {
    const layer = document.getElementById("we-bg-layer");
    if (!layer) return;

    const hasHole = document.body.getAttribute("data-has-browser-hole") === "true";
    const holeEl = hasHole ? document.querySelector('[data-browser-hole]:not([data-browser-hole="false"])') : null;
    if (holeEl) {
      const rect = holeEl.getBoundingClientRect();
      if (rect.width > 1 && rect.height > 1) {
        const l = Math.max(0, Math.round(rect.left));
        const t = Math.max(0, Math.round(rect.top));
        const r = Math.max(l, Math.round(rect.right));
        const b = Math.max(t, Math.round(rect.bottom));
        layer.style.setProperty(
          "--we-hole-clip",
          `polygon(evenodd, 0 0, 100% 0, 100% 100%, 0 100%, 0 0, ${l}px ${t}px, ${r}px ${t}px, ${r}px ${b}px, ${l}px ${b}px, ${l}px ${t}px)`
        );
        return;
      }
    }
    layer.style.removeProperty("--we-hole-clip");
  }

  function shouldPlayVideo() {
    if (!settings.enabled || document.hidden) return false;
    if (settings.pauseOnBlur && !isWindowFocused) return false;
    return true;
  }

  function syncVideoPlayback() {
    const video = document.getElementById("we-bg-video");
    if (video && video.src) {
      if (shouldPlayVideo()) {
        video.muted = true;
        const p = video.play();
        if (p && typeof p.catch === "function") p.catch(() => {});
      } else {
        try { video.pause(); } catch (_) {}
      }
    }

    const cat = document.getElementById("we-catjam-companion");
    if (cat && settings.catJamEnabled) {
      if (shouldPlayVideo()) {
        cat.play().catch(() => {});
      } else {
        try { cat.pause(); } catch (_) {}
      }
    }
  }

  function syncCatJamWidget() {
    if (!document.body) return;
    let cat = document.getElementById("we-catjam-companion");
    if (!settings.catJamEnabled) {
      if (cat) {
        try { cat.pause(); } catch (_) {}
        cat.remove();
      }
      return;
    }

    if (!cat) {
      cat = document.createElement("video");
      cat.id = "we-catjam-companion";
      cat.src = CATJAM_URL;
      cat.autoplay = true;
      cat.loop = true;
      cat.muted = true;
      cat.defaultMuted = true;
      cat.playsInline = true;
      cat.title = "Cat-Jam (Alt + G de mo bang dieu khien)";
      cat.style.cssText = [
        "position: fixed",
        "right: 18px",
        "bottom: 14px",
        "height: 44px",
        "width: auto",
        "z-index: 2147482000",
        "pointer-events: auto",
        "cursor: pointer",
        "opacity: 0.92",
        "filter: drop-shadow(0 4px 10px rgba(0, 0, 0, 0.55))"
      ].join("; ") + ";";
      cat.addEventListener("click", toggleHud);
      cat.onerror = () => { cat.style.display = "none"; };
      document.body.appendChild(cat);
    }
  }

  function showImage(img, url) {
    if (!img || !url) return;
    const baseNew = url.split("?")[0];
    const baseOld = (img.src || "").split("?")[0];
    if (baseOld === baseNew && img.complete && img.naturalWidth > 0) {
      img.style.opacity = "1";
      return;
    }

    img.onload = () => { img.style.opacity = "1"; };
    img.onerror = () => { img.style.opacity = "0"; };
    img.src = url;
    if (img.complete && img.naturalWidth > 0) {
      img.style.opacity = "1";
    }
  }

  function clearMediaToDarkFallback() {
    const nodes = ensureBackgroundNodes();
    if (!nodes) return;

    let fallbackVideo = "";
    try {
      fallbackVideo = localStorage.getItem(FALLBACK_VIDEO_KEY) || "";
    } catch (_) {}

    if (fallbackVideo) {
      applyWallpaperPayload({
        type: "video",
        url: fallbackVideo,
        wallpaper: fallbackVideo
      });
      return;
    }

    currentMediaKey = "";
    nodes.video.style.opacity = "0";
    nodes.img.style.opacity = "0";
    try { nodes.video.pause(); } catch (_) {}
  }

  function applyWallpaperPayload(raw) {
    const nodes = ensureBackgroundNodes();
    if (!nodes || !raw) return;

    const mediaType = raw.type || raw.mediaType || "none";
    const mediaUrl = raw.url || raw.mediaUrl || "";
    const previewUrl = raw.previewUrl || "";
    const wpName = raw.wallpaper ? String(raw.wallpaper).split(/[\\/]/).pop() : "Dark Fallback";
    currentStatusText = wsConnected
      ? `Đã kết nối :8989 (${mediaType}: ${wpName})`
      : `HTTP :8989 (${mediaType}: ${wpName})`;
    syncHudUI();

    const mediaKey = `${mediaType}|${raw.wallpaper || ""}|${(mediaUrl || "").split("?")[0]}`;
    if (mediaType === "none" || (!mediaUrl && !previewUrl)) {
      clearMediaToDarkFallback();
      return;
    }

    if (mediaKey === currentMediaKey) {
      syncVideoPlayback();
      return;
    }
    currentMediaKey = mediaKey;
    const token = ++switchToken;
    const { video, img } = nodes;

    if (mediaType === "video" && mediaUrl) {
      if (previewUrl) showImage(img, previewUrl);

      const loadNewVideo = () => {
        if (token !== switchToken) return;
        video.oncanplay = null;
        video.onerror = null;

        video.oncanplay = () => {
          if (token !== switchToken) return;
          video.style.opacity = "1";
          syncVideoPlayback();
          setTimeout(() => {
            if (token === switchToken) img.style.opacity = "0";
          }, FADE_MS);
        };

        video.onerror = () => {
          if (token !== switchToken) return;
          video.style.opacity = "0";
          if (previewUrl) showImage(img, previewUrl);
        };

        video.defaultMuted = true;
        video.muted = true;
        video.autoplay = true;
        video.loop = true;
        video.playsInline = true;
        video.src = mediaUrl;
        video.load();
      };

      if (video.style.opacity === "1" && video.src) {
        video.style.opacity = "0";
        setTimeout(loadNewVideo, Math.min(220, FADE_MS));
      } else {
        loadNewVideo();
      }
      return;
    }

    const targetImgUrl = mediaUrl || previewUrl;
    video.style.opacity = "0";
    try { video.pause(); } catch (_) {}
    setTimeout(() => {
      if (token === switchToken && video.style.opacity === "0") {
        video.removeAttribute("src");
        video.load();
      }
    }, FADE_MS);
    showImage(img, targetImgUrl);
  }

  async function fetchCurrentStatus() {
    try {
      const res = await fetch(`${STATUS_URL}?t=${Date.now()}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      applyWallpaperPayload(data);
    } catch (_) {
      currentStatusText = "WESync offline — dùng nền tối #0b0d17";
      syncHudUI();
      clearMediaToDarkFallback();
    }
  }

  function scheduleReconnect() {
    if (reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connectWebSocket();
    }, RECONNECT_DELAY_MS);
  }

  function connectWebSocket() {
    ensureBackgroundNodes();
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }

    if (activeWs) {
      try {
        activeWs.onopen = null;
        activeWs.onmessage = null;
        activeWs.onclose = null;
        activeWs.onerror = null;
        activeWs.close();
      } catch (_) {}
      activeWs = null;
    }

    fetchCurrentStatus();

    try {
      const ws = new WebSocket(WS_URL);
      activeWs = ws;

      ws.onopen = () => {
        wsConnected = true;
        syncHudUI();
      };

      ws.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);
          applyWallpaperPayload(payload);
        } catch (_) {}
      };

      ws.onclose = () => {
        wsConnected = false;
        if (activeWs === ws) activeWs = null;
        currentStatusText = "Mất kết nối :8989 — đang thử lại...";
        syncHudUI();
        scheduleReconnect();
      };

      ws.onerror = () => {
        try { ws.close(); } catch (_) {}
      };
    } catch (_) {
      wsConnected = false;
      clearMediaToDarkFallback();
      scheduleReconnect();
    }
  }

  /* ========================================================================
   * Quick Glass Control HUD (Alt + G)
   * ======================================================================== */
  function createHudIfNeeded() {
    if (document.getElementById("we-hud-backdrop") || !document.body) return;

    const backdrop = document.createElement("div");
    backdrop.id = "we-hud-backdrop";
    backdrop.style.cssText = [
      "position: fixed",
      "inset: 0",
      "z-index: 2147483000",
      "display: none",
      "align-items: center",
      "justify-content: center",
      "background: rgba(6, 8, 14, 0.45)"
    ].join("; ") + ";";

    backdrop.innerHTML = `
      <div id="we-hud-card" style="width:360px;max-width:92vw;padding:16px 18px;border-radius:12px;background:rgba(18,20,28,0.92);border:1px solid rgba(255,255,255,0.11);box-shadow:0 18px 46px rgba(0,0,0,0.65);color:#f4f6fb;font-family:system-ui,-apple-system,sans-serif;font-size:13px;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
          <strong style="font-size:14px;">Dark Glass Anime &times; WESync</strong>
          <button id="we-hud-close" style="background:transparent;border:none;color:#cbd5e1;font-size:18px;cursor:pointer;line-height:1;">&times;</button>
        </div>
        <div id="we-hud-status" style="padding:8px 10px;border-radius:8px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.08);margin-bottom:12px;font-size:12px;word-break:break-all;"></div>
        <div style="margin-bottom:12px;">
          <div style="display:flex;justify-content:space-between;margin-bottom:4px;">
            <span>Độ tối lớp phủ Video</span>
            <span id="we-hud-alpha-lbl">28%</span>
          </div>
          <input id="we-hud-alpha" type="range" min="0" max="70" value="28" style="width:100%;accent-color:#7dd3fc;cursor:pointer;" />
        </div>
        <div style="display:flex;gap:6px;margin-bottom:12px;">
          <button data-we-preset="clear" style="flex:1;padding:6px;border-radius:8px;border:1px solid rgba(255,255,255,0.12);background:rgba(255,255,255,0.06);color:#f4f6fb;cursor:pointer;font-size:12px;">Trong (12%)</button>
          <button data-we-preset="balanced" style="flex:1;padding:6px;border-radius:8px;border:1px solid rgba(255,255,255,0.12);background:rgba(255,255,255,0.06);color:#f4f6fb;cursor:pointer;font-size:12px;">Cân bằng (28%)</button>
          <button data-we-preset="focus" style="flex:1;padding:6px;border-radius:8px;border:1px solid rgba(255,255,255,0.12);background:rgba(255,255,255,0.06);color:#f4f6fb;cursor:pointer;font-size:12px;">Tối dịu (46%)</button>
        </div>
        <label style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;cursor:pointer;">
          <span>Tự pause video khi ẩn/mất focus</span>
          <input id="we-hud-blur" type="checkbox" style="accent-color:#7dd3fc;" />
        </label>
        <label style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;cursor:pointer;">
          <span>Bật nền Wallpaper Engine</span>
          <input id="we-hud-enable" type="checkbox" style="accent-color:#7dd3fc;" />
        </label>
        <label style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;cursor:pointer;">
          <span>Hiện Cat-Jam góc phải (/catjam.webm)</span>
          <input id="we-hud-catjam" type="checkbox" style="accent-color:#7dd3fc;" />
        </label>
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <button id="we-hud-reconnect" style="padding:6px 10px;border-radius:8px;border:1px solid rgba(255,255,255,0.14);background:rgba(255,255,255,0.08);color:#f4f6fb;cursor:pointer;font-size:12px;">Kết nối lại :8989</button>
          <span style="font-size:11px;color:#94a3b8;">Alt + G để đóng/mở</span>
        </div>
      </div>
    `;

    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop) backdrop.style.display = "none";
    });
    backdrop.querySelector("#we-hud-close").addEventListener("click", () => {
      backdrop.style.display = "none";
    });
    backdrop.querySelector("#we-hud-alpha").addEventListener("input", (e) => {
      const pct = parseInt(e.target.value, 10) || 0;
      saveSettings({ overlayOpacity: pct / 100 });
    });
    backdrop.querySelector("#we-hud-blur").addEventListener("change", (e) => {
      saveSettings({ pauseOnBlur: e.target.checked });
    });
    backdrop.querySelector("#we-hud-enable").addEventListener("change", (e) => {
      saveSettings({ enabled: e.target.checked });
    });
    backdrop.querySelector("#we-hud-catjam").addEventListener("change", (e) => {
      saveSettings({ catJamEnabled: e.target.checked });
    });
    backdrop.querySelector("#we-hud-reconnect").addEventListener("click", () => {
      currentMediaKey = "";
      connectWebSocket();
    });
    backdrop.querySelectorAll("[data-we-preset]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const p = btn.getAttribute("data-we-preset");
        if (p === "clear") saveSettings({ overlayOpacity: 0.12 });
        else if (p === "focus") saveSettings({ overlayOpacity: 0.46 });
        else saveSettings({ overlayOpacity: 0.28 });
      });
    });

    document.body.appendChild(backdrop);
    syncHudUI();
  }

  function syncHudUI() {
    const statusEl = document.getElementById("we-hud-status");
    const alphaEl = document.getElementById("we-hud-alpha");
    const alphaLbl = document.getElementById("we-hud-alpha-lbl");
    const blurEl = document.getElementById("we-hud-blur");
    const enableEl = document.getElementById("we-hud-enable");
    const catEl = document.getElementById("we-hud-catjam");

    if (statusEl) {
      const dot = wsConnected ? "#34d399" : "#f87171";
      statusEl.innerHTML = `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${dot};margin-right:6px;"></span>${currentStatusText}`;
    }
    const pct = Math.round(settings.overlayOpacity * 100);
    if (alphaEl) alphaEl.value = String(pct);
    if (alphaLbl) alphaLbl.textContent = `${pct}%`;
    if (blurEl) blurEl.checked = settings.pauseOnBlur;
    if (enableEl) enableEl.checked = settings.enabled;
    if (catEl) catEl.checked = settings.catJamEnabled;
  }

  function toggleHud() {
    createHudIfNeeded();
    const backdrop = document.getElementById("we-hud-backdrop");
    if (!backdrop) return;
    const isVisible = backdrop.style.display === "flex";
    backdrop.style.display = isVisible ? "none" : "flex";
    if (!isVisible) syncHudUI();
  }

  function bindLifecycleListeners() {
    document.addEventListener("visibilitychange", syncVideoPlayback, { passive: true });
    window.addEventListener(
      "blur",
      () => {
        isWindowFocused = false;
        syncVideoPlayback();
      },
      { passive: true }
    );
    window.addEventListener(
      "focus",
      () => {
        isWindowFocused = true;
        syncVideoPlayback();
      },
      { passive: true }
    );
    window.addEventListener(
      "resize",
      () => {
        syncBrowserHoleClip();
      },
      { passive: true }
    );
    window.addEventListener("keydown", (e) => {
      if (e.altKey && !e.ctrlKey && !e.shiftKey && (e.key === "g" || e.key === "G")) {
        e.preventDefault();
        toggleHud();
      } else if (e.key === "Escape") {
        const backdrop = document.getElementById("we-hud-backdrop");
        if (backdrop && backdrop.style.display === "flex") {
          backdrop.style.display = "none";
        }
      }
    });

    let observerQueued = false;
    const observer = new MutationObserver(() => {
      if (observerQueued) return;
      observerQueued = true;
      requestAnimationFrame(() => {
        observerQueued = false;
        if (!document.getElementById("we-bg-video")) {
          ensureBackgroundNodes();
          applySettingsToDOM();
          if (currentMediaKey) {
            currentMediaKey = "";
            fetchCurrentStatus();
          }
        }
        syncBrowserHoleClip();
      });
    });

    if (document.body) {
      observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["data-has-browser-hole", "data-browser-hole"]
      });
    }
  }

  function bootstrap() {
    if (!document.body) {
      requestAnimationFrame(bootstrap);
      return;
    }
    applyNativeTitleBarTransparency();
    ensureBackgroundNodes();
    applySettingsToDOM();
    syncBrowserHoleClip();
    bindLifecycleListeners();
    connectWebSocket();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bootstrap, { once: true });
  } else {
    bootstrap();
  }
})();
