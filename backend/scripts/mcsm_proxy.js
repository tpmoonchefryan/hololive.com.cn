import http from "http";
import { createLogger } from "./logger.js";

const PORT = Number.parseInt(process.env.MCSM_PROXY_PORT || "18091", 10);
const PB_URL = `${process.env.PB_URL || "http://127.0.0.1:8090"}`.replace(
  /\/$/,
  ""
);
const ALLOWED_ORIGIN = process.env.MCSM_ALLOWED_ORIGIN || "https://hololive.com.cn";
const REQUEST_TIMEOUT_MS = Number.parseInt(
  process.env.MCSM_REQUEST_TIMEOUT_MS || "15000",
  10
);
const CONFIG_CACHE_TTL_MS = Number.parseInt(
  process.env.MCSM_CONFIG_CACHE_TTL_MS || "60000",
  10
);
const MAX_COMMAND_LENGTH = 1000;
const RATE_LIMIT_WINDOW_MS = 60000;
const RATE_LIMIT_MAX = 30;

const logger = createLogger("MCSMProxy", { levelEnv: "MCSM_PROXY_LOG_LEVEL" });

// --- Rate limiter (per IP, public endpoints only) ---
const rateBuckets = new Map();

function rateLimit(ip) {
  const now = Date.now();
  let bucket = rateBuckets.get(ip);
  if (!bucket || now - bucket.start > RATE_LIMIT_WINDOW_MS) {
    bucket = { start: now, count: 0 };
    rateBuckets.set(ip, bucket);
  }
  bucket.count += 1;
  return bucket.count > RATE_LIMIT_MAX;
}

// Cleanup stale buckets every 5 minutes
setInterval(() => {
  const cutoff = Date.now() - RATE_LIMIT_WINDOW_MS * 2;
  for (const [ip, bucket] of rateBuckets) {
    if (bucket.start < cutoff) rateBuckets.delete(ip);
  }
}, 300000);

// --- MCSM config cache (from PocketBase) ---
let cachedConfig = null;
let configExpiresAt = 0;

async function loadConfig(authHeader) {
  const now = Date.now();
  // Public routes (no auth): always use cache if available
  if (!authHeader) {
    if (cachedConfig) return cachedConfig;
    throw new Error("no cached config available for public route");
  }
  // Admin routes: short 5s cache so config changes are picked up quickly
  if (cachedConfig && now < configExpiresAt) return cachedConfig;

  const endpoint = `${PB_URL}/api/collections/mcsm_config/records?perPage=1`;
  const res = await fetch(endpoint, { headers: { Authorization: authHeader } });
  if (!res.ok) {
    if (cachedConfig) return cachedConfig;
    throw new Error(`failed to load mcsm_config: HTTP ${res.status}`);
  }
  const payload = await res.json();
  const item = payload?.items?.[0];
  if (!item) {
    if (cachedConfig) return cachedConfig;
    throw new Error("mcsm_config record not found");
  }

  cachedConfig = {
    panelUrl: `${item.panel_url || ""}`.replace(/\/$/, ""),
    apiKey: item.api_key || "",
    enabled: !!item.enabled,
    publicCacheTtl: item.public_cache_ttl || 10000,
    instanceLabels: item.instance_labels || {},
  };
  configExpiresAt = now + 5000; // 5s TTL for admin-loaded config
  return cachedConfig;
}

// --- PocketBase auth verification ---
async function verifyPBAuth(authHeader) {
  if (!authHeader) return false;
  const res = await fetch(`${PB_URL}/api/collections/users/auth-refresh`, {
    method: "POST",
    headers: { Authorization: authHeader },
  });
  return res.ok;
}

// --- MCSM API helper ---
async function mcsmFetch(config, path, { method = "GET", body, query } = {}) {
  const url = new URL(`/api${path}`, config.panelUrl);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, v);
    }
  }
  url.searchParams.set("apikey", config.apiKey);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  const opts = { method, signal: controller.signal, headers: {} };
  if (body !== undefined) {
    opts.headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(body);
  }

  try {
    const res = await fetch(url.toString(), opts);
    clearTimeout(timeout);
    const data = await res.json();
    return { status: res.status, data };
  } catch (err) {
    clearTimeout(timeout);
    throw err;
  }
}

// --- Path traversal guard ---
function isSafePath(p) {
  if (!p || typeof p !== "string") return false;
  const normalized = p.replace(/\\/g, "/");
  if (normalized.includes("..")) return false;
  if (/^\//.test(normalized) && !normalized.startsWith("/")) return false;
  return true;
}

// --- JSON helpers ---
function sendJSON(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > 1024 * 1024) { reject(new Error("body too large")); return; }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function parseJSON(str) {
  try { return JSON.parse(str); } catch { return null; }
}

// --- Public status cache ---
let publicStatusCache = null;
let publicStatusExpiresAt = 0;

// --- Public route handler ---
async function handlePublicStatus(req, res) {
  const now = Date.now();
  const config = await loadConfig();
  if (!config.enabled) return sendJSON(res, 503, { error: "mcsm disabled" });

  if (publicStatusCache && now < publicStatusExpiresAt) {
    return sendJSON(res, 200, publicStatusCache);
  }

  // Use /api/service/remote_services which returns all nodes with instances
  const result = await mcsmFetch(config, "/service/remote_services");
  if (result.status !== 200 || !result.data?.data) {
    return sendJSON(res, 502, { error: "upstream error" });
  }

  const nodes = result.data.data;
  const instances = [];

  for (const node of Array.isArray(nodes) ? nodes : []) {
    for (const inst of node.instances || []) {
      instances.push({
        instanceUuid: inst.instanceUuid,
        daemonId: node.uuid,
        name: config.instanceLabels[inst.instanceUuid] || inst.config?.nickname || inst.instanceUuid,
        status: inst.status,
        currentPlayers: inst.info?.currentPlayers ?? -1,
        maxPlayers: inst.info?.maxPlayers ?? -1,
        cpuUsage: typeof inst.info?.cpuUsage === "number" ? Math.round(inst.info.cpuUsage * 100) / 100 : null,
        memUsage: typeof inst.info?.memUsage === "number" ? Math.round(inst.info.memUsage / 1024 / 1024) : null,
      });
    }
  }

  publicStatusCache = { instances, timestamp: now };
  publicStatusExpiresAt = now + config.publicCacheTtl;
  return sendJSON(res, 200, publicStatusCache);
}

// --- Admin route handlers ---
async function handleAdminOverview(config, res) {
  const result = await mcsmFetch(config, "/overview");
  return sendJSON(res, result.status === 200 ? 200 : 502, result.data);
}

async function handleAdminInstances(config, res) {
  // Use /api/service/remote_services which returns all nodes with full instance details
  const result = await mcsmFetch(config, "/service/remote_services");
  return sendJSON(res, result.status === 200 ? 200 : 502, result.data);
}

async function handleAdminInstance(config, res, query) {
  const uuid = query.get("uuid");
  const daemonId = query.get("daemonId");
  if (!uuid || !daemonId) return sendJSON(res, 400, { error: "missing uuid or daemonId" });

  const result = await mcsmFetch(config, "/instance", {
    query: { uuid, daemonId },
  });
  return sendJSON(res, result.status === 200 ? 200 : 502, result.data);
}

async function handleInstanceAction(config, res, action, query) {
  const uuid = query.get("uuid");
  const daemonId = query.get("daemonId");
  if (!uuid || !daemonId) return sendJSON(res, 400, { error: "missing uuid or daemonId" });

  const validActions = ["open", "stop", "restart", "kill"];
  if (!validActions.includes(action)) return sendJSON(res, 400, { error: "invalid action" });

  const result = await mcsmFetch(config, `/protected_instance/${action}`, {
    method: "GET",
    query: { uuid, daemonId },
  });
  return sendJSON(res, result.status === 200 ? 200 : 502, result.data);
}

async function handleInstanceCommand(config, req, res, query) {
  const uuid = query.get("uuid");
  const daemonId = query.get("daemonId");
  if (!uuid || !daemonId) return sendJSON(res, 400, { error: "missing uuid or daemonId" });

  const raw = await readBody(req);
  const body = parseJSON(raw);
  if (!body?.command || typeof body.command !== "string") {
    return sendJSON(res, 400, { error: "missing command" });
  }
  if (body.command.length > MAX_COMMAND_LENGTH) {
    return sendJSON(res, 400, { error: "command too long" });
  }

  const result = await mcsmFetch(config, "/protected_instance/command", {
    method: "GET",
    query: { uuid, daemonId, command: body.command },
  });
  return sendJSON(res, result.status === 200 ? 200 : 502, result.data);
}

async function handleInstanceOutputLog(config, res, query) {
  const uuid = query.get("uuid");
  const daemonId = query.get("daemonId");
  if (!uuid || !daemonId) return sendJSON(res, 400, { error: "missing uuid or daemonId" });

  const result = await mcsmFetch(config, "/protected_instance/outputlog", {
    query: { uuid, daemonId },
  });
  return sendJSON(res, result.status === 200 ? 200 : 502, result.data);
}

// --- File management handlers ---
async function handleFilesList(config, res, query) {
  const uuid = query.get("uuid");
  const daemonId = query.get("daemonId");
  const target = query.get("target") || "/";
  if (!uuid || !daemonId) return sendJSON(res, 400, { error: "missing uuid or daemonId" });
  if (!isSafePath(target)) return sendJSON(res, 400, { error: "invalid path" });

  const result = await mcsmFetch(config, "/files/list", {
    query: { uuid, daemonId, target, page: query.get("page") || "0", page_size: query.get("page_size") || "100" },
  });
  return sendJSON(res, result.status === 200 ? 200 : 502, result.data);
}

async function handleFilesRead(config, req, res) {
  const raw = await readBody(req);
  const body = parseJSON(raw);
  if (!body?.uuid || !body?.daemonId || !body?.target) {
    return sendJSON(res, 400, { error: "missing uuid, daemonId, or target" });
  }
  if (!isSafePath(body.target)) return sendJSON(res, 400, { error: "invalid path" });

  const result = await mcsmFetch(config, "/files/read", {
    method: "PUT",
    body: { target: body.target },
    query: { uuid: body.uuid, daemonId: body.daemonId },
  });
  return sendJSON(res, result.status === 200 ? 200 : 502, result.data);
}

async function handleFilesWrite(config, req, res) {
  const raw = await readBody(req);
  const body = parseJSON(raw);
  if (!body?.uuid || !body?.daemonId || !body?.target || body?.content === undefined) {
    return sendJSON(res, 400, { error: "missing required fields" });
  }
  if (!isSafePath(body.target)) return sendJSON(res, 400, { error: "invalid path" });

  const result = await mcsmFetch(config, "/files/write", {
    method: "PUT",
    body: { target: body.target, text: body.content },
    query: { uuid: body.uuid, daemonId: body.daemonId },
  });
  return sendJSON(res, result.status === 200 ? 200 : 502, result.data);
}

async function handleFilesMkdir(config, req, res) {
  const raw = await readBody(req);
  const body = parseJSON(raw);
  if (!body?.uuid || !body?.daemonId || !body?.target) {
    return sendJSON(res, 400, { error: "missing required fields" });
  }
  if (!isSafePath(body.target)) return sendJSON(res, 400, { error: "invalid path" });

  const result = await mcsmFetch(config, "/files/mkdir", {
    method: "POST",
    body: { target: body.target },
    query: { uuid: body.uuid, daemonId: body.daemonId },
  });
  return sendJSON(res, result.status === 200 ? 200 : 502, result.data);
}

async function handleFilesTouch(config, req, res) {
  const raw = await readBody(req);
  const body = parseJSON(raw);
  if (!body?.uuid || !body?.daemonId || !body?.target) {
    return sendJSON(res, 400, { error: "missing required fields" });
  }
  if (!isSafePath(body.target)) return sendJSON(res, 400, { error: "invalid path" });

  const result = await mcsmFetch(config, "/files/touch", {
    method: "POST",
    body: { target: body.target },
    query: { uuid: body.uuid, daemonId: body.daemonId },
  });
  return sendJSON(res, result.status === 200 ? 200 : 502, result.data);
}

async function handleFilesDelete(config, req, res) {
  const raw = await readBody(req);
  const body = parseJSON(raw);
  if (!body?.uuid || !body?.daemonId || !body?.targets || !Array.isArray(body.targets)) {
    return sendJSON(res, 400, { error: "missing required fields" });
  }
  for (const t of body.targets) {
    if (!isSafePath(t)) return sendJSON(res, 400, { error: "invalid path" });
  }

  const result = await mcsmFetch(config, "/files", {
    method: "DELETE",
    body: { targets: body.targets },
    query: { uuid: body.uuid, daemonId: body.daemonId },
  });
  return sendJSON(res, result.status === 200 ? 200 : 502, result.data);
}

async function handleFilesMove(config, req, res) {
  const raw = await readBody(req);
  const body = parseJSON(raw);
  if (!body?.uuid || !body?.daemonId || !body?.targets || !Array.isArray(body.targets)) {
    return sendJSON(res, 400, { error: "missing required fields" });
  }
  for (const pair of body.targets) {
    if (!isSafePath(pair[0]) || !isSafePath(pair[1])) {
      return sendJSON(res, 400, { error: "invalid path" });
    }
  }

  const result = await mcsmFetch(config, "/files/move", {
    method: "PUT",
    body: { targets: body.targets },
    query: { uuid: body.uuid, daemonId: body.daemonId },
  });
  return sendJSON(res, result.status === 200 ? 200 : 502, result.data);
}

// --- HTTP Server ---
const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
        "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Authorization, Content-Type",
        "Access-Control-Max-Age": "86400",
      });
      res.end();
      return;
    }

    const parsed = new URL(req.url || "/", "http://localhost");
    const path = parsed.pathname.replace(/\/+$/, "") || "/";
    const query = parsed.searchParams;
    const clientIp = req.headers["x-real-ip"] || req.socket.remoteAddress || "unknown";

    if (path === "/public/status" && req.method === "GET") {
      if (rateLimit(clientIp)) return sendJSON(res, 429, { error: "rate limit exceeded" });
      return await handlePublicStatus(req, res);
    }

    if (path.startsWith("/admin/")) {
      const authHeader = req.headers.authorization;
      if (!authHeader) return sendJSON(res, 401, { error: "unauthorized" });

      const isValid = await verifyPBAuth(authHeader);
      if (!isValid) return sendJSON(res, 401, { error: "unauthorized" });

      const config = await loadConfig(authHeader);
      if (!config.enabled) return sendJSON(res, 503, { error: "mcsm disabled" });

      if (path === "/admin/overview" && req.method === "GET") {
        return await handleAdminOverview(config, res);
      }
      if (path === "/admin/instances" && req.method === "GET") {
        return await handleAdminInstances(config, res);
      }
      if (path === "/admin/instance" && req.method === "GET") {
        return await handleAdminInstance(config, res, query);
      }
      if (path.match(/^\/admin\/instance\/(open|stop|restart|kill)$/) && req.method === "POST") {
        const action = path.split("/").pop();
        return await handleInstanceAction(config, res, action, query);
      }
      if (path === "/admin/instance/command" && req.method === "POST") {
        return await handleInstanceCommand(config, req, res, query);
      }
      if (path === "/admin/instance/outputlog" && req.method === "GET") {
        return await handleInstanceOutputLog(config, res, query);
      }
      if (path === "/admin/files/list" && req.method === "GET") {
        return await handleFilesList(config, res, query);
      }
      if (path === "/admin/files/read" && req.method === "PUT") {
        return await handleFilesRead(config, req, res);
      }
      if (path === "/admin/files/write" && req.method === "PUT") {
        return await handleFilesWrite(config, req, res);
      }
      if (path === "/admin/files/mkdir" && req.method === "POST") {
        return await handleFilesMkdir(config, req, res);
      }
      if (path === "/admin/files/touch" && req.method === "POST") {
        return await handleFilesTouch(config, req, res);
      }
      if (path === "/admin/files" && req.method === "DELETE") {
        return await handleFilesDelete(config, req, res);
      }
      if (path === "/admin/files/move" && req.method === "PUT") {
        return await handleFilesMove(config, req, res);
      }
    }

    sendJSON(res, 404, { error: "not found" });
  } catch (error) {
    logger.warn(`${req.method || "UNKNOWN"} ${req.url || ""} failed: ${error?.message || "unknown error"}`);
    const isAbort = error?.name === "AbortError";
    sendJSON(res, isAbort ? 504 : 500, {
      error: isAbort ? "proxy request timeout" : "internal error",
    });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  logger.info(`listening on 127.0.0.1:${PORT} (level=${logger.level})`);
});
