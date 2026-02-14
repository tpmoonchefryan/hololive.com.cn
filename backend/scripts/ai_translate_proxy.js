import http from "http";
import { createLogger } from "./logger.js";

const PORT = Number.parseInt(process.env.AI_TRANSLATE_PROXY_PORT || "18093", 10);
const PB_URL = `${process.env.PB_URL || "http://127.0.0.1:8090"}`.replace(
  /\/$/,
  ""
);
const ALLOWED_ORIGIN =
  process.env.AI_TRANSLATE_ALLOWED_ORIGIN || "https://hololive.com.cn";
const CONFIG_CACHE_TTL_MS = Number.parseInt(
  process.env.AI_TRANSLATE_CONFIG_CACHE_TTL_MS || "5000",
  10
);
const DEFAULT_REQUEST_TIMEOUT_MS = Number.parseInt(
  process.env.AI_TRANSLATE_DEFAULT_TIMEOUT_MS || "20000",
  10
);
const MAX_BODY_BYTES = Number.parseInt(
  process.env.AI_TRANSLATE_MAX_BODY_BYTES || `${1024 * 1024}`,
  10
);
const RATE_LIMIT_WINDOW_MS = 60000;
const RATE_LIMIT_MAX = Number.parseInt(
  process.env.AI_TRANSLATE_RATE_LIMIT_MAX || "30",
  10
);

const SUPPORTED_LANGS = ["zh", "en", "ja"];
const DEFAULT_TEST_SAMPLE_TEXT = "这是配置测试文本，请翻译。";
const CACHE_KEY_SEPARATOR = "::";

const logger = createLogger("AITranslateProxy", {
  levelEnv: "AI_TRANSLATE_PROXY_LOG_LEVEL",
});

const DEFAULT_TRANSLATION_CONFIG = {
  enabled: true,
  engine: "free",
  ai_provider: "right_code",
  right_code_base_url: "https://www.right.codes/codex/v1",
  right_code_api_key: "",
  right_code_model: "gpt-5.2",
  right_code_endpoint: "responses",
  request_timeout_ms: 20000,
  max_input_chars: 30000,
  fill_policy: "fill_empty_only",
  enable_cache: true,
  cache_ttl_ms: 1800000,
};

function sanitizeApiKey(raw) {
  const value = `${raw || ""}`.trim();
  if (!value) return "";
  return value.replace(/^Bearer\s+/i, "").trim();
}

const FIXED_TRANSLATION_PROMPT = [
  "你是严格的多语言翻译引擎。",
  "要求：",
  "1) 只输出 JSON 对象，不要输出任何解释、前后缀、代码块。",
  "2) JSON 仅包含目标语言代码键，不得包含源语言代码键。",
  "3) 必须为每个目标语言键提供字符串值。",
  "4) 保留原文中的 Markdown、HTML、URL、占位符（如 {{name}}, %s, `${var}`）和换行结构。",
  "5) 若不确定翻译，仍返回合理译文；严禁返回空对象。",
].join("\n");

// --- Simple in-memory caches ---
let cachedConfig = { ...DEFAULT_TRANSLATION_CONFIG };
let configExpiresAt = 0;
let configRecordId = null;

const translateCache = new Map();
const rateBuckets = new Map();

setInterval(() => {
  const now = Date.now();
  // Cleanup request buckets
  const bucketCutoff = now - RATE_LIMIT_WINDOW_MS * 2;
  for (const [ip, bucket] of rateBuckets) {
    if (bucket.start < bucketCutoff) rateBuckets.delete(ip);
  }

  // Cleanup translation cache
  for (const [key, entry] of translateCache) {
    if (!entry || entry.expiresAt <= now) {
      translateCache.delete(key);
    }
  }
}, 300000);

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

function sendJSON(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS, GET",
  });
  res.end(body);
}

function sendNoContent(res, status = 204) {
  res.writeHead(status, {
    "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS, GET",
  });
  res.end();
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function parseJSON(str) {
  try {
    return JSON.parse(str);
  } catch {
    return null;
  }
}

function normalizeLang(value) {
  const lang = `${value || ""}`.trim().toLowerCase();
  return SUPPORTED_LANGS.includes(lang) ? lang : "";
}

function normalizeTargets(sourceLang, rawTargets) {
  const source = normalizeLang(sourceLang);
  if (!source) {
    throw new Error("invalid source_lang");
  }

  const initial = Array.isArray(rawTargets) ? rawTargets : [];
  const fromInput = initial
    .map((item) => normalizeLang(item))
    .filter((item) => item && item !== source);
  const targets = Array.from(new Set(fromInput));

  if (targets.length === 0) {
    return SUPPORTED_LANGS.filter((lang) => lang !== source);
  }

  return targets;
}

function normalizeTranslationConfig(raw) {
  const cfg = {
    ...DEFAULT_TRANSLATION_CONFIG,
    ...(raw || {}),
  };

  cfg.enabled = cfg.enabled !== false;
  cfg.engine = cfg.engine === "ai" ? "ai" : "free";
  cfg.ai_provider = cfg.ai_provider === "right_code" ? "right_code" : "right_code";
  cfg.right_code_base_url = `${cfg.right_code_base_url || DEFAULT_TRANSLATION_CONFIG.right_code_base_url}`.replace(
    /\/$/,
    ""
  );
  cfg.right_code_api_key = sanitizeApiKey(cfg.right_code_api_key);
  cfg.right_code_model = `${cfg.right_code_model || DEFAULT_TRANSLATION_CONFIG.right_code_model}`.trim() || DEFAULT_TRANSLATION_CONFIG.right_code_model;
  cfg.right_code_endpoint =
    cfg.right_code_endpoint === "chat_completions" ? "chat_completions" : "responses";

  const timeout = Number.parseInt(`${cfg.request_timeout_ms || ""}`, 10);
  cfg.request_timeout_ms =
    Number.isFinite(timeout) && timeout >= 1000
      ? timeout
      : DEFAULT_TRANSLATION_CONFIG.request_timeout_ms;

  const maxInputChars = Number.parseInt(`${cfg.max_input_chars || ""}`, 10);
  cfg.max_input_chars =
    Number.isFinite(maxInputChars) && maxInputChars >= 100
      ? maxInputChars
      : DEFAULT_TRANSLATION_CONFIG.max_input_chars;

  cfg.fill_policy =
    cfg.fill_policy === "overwrite_target" ? "overwrite_target" : "fill_empty_only";
  cfg.enable_cache = cfg.enable_cache !== false;

  const cacheTtl = Number.parseInt(`${cfg.cache_ttl_ms || ""}`, 10);
  cfg.cache_ttl_ms =
    Number.isFinite(cacheTtl) && cacheTtl >= 1000
      ? cacheTtl
      : DEFAULT_TRANSLATION_CONFIG.cache_ttl_ms;

  return cfg;
}

function getAuthHeader(req) {
  const auth = req.headers.authorization;
  if (typeof auth === "string" && auth.trim()) return auth.trim();
  return "";
}

async function verifyPBAuth(authHeader) {
  if (!authHeader) return false;
  try {
    const res = await fetch(`${PB_URL}/api/collections/users/auth-refresh`, {
      method: "POST",
      headers: { Authorization: authHeader },
    });
    return res.ok;
  } catch (error) {
    logger.warn("auth-refresh failed:", error?.message || error);
    return false;
  }
}

async function loadTranslationConfig(authHeader, overrideConfig = null) {
  const now = Date.now();

  if (now < configExpiresAt && !overrideConfig) {
    return {
      config: cachedConfig,
      recordId: configRecordId,
    };
  }

  let record = null;
  try {
    const endpoint = `${PB_URL}/api/collections/translation_config/records?perPage=1`;
    const res = await fetch(endpoint, {
      headers: {
        Authorization: authHeader,
      },
    });

    if (res.status === 404) {
      // migration may not be applied yet
      logger.warn("translation_config collection not found, fallback to defaults.");
    } else if (!res.ok) {
      throw new Error(`failed to load translation_config: HTTP ${res.status}`);
    } else {
      const payload = await res.json();
      record = payload?.items?.[0] || null;
    }
  } catch (error) {
    logger.warn("Failed to fetch translation_config, fallback to cache/default:", error?.message || error);
  }

  const normalizedBase = normalizeTranslationConfig(record || cachedConfig || DEFAULT_TRANSLATION_CONFIG);
  cachedConfig = normalizedBase;
  configRecordId = record?.id || configRecordId;
  configExpiresAt = now + Math.max(1000, CONFIG_CACHE_TTL_MS);

  if (overrideConfig && typeof overrideConfig === "object") {
    return {
      config: normalizeTranslationConfig({
        ...normalizedBase,
        ...overrideConfig,
      }),
      recordId: configRecordId,
    };
  }

  return {
    config: normalizedBase,
    recordId: configRecordId,
  };
}

function extractResponseText(payload) {
  if (!payload || typeof payload !== "object") return "";

  if (typeof payload.output_text === "string" && payload.output_text.trim()) {
    return payload.output_text.trim();
  }

  if (Array.isArray(payload.output)) {
    const parts = [];
    for (const item of payload.output) {
      const content = Array.isArray(item?.content) ? item.content : [];
      for (const c of content) {
        if (typeof c?.text === "string" && c.text.trim()) {
          parts.push(c.text);
        }
      }
    }
    if (parts.length) return parts.join("\n").trim();
  }

  const choiceContent = payload?.choices?.[0]?.message?.content;
  if (typeof choiceContent === "string" && choiceContent.trim()) {
    return choiceContent.trim();
  }
  if (Array.isArray(choiceContent)) {
    const joined = choiceContent
      .map((item) => {
        if (typeof item === "string") return item;
        if (typeof item?.text === "string") return item.text;
        return "";
      })
      .filter(Boolean)
      .join("\n")
      .trim();
    if (joined) return joined;
  }

  return "";
}

function parseJSONObject(text) {
  if (typeof text !== "string") return null;
  const trimmed = text.trim();
  if (!trimmed) return null;

  const direct = parseJSON(trimmed);
  if (direct && typeof direct === "object" && !Array.isArray(direct)) {
    return direct;
  }

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced?.[1]) {
    const parsed = parseJSON(fenced[1].trim());
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed;
    }
  }

  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    const maybe = trimmed.slice(firstBrace, lastBrace + 1);
    const parsed = parseJSON(maybe);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed;
    }
  }

  return null;
}

function ensureTranslationShape(parsed, { sourceLang, targets }) {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("model output is not a valid JSON object");
  }

  const result = {};
  for (const target of targets) {
    const raw = parsed[target];
    result[target] =
      typeof raw === "string"
        ? raw
        : raw === null || raw === undefined
          ? ""
          : `${raw}`;
  }

  const hasAllTargets = targets.every((target) =>
    Object.prototype.hasOwnProperty.call(parsed, target)
  );
  const noSourceLang = !Object.prototype.hasOwnProperty.call(parsed, sourceLang);

  if (!hasAllTargets) {
    throw new Error("model output missing target languages");
  }

  return {
    result,
    checks: {
      json_parse: true,
      has_all_targets: hasAllTargets,
      no_source_lang: noSourceLang,
    },
  };
}

function buildTranslationPrompt({ sourceLang, targets, text }) {
  return [
    FIXED_TRANSLATION_PROMPT,
    "",
    `源语言: ${sourceLang}`,
    `目标语言: ${targets.join(", ")}`,
    "",
    "请翻译以下文本：",
    "<<<TEXT",
    text,
    "TEXT>>>",
  ].join("\n");
}

async function rightCodeRequest(config, prompt) {
  const timeoutMs = config.request_timeout_ms || DEFAULT_REQUEST_TIMEOUT_MS;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    if (!config.right_code_api_key) {
      throw new Error("Right Code API key is empty");
    }

    const endpoint =
      config.right_code_endpoint === "chat_completions"
        ? `${config.right_code_base_url}/chat/completions`
        : `${config.right_code_base_url}/responses`;

    const body =
      config.right_code_endpoint === "chat_completions"
        ? {
            model: config.right_code_model,
            stream: false,
            messages: [{ role: "user", content: prompt }],
          }
        : {
            model: config.right_code_model,
            stream: false,
            input: [
              {
                type: "message",
                role: "user",
                content: [{ type: "input_text", text: prompt }],
              },
            ],
          };

    const authModes = ["authorization", "x-api-key"];
    let lastError = null;

    for (const authMode of authModes) {
      const headers = {
        "Content-Type": "application/json",
        Accept: "application/json",
      };
      if (authMode === "authorization") {
        headers.Authorization = `Bearer ${config.right_code_api_key}`;
      } else {
        headers["x-api-key"] = config.right_code_api_key;
      }

      const res = await fetch(endpoint, {
        method: "POST",
        signal: controller.signal,
        headers,
        body: JSON.stringify(body),
      });

      const rawText = await res.text();
      const payload = parseJSON(rawText);
      if (res.ok) {
        return payload || { output_text: rawText || "" };
      }

      const detail =
        payload?.error?.message ||
        payload?.message ||
        `${rawText || ""}`.trim().slice(0, 300) ||
        "unknown error";
      lastError = new Error(`Right Code request failed: HTTP ${res.status} - ${detail}`);

      // If auth fails on first mode, try fallback mode.
      if ((res.status === 401 || res.status === 403) && authMode === "authorization") {
        logger.warn("Right Code authorization header failed, retrying with x-api-key.");
        continue;
      }

      throw lastError;
    }

    throw lastError || new Error("Right Code request failed");
  } finally {
    clearTimeout(timeout);
  }
}

async function freeTranslateOne(sourceLang, targetLang, text, timeoutMs) {
  const langPair = `${encodeURIComponent(sourceLang)}|${encodeURIComponent(targetLang)}`;
  const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${langPair}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      throw new Error(`free translate failed: HTTP ${res.status}`);
    }
    const data = await res.json();
    const translated = data?.responseData?.translatedText;
    if (typeof translated === "string") {
      return translated;
    }
    return "";
  } finally {
    clearTimeout(timeout);
  }
}

function buildTranslateCacheKey({
  config,
  sourceLang,
  targets,
  text,
}) {
  return [
    config.engine,
    config.ai_provider,
    config.right_code_endpoint,
    config.right_code_model,
    sourceLang,
    targets.join(","),
    text,
  ].join(CACHE_KEY_SEPARATOR);
}

async function translateByConfig(config, { sourceLang, targets, text }) {
  const timeoutMs = config.request_timeout_ms || DEFAULT_REQUEST_TIMEOUT_MS;

  if (!text || !text.trim()) {
    const empty = {};
    for (const target of targets) empty[target] = "";
    return {
      translations: empty,
      checks: {
        json_parse: true,
        has_all_targets: true,
        no_source_lang: true,
      },
    };
  }

  if (text.length > config.max_input_chars) {
    throw new Error(`input text too long (max ${config.max_input_chars})`);
  }

  const cacheKey = buildTranslateCacheKey({ config, sourceLang, targets, text });
  if (config.enable_cache) {
    const cached = translateCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return {
        translations: cached.value,
        checks: {
          json_parse: true,
          has_all_targets: true,
          no_source_lang: true,
        },
        cached: true,
      };
    }
  }

  let translations = {};
  let checks = {
    json_parse: true,
    has_all_targets: true,
    no_source_lang: true,
  };

  if (config.engine === "free") {
    for (const target of targets) {
      translations[target] = await freeTranslateOne(sourceLang, target, text, timeoutMs);
    }
  } else {
    if (config.ai_provider !== "right_code") {
      throw new Error(`unsupported ai provider: ${config.ai_provider}`);
    }

    const prompt = buildTranslationPrompt({ sourceLang, targets, text });
    const modelPayload = await rightCodeRequest(config, prompt);
    const modelText = extractResponseText(modelPayload);
    if (!modelText) {
      throw new Error("empty model output");
    }

    const parsed = parseJSONObject(modelText);
    if (!parsed) {
      throw new Error("failed to parse model JSON output");
    }

    const shaped = ensureTranslationShape(parsed, { sourceLang, targets });
    translations = shaped.result;
    checks = shaped.checks;
  }

  if (config.enable_cache) {
    translateCache.set(cacheKey, {
      value: translations,
      expiresAt: Date.now() + config.cache_ttl_ms,
    });
  }

  return {
    translations,
    checks,
    cached: false,
  };
}

function normalizeFields(rawFields) {
  if (!rawFields || typeof rawFields !== "object" || Array.isArray(rawFields)) {
    throw new Error("fields must be an object");
  }
  const pairs = Object.entries(rawFields)
    .map(([key, value]) => [String(key).trim(), typeof value === "string" ? value : `${value ?? ""}`])
    .filter(([key]) => key.length > 0);

  if (pairs.length === 0) {
    throw new Error("fields is empty");
  }
  return pairs;
}

async function handleTranslate(req, res, authHeader) {
  const rawBody = await readBody(req);
  const payload = parseJSON(rawBody);
  if (!payload) {
    return sendJSON(res, 400, { ok: false, error: "invalid JSON body" });
  }

  const sourceLang = normalizeLang(payload.source_lang);
  if (!sourceLang) {
    return sendJSON(res, 400, { ok: false, error: "invalid source_lang" });
  }

  const targets = normalizeTargets(sourceLang, payload.targets);
  if (targets.length === 0) {
    return sendJSON(res, 400, { ok: false, error: "no target languages" });
  }

  const fields = normalizeFields(payload.fields);
  const { config } = await loadTranslationConfig(authHeader);
  if (!config.enabled) {
    return sendJSON(res, 503, { ok: false, error: "translation is disabled" });
  }

  const startAt = Date.now();
  const translations = {};
  let anyCached = false;

  for (const [fieldName, text] of fields) {
    const result = await translateByConfig(config, {
      sourceLang,
      targets,
      text,
    });
    if (result.cached) anyCached = true;
    translations[fieldName] = result.translations;
  }

  return sendJSON(res, 200, {
    ok: true,
    translations,
    meta: {
      engine: config.engine,
      provider: config.engine === "ai" ? config.ai_provider : "free",
      endpoint: config.right_code_endpoint,
      model: config.right_code_model,
      cached: anyCached,
      duration_ms: Date.now() - startAt,
    },
  });
}

async function handleTranslateTest(req, res, authHeader) {
  const rawBody = await readBody(req);
  const payload = parseJSON(rawBody) || {};
  const sourceLang = normalizeLang(payload.source_lang || "zh");
  if (!sourceLang) {
    return sendJSON(res, 400, { ok: false, error: "invalid source_lang" });
  }

  const targets = normalizeTargets(sourceLang, payload.targets);
  const sampleText =
    typeof payload.sample_text === "string" && payload.sample_text.trim()
      ? payload.sample_text.trim()
      : DEFAULT_TEST_SAMPLE_TEXT;

  const overrideConfig =
    payload.override_config && typeof payload.override_config === "object"
      ? payload.override_config
      : null;

  const startAt = Date.now();
  try {
    const { config } = await loadTranslationConfig(authHeader, overrideConfig);
    if (!config.enabled) {
      return sendJSON(res, 200, {
        ok: false,
        connectivity_ok: false,
        structure_ok: false,
        error: "translation is disabled",
      });
    }

    const result = await translateByConfig(config, {
      sourceLang,
      targets,
      text: sampleText,
    });

    const hasAllTargets = result.checks?.has_all_targets !== false;
    const noSourceLang = result.checks?.no_source_lang !== false;
    const jsonParse = result.checks?.json_parse !== false;
    const structureOk = jsonParse && hasAllTargets && noSourceLang;

    return sendJSON(res, 200, {
      ok: structureOk,
      connectivity_ok: true,
      structure_ok: structureOk,
      result_preview: result.translations,
      checks: {
        json_parse: jsonParse,
        no_source_lang: noSourceLang,
        has_all_targets: hasAllTargets,
      },
      meta: {
        endpoint: config.right_code_endpoint,
        model: config.right_code_model,
        engine: config.engine,
        duration_ms: Date.now() - startAt,
      },
    });
  } catch (error) {
    logger.warn("translate test failed:", error?.message || error);
    return sendJSON(res, 200, {
      ok: false,
      connectivity_ok: false,
      structure_ok: false,
      error: error?.message || "translation test failed",
      checks: {
        json_parse: false,
        no_source_lang: false,
        has_all_targets: false,
      },
      meta: {
        duration_ms: Date.now() - startAt,
      },
    });
  }
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    return sendNoContent(res, 204);
  }

  const path = req.url?.split("?")[0] || "/";
  if (req.method === "GET" && path === "/healthz") {
    return sendJSON(res, 200, { ok: true });
  }

  const ip =
    req.headers["x-real-ip"] ||
    req.socket.remoteAddress ||
    "unknown";
  if (rateLimit(String(ip))) {
    return sendJSON(res, 429, { ok: false, error: "too many requests" });
  }

  const authHeader = getAuthHeader(req);
  const isAuthorized = await verifyPBAuth(authHeader);
  if (!isAuthorized) {
    return sendJSON(res, 401, { ok: false, error: "unauthorized" });
  }

  try {
    if (req.method === "POST" && path === "/admin/translate") {
      return await handleTranslate(req, res, authHeader);
    }
    if (req.method === "POST" && path === "/admin/translate/test") {
      return await handleTranslateTest(req, res, authHeader);
    }

    return sendJSON(res, 404, { ok: false, error: "not found" });
  } catch (error) {
    logger.error("Unhandled translate proxy error:", error?.message || error);
    return sendJSON(res, 500, {
      ok: false,
      error: error?.message || "internal server error",
    });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  logger.info(`AI translate proxy listening on 127.0.0.1:${PORT}`);
});
