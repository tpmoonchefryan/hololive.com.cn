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
  process.env.AI_TRANSLATE_DEFAULT_TIMEOUT_MS || "120000",
  10
);
const DEFAULT_JOB_TIMEOUT_MS = Number.parseInt(
  process.env.AI_TRANSLATE_DEFAULT_JOB_TIMEOUT_MS || "600000",
  10
);
const DEFAULT_MAX_RETRIES = Number.parseInt(
  process.env.AI_TRANSLATE_DEFAULT_MAX_RETRIES || "2",
  10
);
const DEFAULT_RETRY_BACKOFF_MS = Number.parseInt(
  process.env.AI_TRANSLATE_DEFAULT_RETRY_BACKOFF_MS || "600",
  10
);
const DEFAULT_JOB_CHUNK_CONCURRENCY = Number.parseInt(
  process.env.AI_TRANSLATE_DEFAULT_JOB_CHUNK_CONCURRENCY || "2",
  10
);
const DEFAULT_GLOBAL_JOB_CONCURRENCY = Number.parseInt(
  process.env.AI_TRANSLATE_DEFAULT_GLOBAL_JOB_CONCURRENCY || "2",
  10
);
const DEFAULT_CHUNK_SOFT_LIMIT = Number.parseInt(
  process.env.AI_TRANSLATE_DEFAULT_CHUNK_SOFT_LIMIT || "12000",
  10
);
const JOB_RESULT_TTL_MS = Number.parseInt(
  process.env.AI_TRANSLATE_JOB_RESULT_TTL_MS || "3600000",
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
const RATE_LIMIT_JOB_READ_MAX = Number.parseInt(
  process.env.AI_TRANSLATE_RATE_LIMIT_JOB_READ_MAX || "240",
  10
);
const RATE_LIMIT_JOB_WRITE_MAX = Number.parseInt(
  process.env.AI_TRANSLATE_RATE_LIMIT_JOB_WRITE_MAX || "60",
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
  request_timeout_ms: DEFAULT_REQUEST_TIMEOUT_MS,
  max_input_chars: 30000,
  fill_policy: "fill_empty_only",
  enable_cache: true,
  cache_ttl_ms: 1800000,
  job_timeout_ms: DEFAULT_JOB_TIMEOUT_MS,
  max_retries: DEFAULT_MAX_RETRIES,
  retry_backoff_ms: DEFAULT_RETRY_BACKOFF_MS,
  job_chunk_concurrency: DEFAULT_JOB_CHUNK_CONCURRENCY,
  global_job_concurrency: DEFAULT_GLOBAL_JOB_CONCURRENCY,
  chunk_soft_limit_chars: DEFAULT_CHUNK_SOFT_LIMIT,
};

function createAppError(code, message, extra = {}) {
  const error = new Error(message);
  error.code = code;
  if (extra && typeof extra === "object") {
    Object.assign(error, extra);
  }
  return error;
}

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
const translationJobs = new Map();
const queuedJobIds = [];
let activeJobCount = 0;
let jobSequence = 0;

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

  // Cleanup completed jobs
  for (const [jobId, job] of translationJobs) {
    const shouldKeep =
      !job ||
      !job.finished_at ||
      now - new Date(job.finished_at).getTime() <= JOB_RESULT_TTL_MS;
    if (!shouldKeep) {
      translationJobs.delete(jobId);
    }
  }
}, 300000);

function getRateLimitProfile(method, path) {
  if (typeof path === "string" && path.startsWith("/admin/translate/jobs")) {
    if (method === "GET") {
      return {
        scope: "job_read",
        limit: RATE_LIMIT_JOB_READ_MAX,
      };
    }
    return {
      scope: "job_write",
      limit: RATE_LIMIT_JOB_WRITE_MAX,
    };
  }
  return {
    scope: "default",
    limit: RATE_LIMIT_MAX,
  };
}

function rateLimit(ip, method, path) {
  const now = Date.now();
  const profile = getRateLimitProfile(method, path);
  const bucketKey = `${ip}::${profile.scope}`;
  let bucket = rateBuckets.get(bucketKey);
  if (!bucket || now - bucket.start > RATE_LIMIT_WINDOW_MS) {
    bucket = { start: now, count: 0 };
    rateBuckets.set(bucketKey, bucket);
  }
  bucket.count += 1;
  return bucket.count > profile.limit;
}

function createTranslationJobId() {
  jobSequence = (jobSequence + 1) % 1679616; // 36^4
  return `tr_job_${Date.now().toString(36)}_${jobSequence.toString(36).padStart(4, "0")}`;
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function clampInt(raw, fallback, min, max) {
  const value = Number.parseInt(`${raw || ""}`, 10);
  if (!Number.isFinite(value)) return fallback;
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function isTerminalJobStatus(status) {
  return [
    "succeeded",
    "partial_success",
    "failed",
    "canceled",
  ].includes(`${status || ""}`);
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

  cfg.request_timeout_ms = clampInt(
    cfg.request_timeout_ms,
    DEFAULT_TRANSLATION_CONFIG.request_timeout_ms,
    5000,
    600000
  );

  cfg.max_input_chars = clampInt(
    cfg.max_input_chars,
    DEFAULT_TRANSLATION_CONFIG.max_input_chars,
    100,
    300000
  );

  cfg.fill_policy =
    cfg.fill_policy === "overwrite_target" ? "overwrite_target" : "fill_empty_only";
  cfg.enable_cache = cfg.enable_cache !== false;

  cfg.cache_ttl_ms = clampInt(
    cfg.cache_ttl_ms,
    DEFAULT_TRANSLATION_CONFIG.cache_ttl_ms,
    1000,
    24 * 60 * 60 * 1000
  );

  cfg.job_timeout_ms = clampInt(
    cfg.job_timeout_ms,
    DEFAULT_TRANSLATION_CONFIG.job_timeout_ms,
    10000,
    30 * 60 * 1000
  );

  cfg.max_retries = clampInt(
    cfg.max_retries,
    DEFAULT_TRANSLATION_CONFIG.max_retries,
    0,
    5
  );

  cfg.retry_backoff_ms = clampInt(
    cfg.retry_backoff_ms,
    DEFAULT_TRANSLATION_CONFIG.retry_backoff_ms,
    100,
    10000
  );

  cfg.job_chunk_concurrency = clampInt(
    cfg.job_chunk_concurrency,
    DEFAULT_TRANSLATION_CONFIG.job_chunk_concurrency,
    1,
    6
  );

  cfg.global_job_concurrency = clampInt(
    cfg.global_job_concurrency,
    DEFAULT_TRANSLATION_CONFIG.global_job_concurrency,
    1,
    6
  );

  cfg.chunk_soft_limit_chars = clampInt(
    cfg.chunk_soft_limit_chars,
    DEFAULT_TRANSLATION_CONFIG.chunk_soft_limit_chars,
    200,
    cfg.max_input_chars
  );

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

  // Some providers may concatenate multiple JSON objects, e.g. {"en":"..."}{"en":"..."}.
  // Extract all balanced object candidates and return the first valid one.
  const objectCandidates = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let quote = "";
  let escaped = false;
  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (inString) {
      if (ch === quote) {
        inString = false;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      inString = true;
      quote = ch;
      continue;
    }
    if (ch === "{") {
      if (depth === 0) start = i;
      depth += 1;
      continue;
    }
    if (ch === "}") {
      if (depth > 0) {
        depth -= 1;
        if (depth === 0 && start >= 0) {
          objectCandidates.push(trimmed.slice(start, i + 1));
          start = -1;
        }
      }
    }
  }
  for (const candidate of objectCandidates) {
    const parsed = parseJSON(candidate);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed;
    }
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

function parseSSEPayload(rawText) {
  if (typeof rawText !== "string" || !rawText.includes("data:")) {
    return null;
  }

  const records = rawText.split(/\r?\n\r?\n/);
  const outputChunks = [];
  let completedResponse = null;
  let errorMessage = "";

  for (const record of records) {
    if (!record || !record.trim()) continue;
    const lines = record.split(/\r?\n/);
    const dataLines = lines.filter((line) => line.startsWith("data:"));
    if (dataLines.length === 0) continue;

    const data = dataLines
      .map((line) => line.slice(5).trimStart())
      .join("\n")
      .trim();
    if (!data || data === "[DONE]") continue;

    const event = parseJSON(data);
    if (!event || typeof event !== "object") continue;

    const type = `${event.type || ""}`;
    if (type === "response.output_text.delta" && typeof event.delta === "string") {
      outputChunks.push(event.delta);
      continue;
    }
    if (type === "response.output_text.done" && typeof event.text === "string") {
      outputChunks.push(event.text);
      continue;
    }
    if (type === "response.completed" && event.response && typeof event.response === "object") {
      completedResponse = event.response;
      continue;
    }
    if (type === "response.error" || type === "response.failed" || type === "error") {
      const message = event?.error?.message || event?.message;
      if (typeof message === "string" && message.trim()) {
        errorMessage = message.trim();
      }
    }
  }

  const outputText = outputChunks.join("").trim();
  if (completedResponse) {
    return {
      response: completedResponse,
      output: completedResponse.output,
      output_text:
        outputText ||
        (typeof completedResponse.output_text === "string"
          ? completedResponse.output_text
          : ""),
    };
  }

  if (outputText) {
    return { output_text: outputText };
  }

  if (errorMessage) {
    return { error: { message: errorMessage } };
  }

  return null;
}

function normalizeLangAlias(raw) {
  const value = `${raw || ""}`.trim().toLowerCase();
  if (!value) return "";
  if (["en", "english", "英文", "英语", "英語"].includes(value)) return "en";
  if (["ja", "japanese", "日文", "日语", "日語", "日本語"].includes(value)) return "ja";
  if (["zh", "chinese", "中文", "汉语", "漢語", "中国語"].includes(value)) return "zh";
  return "";
}

function parseLooseLanguageObject(text, targets) {
  if (typeof text !== "string") return null;
  const trimmed = text.trim();
  if (!trimmed) return null;

  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    const objectSlice = trimmed.slice(firstBrace, lastBrace + 1);
    const repaired = objectSlice
      .replace(/([{,]\s*)([A-Za-z_][A-Za-z0-9_-]*)(\s*:)/g, '$1"$2"$3')
      .replace(/'/g, '"')
      .replace(/,\s*([}\]])/g, "$1");
    const parsed = parseJSON(repaired);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed;
    }
  }

  const lines = trimmed.split(/\r?\n/);
  const map = {};
  for (const line of lines) {
    const match = line.match(/^\s*["'`]?([A-Za-z\u4e00-\u9fa5]+)["'`]?\s*[:：]\s*(.+?)\s*$/);
    if (!match) continue;
    const lang = normalizeLangAlias(match[1]);
    if (!lang) continue;
    if (!SUPPORTED_LANGS.includes(lang)) continue;
    map[lang] = match[2];
  }

  if (targets.every((lang) => typeof map[lang] === "string")) {
    return map;
  }

  return null;
}

function ensureTranslationShape(parsed, { sourceLang, targets }) {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw createAppError(
      "MODEL_PARSE_ERROR",
      "model output is not a valid JSON object"
    );
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
    throw createAppError(
      "MODEL_STRUCTURE_ERROR",
      "model output missing target languages",
      {
        checks: {
          json_parse: true,
          has_all_targets: false,
          no_source_lang: noSourceLang,
        },
      }
    );
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

function createFetchController({ timeoutMs, parentSignal, activeControllers }) {
  const controller = new AbortController();
  let timeoutHandle = null;

  const onAbort = () => {
    controller.abort(parentSignal?.reason || createAppError("JOB_CANCELED", "translation job canceled"));
  };
  if (parentSignal) {
    if (parentSignal.aborted) {
      onAbort();
    } else {
      parentSignal.addEventListener("abort", onAbort, { once: true });
    }
  }

  if (timeoutMs > 0) {
    timeoutHandle = setTimeout(() => {
      controller.abort(
        createAppError("REQUEST_TIMEOUT", `translation request timeout (${timeoutMs}ms)`)
      );
    }, timeoutMs);
  }

  if (activeControllers) {
    activeControllers.add(controller);
  }

  return {
    signal: controller.signal,
    cleanup() {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      if (parentSignal) parentSignal.removeEventListener("abort", onAbort);
      if (activeControllers) activeControllers.delete(controller);
    },
  };
}

function shouldRetryTranslationError(error) {
  if (!error) return false;
  if (error?.code === "JOB_CANCELED" || error?.code === "MODEL_STRUCTURE_ERROR") {
    return false;
  }
  if (error?.code === "REQUEST_TIMEOUT") {
    return true;
  }
  if (Number.isFinite(error?.http_status)) {
    return error.http_status === 429 || error.http_status >= 500;
  }
  const message = `${error?.message || ""}`.toLowerCase();
  return (
    message.includes("timeout") ||
    message.includes("timed out") ||
    message.includes("network") ||
    message.includes("econnreset") ||
    message.includes("socket hang up")
  );
}

async function withRetry(task, { maxRetries = 0, backoffMs = 600, signal, onRetry } = {}) {
  let attempt = 0;
  while (true) {
    if (signal?.aborted) {
      throw signal.reason || createAppError("JOB_CANCELED", "translation job canceled");
    }

    try {
      return await task(attempt);
    } catch (error) {
      if (signal?.aborted) {
        throw signal.reason || createAppError("JOB_CANCELED", "translation job canceled");
      }
      if (attempt >= maxRetries || !shouldRetryTranslationError(error)) {
        throw error;
      }
      attempt += 1;
      if (typeof onRetry === "function") {
        onRetry({ attempt, error });
      }
      const delay = Math.max(100, backoffMs) * attempt;
      await sleep(delay);
    }
  }
}

async function rightCodeRequest(config, prompt, options = {}) {
  const timeoutMs = Math.max(
    5000,
    options.timeoutMs || config.request_timeout_ms || DEFAULT_REQUEST_TIMEOUT_MS
  );
  const { signal: parentSignal, activeControllers } = options;
  const requestScope = createFetchController({
    timeoutMs,
    parentSignal,
    activeControllers,
  });

  try {
    if (!config.right_code_api_key) {
      throw createAppError("RIGHT_CODE_KEY_EMPTY", "Right Code API key is empty");
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

      let res;
      try {
        res = await fetch(endpoint, {
          method: "POST",
          signal: requestScope.signal,
          headers,
          body: JSON.stringify(body),
        });
      } catch (error) {
        if (requestScope.signal.aborted) {
          const reason = requestScope.signal.reason;
          if (reason?.code === "REQUEST_TIMEOUT") {
            throw reason;
          }
          throw createAppError("JOB_CANCELED", "translation job canceled");
        }
        throw error;
      }

      const rawText = await res.text();
      const payload = parseJSON(rawText);
      const ssePayload = payload ? null : parseSSEPayload(rawText);
      if (res.ok) {
        return payload || ssePayload || { output_text: rawText || "" };
      }

      const detail =
        payload?.error?.message ||
        payload?.message ||
        ssePayload?.error?.message ||
        `${rawText || ""}`.trim().slice(0, 300) ||
        "unknown error";
      lastError = createAppError(
        "RIGHT_CODE_HTTP_ERROR",
        `Right Code request failed: HTTP ${res.status} - ${detail}`,
        {
          http_status: res.status,
          auth_mode: authMode,
          response_excerpt: `${rawText || ""}`.trim().slice(0, 500),
        }
      );

      // If auth fails on first mode, try fallback mode.
      if ((res.status === 401 || res.status === 403) && authMode === "authorization") {
        logger.warn("Right Code authorization header failed, retrying with x-api-key.");
        continue;
      }

      throw lastError;
    }

    throw lastError || createAppError("RIGHT_CODE_UNKNOWN_ERROR", "Right Code request failed");
  } finally {
    requestScope.cleanup();
  }
}

async function freeTranslateOne(sourceLang, targetLang, text, timeoutMs, options = {}) {
  const langPair = `${encodeURIComponent(sourceLang)}|${encodeURIComponent(targetLang)}`;
  const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${langPair}`;

  const requestScope = createFetchController({
    timeoutMs,
    parentSignal: options.signal,
    activeControllers: options.activeControllers,
  });
  try {
    const res = await fetch(url, { signal: requestScope.signal });
    if (!res.ok) {
      throw createAppError("FREE_TRANSLATE_HTTP_ERROR", `free translate failed: HTTP ${res.status}`, {
        http_status: res.status,
      });
    }
    const data = await res.json();
    const translated = data?.responseData?.translatedText;
    if (typeof translated === "string") {
      return translated;
    }
    return "";
  } catch (error) {
    if (requestScope.signal.aborted) {
      const reason = requestScope.signal.reason;
      if (reason?.code === "REQUEST_TIMEOUT") {
        throw reason;
      }
      throw createAppError("JOB_CANCELED", "translation job canceled");
    }
    throw error;
  } finally {
    requestScope.cleanup();
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

async function translateByConfig(config, { sourceLang, targets, text }, options = {}) {
  const timeoutMs = Math.max(
    5000,
    options.timeoutMs || config.request_timeout_ms || DEFAULT_REQUEST_TIMEOUT_MS
  );

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
      translations[target] = await freeTranslateOne(sourceLang, target, text, timeoutMs, options);
    }
  } else {
    if (config.ai_provider !== "right_code") {
      throw new Error(`unsupported ai provider: ${config.ai_provider}`);
    }

    const prompt = buildTranslationPrompt({ sourceLang, targets, text });
    const modelPayload = await rightCodeRequest(config, prompt, options);
    const modelText = extractResponseText(modelPayload);
    if (!modelText) {
      throw createAppError("MODEL_EMPTY_OUTPUT", "empty model output");
    }

    let parsed = parseJSONObject(modelText);
    if (!parsed) {
      parsed = parseLooseLanguageObject(modelText, targets);
    }
    if (!parsed) {
      throw createAppError(
        "MODEL_PARSE_ERROR",
        "failed to parse model JSON output",
        {
          output_excerpt: modelText.slice(0, 500),
          checks: {
            json_parse: false,
            has_all_targets: false,
            no_source_lang: false,
          },
        }
      );
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

function countFieldUnits(fields, targets) {
  let totalUnits = 0;
  for (const [, text] of fields) {
    const normalized = typeof text === "string" ? text : `${text ?? ""}`;
    if (!normalized.trim()) continue;
    totalUnits += targets.length;
  }
  return totalUnits;
}

async function translateFieldAsSingleRequest(
  config,
  { sourceLang, targets, text, fieldName },
  options = {}
) {
  const normalizedText = typeof text === "string" ? text : `${text ?? ""}`;
  if (options.signal?.aborted) {
    throw options.signal.reason || createAppError("JOB_CANCELED", "translation job canceled");
  }
  const result = await withRetry(
    () =>
      translateByConfig(
        config,
        { sourceLang, targets, text: normalizedText },
        {
          signal: options.signal,
          activeControllers: options.activeControllers,
          timeoutMs: options.timeoutMs,
        }
      ),
    {
      maxRetries: config.max_retries,
      backoffMs: config.retry_backoff_ms,
      signal: options.signal,
      onRetry: ({ attempt, error }) => {
        if (typeof options.onRetry === "function") {
          options.onRetry({ attempt, error, fieldName, chunkIndex: 0 });
        }
      },
    }
  );

  if (typeof options.onChunkDone === "function") {
    options.onChunkDone({
      fieldName,
      chunkIndex: 0,
      chunkCount: 1,
      doneUnitsDelta: targets.length,
      currentTarget: targets.join(","),
    });
  }

  return {
    translations: result.translations,
    checks: result.checks,
    cached: result.cached,
    chunk_count: 1,
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

function nowISO() {
  return new Date().toISOString();
}

function getElapsedMs(startedAt, finishedAt) {
  if (!startedAt) return 0;
  const start = new Date(startedAt).getTime();
  if (!Number.isFinite(start)) return 0;
  const end = finishedAt
    ? new Date(finishedAt).getTime()
    : Date.now();
  if (!Number.isFinite(end)) return 0;
  return Math.max(0, end - start);
}

function computePercent(doneUnits, totalUnits) {
  if (!totalUnits || totalUnits <= 0) {
    return doneUnits > 0 ? 100 : 0;
  }
  return Math.min(100, Math.max(0, Math.round((doneUnits / totalUnits) * 100)));
}

function createEmptyLangMap(targets) {
  const value = {};
  for (const target of targets) value[target] = "";
  return value;
}

function getActiveGlobalConcurrency() {
  let limit = DEFAULT_GLOBAL_JOB_CONCURRENCY;
  for (const job of translationJobs.values()) {
    if (!job) continue;
    if (["queued", "running", "canceling"].includes(job.status)) {
      const cfgLimit = Number.parseInt(`${job.config_snapshot?.global_job_concurrency || ""}`, 10);
      if (Number.isFinite(cfgLimit) && cfgLimit > limit) {
        limit = cfgLimit;
      }
    }
  }
  return Math.max(1, limit);
}

function markJobFinished(job, status, error = null) {
  const finishedAt = nowISO();
  job.status = status;
  job.finished_at = finishedAt;
  job.updated_at = finishedAt;
  job.progress.current_stage = status;
  if (status === "succeeded" || status === "partial_success") {
    job.progress.done_units = job.progress.total_units;
    job.progress.percent = 100;
  } else {
    job.progress.percent = computePercent(
      job.progress.done_units,
      job.progress.total_units
    );
  }
  job.error = error
    ? {
        code: error?.code || "UNKNOWN",
        message: error?.message || `${error}`,
      }
    : null;
}

function serializeJob(job) {
  if (!job) return null;
  return {
    id: job.id,
    scene: job.scene,
    source_lang: job.source_lang,
    targets: job.targets,
    status: job.status,
    progress: {
      total_units: job.progress.total_units,
      done_units: job.progress.done_units,
      percent: job.progress.percent,
      current_stage: job.progress.current_stage,
      current_field: job.progress.current_field,
      current_target: job.progress.current_target,
    },
    timing: {
      created_at: job.created_at,
      started_at: job.started_at,
      finished_at: job.finished_at,
      elapsed_ms: getElapsedMs(job.started_at, job.finished_at),
    },
    partial_result: job.partial_result,
    error: job.error,
    errors: job.errors,
    meta: {
      engine: job.meta.engine,
      provider: job.meta.provider,
      endpoint: job.meta.endpoint,
      model: job.meta.model,
      retry_count: job.meta.retry_count,
      chunk_failures: job.meta.chunk_failures,
    },
  };
}

function requestCancelJob(job) {
  if (!job || isTerminalJobStatus(job.status)) {
    return false;
  }
  job.cancel_requested = true;
  job.updated_at = nowISO();

  if (job.status === "queued") {
    markJobFinished(job, "canceled", createAppError("JOB_CANCELED", "translation job canceled"));
    return true;
  }

  if (job.status === "running") {
    job.status = "canceling";
    job.progress.current_stage = "canceling";
  }

  const reason = createAppError("JOB_CANCELED", "translation job canceled");
  if (!job.abort_controller.signal.aborted) {
    job.abort_controller.abort(reason);
  }
  for (const controller of job.active_controllers) {
    try {
      controller.abort(reason);
    } catch {
      // ignore
    }
  }
  return true;
}

async function executeTranslationJob(job) {
  if (!job || isTerminalJobStatus(job.status)) return;
  if (job.cancel_requested || job.abort_controller.signal.aborted) {
    markJobFinished(
      job,
      "canceled",
      createAppError("JOB_CANCELED", "translation job canceled")
    );
    return;
  }

  const startedAt = nowISO();
  job.started_at = startedAt;
  job.updated_at = startedAt;
  job.status = "running";
  job.progress.current_stage = "running";

  const jobTimeoutHandle = setTimeout(() => {
    if (isTerminalJobStatus(job.status)) return;
    const timeoutError = createAppError(
      "JOB_TIMEOUT",
      `translation job timeout (${job.config_snapshot.job_timeout_ms}ms)`
    );
    job.cancel_requested = true;
    job.status = "canceling";
    job.progress.current_stage = "canceling";
    job.abort_controller.abort(timeoutError);
  }, job.config_snapshot.job_timeout_ms);

  try {
    const fields = job.fields;
    const translations = {};
    for (const [fieldName, text] of fields) {
      if (job.abort_controller.signal.aborted) {
        throw job.abort_controller.signal.reason;
      }

      const normalizedText = typeof text === "string" ? text : `${text ?? ""}`;
      if (!normalizedText.trim()) {
        translations[fieldName] = createEmptyLangMap(job.targets);
        job.partial_result[fieldName] = translations[fieldName];
        continue;
      }

      try {
        const result = await translateFieldAsSingleRequest(
          job.config_snapshot,
          {
            sourceLang: job.source_lang,
            targets: job.targets,
            text: normalizedText,
            fieldName,
          },
          {
            signal: job.abort_controller.signal,
            activeControllers: job.active_controllers,
            timeoutMs: job.config_snapshot.request_timeout_ms,
            onRetry: () => {
              job.meta.retry_count += 1;
              job.updated_at = nowISO();
            },
            onChunkDone: ({ doneUnitsDelta, currentTarget }) => {
              job.progress.done_units += doneUnitsDelta;
              job.progress.percent = computePercent(
                job.progress.done_units,
                job.progress.total_units
              );
              job.progress.current_stage = "translating";
              job.progress.current_field = fieldName;
              job.progress.current_target = currentTarget;
              job.updated_at = nowISO();
            },
          }
        );

        translations[fieldName] = result.translations;
        job.partial_result[fieldName] = result.translations;
      } catch (error) {
        if (job.abort_controller.signal.aborted || error?.code === "JOB_CANCELED") {
          throw error;
        }
        job.meta.chunk_failures += 1;
        job.errors.push({
          field: fieldName,
          code: error?.code || "FIELD_TRANSLATE_ERROR",
          message: error?.message || `${error}`,
        });
        const empty = createEmptyLangMap(job.targets);
        translations[fieldName] = empty;
        job.partial_result[fieldName] = empty;
      }
    }

    job.translations = translations;
    if (job.errors.length > 0) {
      markJobFinished(job, "partial_success");
    } else {
      markJobFinished(job, "succeeded");
    }
  } catch (error) {
    if (error?.code === "JOB_TIMEOUT") {
      markJobFinished(job, "failed", error);
      return;
    }
    if (job.abort_controller.signal.aborted || error?.code === "JOB_CANCELED") {
      markJobFinished(job, "canceled", error || job.abort_controller.signal.reason);
      return;
    }
    if (Object.keys(job.partial_result).length > 0) {
      job.errors.push({
        field: job.progress.current_field || "unknown",
        code: error?.code || "JOB_PARTIAL_FAILURE",
        message: error?.message || `${error}`,
      });
      markJobFinished(job, "partial_success", error);
      return;
    }
    markJobFinished(job, "failed", error);
  } finally {
    clearTimeout(jobTimeoutHandle);
  }
}

function pumpTranslationJobs() {
  const limit = getActiveGlobalConcurrency();
  while (activeJobCount < limit && queuedJobIds.length > 0) {
    const jobId = queuedJobIds.shift();
    if (!jobId) continue;
    const job = translationJobs.get(jobId);
    if (!job || job.status !== "queued") continue;
    activeJobCount += 1;
    executeTranslationJob(job)
      .catch((error) => {
        logger.error("translation job execute failed:", error?.message || error);
        if (!isTerminalJobStatus(job.status)) {
          markJobFinished(job, "failed", error);
        }
      })
      .finally(() => {
        activeJobCount = Math.max(0, activeJobCount - 1);
        pumpTranslationJobs();
      });
  }
}

function createTranslationJob({ scene, sourceLang, targets, fields, config }) {
  const createdAt = nowISO();
  const totalUnits = countFieldUnits(fields, targets);
  const job = {
    id: createTranslationJobId(),
    scene: scene || "admin",
    source_lang: sourceLang,
    targets,
    fields,
    config_snapshot: config,
    status: "queued",
    created_at: createdAt,
    started_at: null,
    finished_at: null,
    updated_at: createdAt,
    cancel_requested: false,
    abort_controller: new AbortController(),
    active_controllers: new Set(),
    progress: {
      total_units: totalUnits,
      done_units: 0,
      percent: 0,
      current_stage: "queued",
      current_field: "",
      current_target: "",
    },
    partial_result: {},
    translations: {},
    errors: [],
    error: null,
    meta: {
      engine: config.engine,
      provider: config.engine === "ai" ? config.ai_provider : "free",
      endpoint: config.right_code_endpoint,
      model: config.right_code_model,
      retry_count: 0,
      chunk_failures: 0,
    },
  };
  translationJobs.set(job.id, job);
  queuedJobIds.push(job.id);
  pumpTranslationJobs();
  return job;
}

async function handleCreateTranslateJob(req, res, authHeader) {
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

  let fields;
  try {
    fields = normalizeFields(payload.fields);
  } catch (error) {
    return sendJSON(res, 400, { ok: false, error: error?.message || "invalid fields" });
  }

  const { config } = await loadTranslationConfig(authHeader);
  if (!config.enabled) {
    return sendJSON(res, 503, { ok: false, error: "translation is disabled" });
  }

  const job = createTranslationJob({
    scene: `${payload.scene || "admin"}`.slice(0, 120),
    sourceLang,
    targets,
    fields,
    config,
  });

  return sendJSON(res, 200, {
    ok: true,
    job_id: job.id,
    status: job.status,
    progress: {
      total_units: job.progress.total_units,
      done_units: job.progress.done_units,
      percent: job.progress.percent,
    },
  });
}

function parseJobPath(path) {
  const baseMatch = path.match(/^\/admin\/translate\/jobs\/([^/]+)$/);
  if (baseMatch) {
    return {
      jobId: decodeURIComponent(baseMatch[1]),
      action: "status",
    };
  }
  const actionMatch = path.match(/^\/admin\/translate\/jobs\/([^/]+)\/(cancel|result)$/);
  if (actionMatch) {
    return {
      jobId: decodeURIComponent(actionMatch[1]),
      action: actionMatch[2],
    };
  }
  return null;
}

async function handleGetTranslateJob(res, jobId) {
  const job = translationJobs.get(jobId);
  if (!job) {
    return sendJSON(res, 404, { ok: false, error: "job not found" });
  }
  return sendJSON(res, 200, {
    ok: true,
    job: serializeJob(job),
  });
}

async function handleCancelTranslateJob(res, jobId) {
  const job = translationJobs.get(jobId);
  if (!job) {
    return sendJSON(res, 404, { ok: false, error: "job not found" });
  }
  requestCancelJob(job);
  return sendJSON(res, 200, {
    ok: true,
    job_id: job.id,
    status: job.status,
  });
}

async function handleGetTranslateJobResult(res, jobId) {
  const job = translationJobs.get(jobId);
  if (!job) {
    return sendJSON(res, 404, { ok: false, error: "job not found" });
  }

  if (!isTerminalJobStatus(job.status)) {
    return sendJSON(res, 409, {
      ok: false,
      error: "job is not completed",
      status: job.status,
      job: serializeJob(job),
    });
  }

  return sendJSON(res, 200, {
    ok: job.status === "succeeded" || job.status === "partial_success",
    status: job.status,
    translations: job.translations,
    partial_result: job.partial_result,
    errors: job.errors,
    error: job.error,
    meta: {
      engine: job.meta.engine,
      provider: job.meta.provider,
      endpoint: job.meta.endpoint,
      model: job.meta.model,
      duration_ms: getElapsedMs(job.started_at, job.finished_at),
      retry_count: job.meta.retry_count,
      chunk_failures: job.meta.chunk_failures,
    },
  });
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
    const result = await translateFieldAsSingleRequest(
      config,
      {
        sourceLang,
        targets,
        text,
        fieldName,
      },
      {}
    );
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
    const connectivityOk =
      error?.code === "MODEL_PARSE_ERROR" ||
      error?.code === "MODEL_STRUCTURE_ERROR" ||
      error?.code === "MODEL_EMPTY_OUTPUT";
    const checks = error?.checks || {
      json_parse: false,
      no_source_lang: false,
      has_all_targets: false,
    };

    return sendJSON(res, 200, {
      ok: false,
      connectivity_ok: connectivityOk,
      structure_ok: false,
      error: error?.message || "translation test failed",
      checks,
      output_excerpt: error?.output_excerpt || error?.response_excerpt || "",
      meta: {
        code: error?.code || "UNKNOWN",
        http_status: error?.http_status || null,
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
  if (rateLimit(String(ip), req.method || "GET", path)) {
    return sendJSON(res, 429, { ok: false, error: "too many requests" });
  }

  const authHeader = getAuthHeader(req);
  const isAuthorized = await verifyPBAuth(authHeader);
  if (!isAuthorized) {
    return sendJSON(res, 401, { ok: false, error: "unauthorized" });
  }

  try {
    if (req.method === "POST" && path === "/admin/translate/jobs") {
      return await handleCreateTranslateJob(req, res, authHeader);
    }
    const jobRoute = parseJobPath(path);
    if (jobRoute) {
      if (req.method === "GET" && jobRoute.action === "status") {
        return await handleGetTranslateJob(res, jobRoute.jobId);
      }
      if (req.method === "POST" && jobRoute.action === "cancel") {
        return await handleCancelTranslateJob(res, jobRoute.jobId);
      }
      if (req.method === "GET" && jobRoute.action === "result") {
        return await handleGetTranslateJobResult(res, jobRoute.jobId);
      }
      return sendJSON(res, 405, { ok: false, error: "method not allowed" });
    }

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
