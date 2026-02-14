import http from "http";
import https from "https";
import { createLogger } from "./logger.js";

const PORT = Number.parseInt(process.env.PB_ADMIN_GATE_PORT || "18092", 10);
const PB_URL = `${process.env.PB_URL || "http://127.0.0.1:8090"}`.replace(
  /\/$/,
  ""
);
const SETTINGS_ID = `${process.env.PB_ADMIN_GATE_SETTINGS_ID || "1"}`;
const CACHE_TTL_MS = Number.parseInt(
  process.env.PB_ADMIN_GATE_CACHE_TTL_MS || "5000",
  10
);
const REQUEST_TIMEOUT_MS = Number.parseInt(
  process.env.PB_ADMIN_GATE_REQUEST_TIMEOUT_MS || "5000",
  10
);
const REDIRECT_PATH = process.env.PB_ADMIN_GATE_REDIRECT_PATH || "/418";

const logger = createLogger("PBAdminGate", {
  levelEnv: "PB_ADMIN_GATE_LOG_LEVEL",
});

let cachedEnabled = true;
let cacheExpiresAt = 0;
let lastLoggedState = null;

function normalizeEnabled(raw) {
  return raw !== false;
}

function getForwardedFor(req) {
  const existing = req.headers["x-forwarded-for"];
  const remoteIp = req.socket.remoteAddress;
  if (typeof existing === "string" && existing.trim()) {
    return remoteIp ? `${existing}, ${remoteIp}` : existing;
  }
  if (Array.isArray(existing) && existing.length > 0) {
    const merged = existing.join(", ");
    return remoteIp ? `${merged}, ${remoteIp}` : merged;
  }
  return remoteIp || "";
}

async function fetchPublicEntryEnabled() {
  const now = Date.now();
  if (now < cacheExpiresAt) {
    return cachedEnabled;
  }

  const endpoint = `${PB_URL}/api/collections/system_settings/records/${encodeURIComponent(
    SETTINGS_ID
  )}?fields=enable_pb_public_entry`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(endpoint, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const payload = await response.json();
    cachedEnabled = normalizeEnabled(payload?.enable_pb_public_entry);
    cacheExpiresAt = now + Math.max(1000, CACHE_TTL_MS);
    return cachedEnabled;
  } catch (error) {
    logger.warn("Failed to read enable_pb_public_entry, fallback to cache:", error?.message || error);
    cacheExpiresAt = now + 1000;
    return cachedEnabled;
  } finally {
    clearTimeout(timeout);
  }
}

function maybeLogState(enabled) {
  if (lastLoggedState === enabled) return;
  lastLoggedState = enabled;
  logger.info(`Public PocketBase admin entry is now ${enabled ? "enabled" : "disabled"}`);
}

function redirectTo418(res) {
  res.writeHead(302, {
    Location: REDIRECT_PATH,
    "Cache-Control": "no-store",
  });
  res.end();
}

function proxyToPocketBase(req, res) {
  let target;
  try {
    target = new URL(req.url || "/", PB_URL);
  } catch {
    res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Bad Request");
    return;
  }

  const isHttpsTarget = target.protocol === "https:";
  const transport = isHttpsTarget ? https : http;
  const upstreamPort =
    target.port || (isHttpsTarget ? "443" : "80");

  const proxyReq = transport.request(
    {
      protocol: target.protocol,
      hostname: target.hostname,
      port: upstreamPort,
      method: req.method,
      path: `${target.pathname}${target.search}`,
      headers: {
        ...req.headers,
        host: target.host,
        "x-forwarded-for": getForwardedFor(req),
      },
    },
    (proxyRes) => {
      res.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
      proxyRes.pipe(res);
    }
  );

  proxyReq.on("error", (error) => {
    logger.error("Proxy request to PocketBase failed:", error?.message || error);
    if (!res.headersSent) {
      res.writeHead(502, { "Content-Type": "text/plain; charset=utf-8" });
    }
    res.end("Bad Gateway");
  });

  req.pipe(proxyReq);
}

const server = http.createServer(async (req, res) => {
  if ((req.url || "").startsWith("/healthz")) {
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("ok");
    return;
  }

  const enabled = await fetchPublicEntryEnabled();
  maybeLogState(enabled);

  if (!enabled) {
    redirectTo418(res);
    return;
  }

  proxyToPocketBase(req, res);
});

server.listen(PORT, "127.0.0.1", () => {
  logger.info(`PB admin gate is listening on 127.0.0.1:${PORT}`);
});

