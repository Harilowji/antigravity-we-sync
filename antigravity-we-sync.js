/* ============================================================================
 * Antigravity Desktop - Wallpaper Engine Sync (WESyncServer v3.x Client)
 * Connects directly to ws://127.0.0.1:8989 and http://127.0.0.1:8989/status
 * ============================================================================ */

(function () {
  "use strict";

  if (window.__AGY_WE_SYNC_INITIALIZED__) return;
  window.__AGY_WE_SYNC_INITIALIZED__ = true;

  const WS_URL = "ws://127.0.0.1:8989";
  const STATUS_URL = "http://127.0.0.1:8989/status";
  const RECONNECT_DELAY_MS = 2500;
  const FADE_MS = 380;
  const FALLBACK_BG_COLOR = "#0b0d17";
  const FALLBACK_VIDEO_STORAGE_KEY = "agy-we-fallback-video";

  let activeWs = null;
  let reconnectTimer = null;
  let currentMediaKey = "";
  let switchToken = 0;
  let isWindowFocused = typeof document.hasFocus === "function" ? document.hasFocus() : true;

  function ensureBackgroundNodes() {
    if (!document.documentElement || !document.body) return null;

    document.documentElement.style.backgroundColor = FALLBACK_BG_COLOR;

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
        "object-fit: cover",
        "z-index: 0",
        "pointer-events: none",
        "opacity: 0",
        `transition: opacity ${FADE_MS}ms ease`,
        "background: transparent"
      ].join("; ") + ";";
      document.body.prepend(video);
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
        "object-fit: cover",
        "z-index: 0",
        "pointer-events: none",
        "opacity: 0",
        `transition: opacity ${FADE_MS}ms ease`
      ].join("; ") + ";";
      video.insertAdjacentElement("afterend", img);
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
        "background: rgba(8, 10, 16, 0.28)"
      ].join("; ") + ";";
      img.insertAdjacentElement("afterend", overlay);
    }

    return { video, img, overlay };
  }

  function shouldPlayVideo() {
    return !document.hidden && isWindowFocused;
  }

  function syncVideoPlayback() {
    const video = document.getElementById("we-bg-video");
    if (!video || !video.src) return;

    if (shouldPlayVideo()) {
      video.muted = true;
      const p = video.play();
      if (p && typeof p.catch === "function") {
        p.catch(() => {});
      }
    } else {
      try {
        video.pause();
      } catch (_) {}
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

    img.onload = () => {
      img.style.opacity = "1";
    };
    img.onerror = () => {
      img.style.opacity = "0";
    };
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
      fallbackVideo = localStorage.getItem(FALLBACK_VIDEO_STORAGE_KEY) || "";
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
    try {
      nodes.video.pause();
    } catch (_) {}
  }

  function applyWallpaperPayload(raw) {
    const nodes = ensureBackgroundNodes();
    if (!nodes || !raw) return;

    const mediaType = raw.type || raw.mediaType || "none";
    const mediaUrl = raw.url || raw.mediaUrl || "";
    const previewUrl = raw.previewUrl || "";
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
      if (previewUrl) {
        showImage(img, previewUrl);
      }

      const loadNewVideo = () => {
        if (token !== switchToken) return;

        video.oncanplay = null;
        video.onerror = null;

        video.oncanplay = () => {
          if (token !== switchToken) return;
          video.style.opacity = "1";
          syncVideoPlayback();
          setTimeout(() => {
            if (token === switchToken) {
              img.style.opacity = "0";
            }
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

    // Scene (.pkg), Web (.html), or static image wallpapers served by WESyncServer
    const targetImgUrl = mediaUrl || previewUrl;
    video.style.opacity = "0";
    try {
      video.pause();
    } catch (_) {}
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

      ws.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);
          applyWallpaperPayload(payload);
        } catch (_) {}
      };

      ws.onclose = () => {
        if (activeWs === ws) activeWs = null;
        scheduleReconnect();
      };

      ws.onerror = () => {
        try {
          ws.close();
        } catch (_) {}
      };
    } catch (_) {
      clearMediaToDarkFallback();
      scheduleReconnect();
    }
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

    let observerQueued = false;
    const observer = new MutationObserver(() => {
      if (observerQueued) return;
      observerQueued = true;
      requestAnimationFrame(() => {
        observerQueued = false;
        if (!document.getElementById("we-bg-video")) {
          ensureBackgroundNodes();
          if (currentMediaKey) {
            currentMediaKey = "";
            fetchCurrentStatus();
          }
        }
      });
    });

    if (document.body) {
      observer.observe(document.body, { childList: true, subtree: false });
    }
  }

  function bootstrap() {
    if (!document.body) {
      requestAnimationFrame(bootstrap);
      return;
    }
    ensureBackgroundNodes();
    bindLifecycleListeners();
    connectWebSocket();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bootstrap, { once: true });
  } else {
    bootstrap();
  }
})();
