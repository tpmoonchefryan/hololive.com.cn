import http from "http";
import { injectMapEscapeBridge } from "./lib/map-embed-bridge.js";
import { Readable } from "stream";
import { createLogger } from "./logger.js";

const PORT = Number.parseInt(process.env.MAP_PROXY_PORT || "18090", 10);
const PB_URL = `${process.env.PB_URL || "http://127.0.0.1:8090"}`.replace(
  /\/$/,
  ""
);
const ALLOWED_CACHE_TTL_MS = Number.parseInt(
  process.env.MAP_PROXY_ALLOWED_CACHE_TTL_MS || "30000",
  10
);
const REQUEST_TIMEOUT_MS = Number.parseInt(
  process.env.MAP_PROXY_REQUEST_TIMEOUT_MS || "20000",
  10
);

let cachedAllowedOrigins = new Set();
let cacheExpiresAt = 0;
const logger = createLogger("MapProxy", { levelEnv: "MAP_PROXY_LOG_LEVEL" });

const normalizeMapUrl = (rawUrl) => {
  const trimmed = `${rawUrl || ""}`.trim();
  if (!trimmed) return "";
  const withProtocol = /^[a-zA-Z][a-zA-Z\d+.-]*:\/\//.test(trimmed)
    ? trimmed
    : `http://${trimmed}`;

  try {
    const parsed = new URL(withProtocol);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "";
    return parsed.toString();
  } catch {
    return "";
  }
};

const getProxyPathPrefix = (target) => {
  const protocol = target.protocol.replace(":", "");
  return `/map-proxy/${protocol}/${target.host}`;
};

const extractTargetUrl = (requestUrl) => {
  const parsed = new URL(requestUrl, "http://localhost");
  const rawPath = parsed.pathname.startsWith("/map-proxy/")
    ? parsed.pathname.slice("/map-proxy".length)
    : parsed.pathname;
  const match = rawPath.match(/^\/(https?)\/([^/]+)(\/.*)?$/i);
  if (!match) return "";

  const protocol = match[1].toLowerCase();
  const host = match[2];
  const pathname = match[3] || "/";

  try {
    const target = new URL(`${protocol}://${host}${pathname}${parsed.search}`);
    if (target.protocol !== "http:" && target.protocol !== "https:") return "";
    return target.toString();
  } catch {
    return "";
  }
};

const rewriteHtml = (html, target) => {
  const proxyPrefix = getProxyPathPrefix(target);
  const hasBaseTag = /<base\s/i.test(html);
  const withBase = hasBaseTag
    ? html
    : html.replace(/<head([^>]*)>/i, `<head$1><base href="${proxyPrefix}${target.pathname.endsWith("/") ? target.pathname : target.pathname.slice(0, target.pathname.lastIndexOf("/") + 1)}">`);

  return injectMapEscapeBridge(withBase)
    .replace(
      /(href|src|action)=("|')\/(?!\/|map-proxy\/)/gi,
      `$1=$2${proxyPrefix}/`
    )
    .replace(/url\((['"]?)\/(?!\/|map-proxy\/)/gi, `url($1${proxyPrefix}/`);
};

const getAllowedOrigins = async () => {
  const now = Date.now();
  if (now < cacheExpiresAt && cachedAllowedOrigins.size > 0) {
    return cachedAllowedOrigins;
  }

  const origins = new Set();
  let page = 1;
  let totalPages = 1;

  while (page <= totalPages) {
    const endpoint = `${PB_URL}/api/collections/server_maps/records?fields=url&perPage=200&page=${page}`;
    const response = await fetch(endpoint);
    if (!response.ok) {
      throw new Error(`failed to fetch server_maps: HTTP ${response.status}`);
    }
    const payload = await response.json();
    totalPages = payload?.totalPages || 1;

    for (const item of payload?.items || []) {
      const normalized = normalizeMapUrl(item?.url);
      if (!normalized) continue;
      origins.add(new URL(normalized).origin);
    }
    page += 1;
  }

  cachedAllowedOrigins = origins;
  cacheExpiresAt = now + ALLOWED_CACHE_TTL_MS;
  return origins;
};

// Never Cookie or Authorization: the map receives no site credentials.
const FORWARDED_REQUEST_HEADERS = [
  "accept",
  "accept-language",
  "cache-control",
  "user-agent",
];
// The sandboxed map frame has an opaque origin, so its requests are cross-origin. A preflight may
// list the forwarded headers and jQuery's X-Requested-With, which is accepted and not forwarded.
const PREFLIGHT_ALLOWED_HEADERS = [...FORWARDED_REQUEST_HEADERS, "x-requested-with"].join(", ");

const filterForwardHeaders = (headers) => {
  const allowed = new Set(FORWARDED_REQUEST_HEADERS);

  const forwarded = {};
  for (const [key, value] of Object.entries(headers)) {
    const lower = key.toLowerCase();
    if (!allowed.has(lower)) continue;
    if (typeof value === "string" && value) forwarded[lower] = value;
  }
  return forwarded;
};

const filterResponseHeaders = (headers) => {
  const stripped = new Set([
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
    "content-length",
    // fetch decodes gzip/br/deflate. These headers describe upstream bytes.
    "content-encoding",
    "content-md5",
    "digest",
    "etag",
    "content-range",
    "accept-ranges",
    "access-control-allow-origin",
    "access-control-allow-credentials",
    "access-control-allow-headers",
    "access-control-allow-methods",
    "content-security-policy",
    "x-frame-options",
    "frame-options",
  ]);

  const result = {};
  for (const [key, value] of headers.entries()) {
    if (stripped.has(key.toLowerCase())) continue;
    result[key] = value;
  }
  return result;
};

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET,HEAD,OPTIONS",
        "Access-Control-Allow-Headers": PREFLIGHT_ALLOWED_HEADERS,
      });
      res.end();
      return;
    }

    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: "method not allowed" }));
      return;
    }

    const targetUrl = extractTargetUrl(req.url || "");
    if (!targetUrl) {
      res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: "invalid proxy url" }));
      return;
    }

    const target = new URL(targetUrl);
    const allowedOrigins = await getAllowedOrigins();
    if (!allowedOrigins.has(target.origin)) {
      res.writeHead(403, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: "target origin is not allowed" }));
      return;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    const upstream = await fetch(target.toString(), {
      method: req.method,
      headers: filterForwardHeaders(req.headers),
      redirect: "manual",
      signal: controller.signal,
    });

    clearTimeout(timeout);

    const responseHeaders = filterResponseHeaders(upstream.headers);
    responseHeaders["Access-Control-Allow-Origin"] = "*";
    // Enforce an opaque origin even when the map URL is opened outside our iframe.
    responseHeaders["Content-Security-Policy"] = "sandbox allow-scripts allow-forms allow-pointer-lock allow-downloads";
    responseHeaders["X-Content-Type-Options"] = "nosniff";

    const location = upstream.headers.get("location");
    if (location) {
      try {
        const redirected = new URL(location, target);
        if (!allowedOrigins.has(redirected.origin)) {
          res.writeHead(403, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ error: "redirect origin is not allowed" }));
          return;
        }
        if (allowedOrigins.has(redirected.origin)) {
          responseHeaders.location = `${getProxyPathPrefix(redirected)}${redirected.pathname}${redirected.search}${redirected.hash}`;
        }
      } catch {
        // ignore invalid redirect location
      }
    }

    const contentType = upstream.headers.get("content-type") || "";
    if (contentType.includes("text/html")) {
      if (req.method === "HEAD") {
        res.writeHead(upstream.status, responseHeaders);
        res.end();
        return;
      }
      const html = await upstream.text();
      const rewritten = rewriteHtml(html, target);
      responseHeaders["content-type"] = "text/html; charset=utf-8";
      responseHeaders["content-length"] = Buffer.byteLength(rewritten, "utf8");
      res.writeHead(upstream.status, responseHeaders);
      res.end(rewritten);
      return;
    }

    res.writeHead(upstream.status, responseHeaders);
    if (!upstream.body || req.method === "HEAD") {
      res.end();
      return;
    }

    Readable.fromWeb(upstream.body).pipe(res);
  } catch (error) {
    logger.warn(
      `[Proxy] ${req.method || "UNKNOWN"} ${req.url || ""} failed: ${error?.message || "unknown error"}`
    );
    const isAbort = error?.name === "AbortError";
    res.writeHead(isAbort ? 504 : 502, {
      "Content-Type": "application/json; charset=utf-8",
    });
    res.end(
      JSON.stringify({
        error: isAbort ? "proxy request timeout" : "proxy request failed",
      })
    );
  }
});

server.listen(PORT, "127.0.0.1", () => {
  logger.info(`listening on 127.0.0.1:${PORT} (level=${logger.level})`);
});
