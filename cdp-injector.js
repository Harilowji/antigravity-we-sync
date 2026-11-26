/**
 * Antigravity Desktop - Zero-Patch CDP Auto-Injector (Approach 2)
 * Zero external dependencies. Connects to Antigravity DevTools port (default 9229
 * or %APPDATA%\Antigravity\DevToolsActivePort) and injects Dark Glass CSS + WESync JS
 * if not already injected by app.asar, plus hot-reloads CSS when edited on disk.
 */

const http = require("http");
const net = require("net");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

function getCandidatePorts(defaultPort = 9229) {
  const ports = new Set([defaultPort]);
  try {
    const appData = process.env.APPDATA || "";
    const activePortFile = path.join(appData, "Antigravity", "DevToolsActivePort");
    if (fs.existsSync(activePortFile)) {
      const firstLine = fs.readFileSync(activePortFile, "utf-8").split(/\r?\n/)[0].trim();
      const parsed = parseInt(firstLine, 10);
      if (parsed > 0 && parsed < 65536) ports.add(parsed);
    }
  } catch (_) {}
  return Array.from(ports);
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { timeout: 1200 }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => {
        try {
          resolve(JSON.parse(body));
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on("timeout", () => {
      req.destroy(new Error("timeout"));
    });
    req.on("error", reject);
  });
}

function encodeWsClientTextFrame(text) {
  const payload = Buffer.from(text, "utf-8");
  const mask = crypto.randomBytes(4);
  const len = payload.length;
  let header;

  if (len < 126) {
    header = Buffer.alloc(6);
    header[0] = 0x81;
    header[1] = 0x80 | len;
    mask.copy(header, 2);
  } else if (len < 65536) {
    header = Buffer.alloc(8);
    header[0] = 0x81;
    header[1] = 0x80 | 126;
    header.writeUInt16BE(len, 2);
    mask.copy(header, 4);
  } else {
    header = Buffer.alloc(14);
    header[0] = 0x81;
    header[1] = 0x80 | 127;
    header.writeBigUInt64BE(BigInt(len), 2);
    mask.copy(header, 10);
  }

  const masked = Buffer.allocUnsafe(len);
  for (let i = 0; i < len; i++) {
    masked[i] = payload[i] ^ mask[i % 4];
  }
  return Buffer.concat([header, masked]);
}

function cdpEvaluate(wsUrl, expression) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(wsUrl);
    const port = parseInt(parsed.port, 10);
    const host = parsed.hostname || "127.0.0.1";
    const wsKey = crypto.randomBytes(16).toString("base64");

    const socket = net.createConnection({ host, port });
    let upgraded = false;
    let rawBuf = Buffer.alloc(0);
    let settled = false;

    const finish = (err, val) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { socket.destroy(); } catch (_) {}
      if (err) reject(err);
      else resolve(val);
    };

    const timer = setTimeout(() => finish(new Error("CDP eval timeout")), 4500);

    socket.on("error", (err) => finish(err));

    socket.on("connect", () => {
      const req = [
        `GET ${parsed.pathname}${parsed.search} HTTP/1.1`,
        `Host: ${host}:${port}`,
        "Upgrade: websocket",
        "Connection: Upgrade",
        `Sec-WebSocket-Key: ${wsKey}`,
        "Sec-WebSocket-Version: 13",
        "",
        ""
      ].join("\r\n");
      socket.write(req);
    });

    socket.on("data", (chunk) => {
      rawBuf = Buffer.concat([rawBuf, chunk]);

      if (!upgraded) {
        const hdrEnd = rawBuf.indexOf("\r\n\r\n");
        if (hdrEnd === -1) return;
        const hdrStr = rawBuf.subarray(0, hdrEnd).toString("utf-8");
        if (!hdrStr.includes("101")) {
          finish(new Error("WS upgrade failed"));
          return;
        }
        upgraded = true;
        rawBuf = rawBuf.subarray(hdrEnd + 4);

        const msg = JSON.stringify({
          id: 1,
          method: "Runtime.evaluate",
          params: { expression, returnByValue: true, awaitPromise: false }
        });
        socket.write(encodeWsClientTextFrame(msg));
      }

      while (upgraded && rawBuf.length >= 2) {
        const opcode = rawBuf[0] & 0x0f;
        const masked = (rawBuf[1] & 0x80) !== 0;
        let payloadLen = rawBuf[1] & 0x7f;
        let offset = 2;

        if (payloadLen === 126) {
          if (rawBuf.length < 4) return;
          payloadLen = rawBuf.readUInt16BE(2);
          offset = 4;
        } else if (payloadLen === 127) {
          if (rawBuf.length < 10) return;
          payloadLen = Number(rawBuf.readBigUInt64BE(2));
          offset = 10;
        }
        if (masked) offset += 4;
        if (rawBuf.length < offset + payloadLen) return;

        const framePayload = rawBuf.subarray(offset, offset + payloadLen);
        rawBuf = rawBuf.subarray(offset + payloadLen);

        if (opcode === 0x8) {
          finish(null, null);
          return;
        }
        if (opcode === 0x1 || opcode === 0x0) {
          try {
            const resp = JSON.parse(framePayload.toString("utf-8"));
            if (resp.id === 1) {
              finish(null, resp.result?.result?.value ?? null);
              return;
            }
          } catch (_) {}
        }
      }
    });
  });
}

function startAntigravityCdpWatcher(options = {}) {
  const themeDir = options.themeDir || __dirname;
  const cssPath = options.cssPath || path.join(themeDir, "antigravity-custom.css");
  const jsPath = options.jsPath || path.join(themeDir, "antigravity-we-sync.js");
  const defaultPort = options.port || 9229;
  const intervalMs = options.intervalMs || 2500;

  let lastCssHash = "";
  let inFlight = false;
  const injectedTargets = new Map();

  const tick = async () => {
    if (inFlight) return;
    inFlight = true;
    try {
      if (!fs.existsSync(cssPath) || !fs.existsSync(jsPath)) return;

      const cssText = fs.readFileSync(cssPath, "utf-8");
      const jsText = fs.readFileSync(jsPath, "utf-8");
      const cssHash = crypto.createHash("md5").update(cssText).digest("hex");
      const cssChanged = cssHash !== lastCssHash;

      for (const port of getCandidatePorts(defaultPort)) {
        let targets;
        try {
          targets = await fetchJson(`http://127.0.0.1:${port}/json/list`);
        } catch (_) {
          continue;
        }
        if (!Array.isArray(targets)) continue;

        for (const t of targets) {
          if (!t || t.type !== "page" || !t.webSocketDebuggerUrl) continue;
          const url = String(t.url || "");
          if (!url.startsWith("https://127.0.0.1:") && !url.startsWith("http://127.0.0.1:")) continue;

          const prevHash = injectedTargets.get(t.id);
          if (prevHash === cssHash && !cssChanged) {
            // Fast check if page reloaded
            try {
              const alive = await cdpEvaluate(
                t.webSocketDebuggerUrl,
                "Boolean(window.__AGY_WE_SYNC_INITIALIZED__)"
              );
              if (alive) continue;
            } catch (_) {
              injectedTargets.delete(t.id);
              continue;
            }
          }

          const injectCode = `(() => {
            try {
              const css = ${JSON.stringify(cssText)};
              let styleEl = document.getElementById("we-cdp-custom-css");
              if (!styleEl) {
                styleEl = document.createElement("style");
                styleEl.id = "we-cdp-custom-css";
                (document.head || document.documentElement).appendChild(styleEl);
              }
              if (styleEl.textContent !== css) styleEl.textContent = css;
              if (!window.__AGY_WE_SYNC_INITIALIZED__) {
                ${jsText}
              }
              return true;
            } catch (e) {
              return String(e);
            }
          })()`;

          try {
            await cdpEvaluate(t.webSocketDebuggerUrl, injectCode);
            injectedTargets.set(t.id, cssHash);
          } catch (_) {
            injectedTargets.delete(t.id);
          }
        }
      }

      lastCssHash = cssHash;
    } finally {
      inFlight = false;
    }
  };

  const timer = setInterval(() => { void tick(); }, intervalMs);
  void tick();
  return () => clearInterval(timer);
}

if (require.main === module) {
  console.log("[AGY CDP] Watching Antigravity DevTools port 9229...");
  startAntigravityCdpWatcher();
}

module.exports = { startAntigravityCdpWatcher };
