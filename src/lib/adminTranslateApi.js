import pb from "./pocketbase";
import { createAppLogger } from "./appLogger";

const logger = createAppLogger("AdminTranslateAPI");
const API_BASE = "/ai-api/admin/translate";
const SUPPORTED_LANGS = ["zh", "en", "ja"];

function normalizeLang(lang) {
  const value = `${lang || ""}`.trim().toLowerCase();
  return SUPPORTED_LANGS.includes(value) ? value : "";
}

export function detectSourceLanguage(fieldValueMap) {
  if (!fieldValueMap || typeof fieldValueMap !== "object") return "";

  if (fieldValueMap.zh?.trim()) return "zh";
  if (fieldValueMap.en?.trim()) return "en";
  if (fieldValueMap.ja?.trim()) return "ja";
  return "";
}

export function getTargetLangs(sourceLang) {
  const source = normalizeLang(sourceLang);
  if (!source) return [];
  return SUPPORTED_LANGS.filter((lang) => lang !== source);
}

function ensureAuthHeader() {
  const token = pb.authStore.token;
  if (!token) {
    throw new Error("Not authenticated");
  }
  return `Bearer ${token}`;
}

async function callTranslateApi(path, payload) {
  const authHeader = ensureAuthHeader();
  const response = await fetch(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: authHeader,
    },
    body: JSON.stringify(payload),
  });

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const msg = data?.error || data?.message || `HTTP ${response.status}`;
    throw new Error(msg);
  }
  if (!data?.ok) {
    const msg = data?.error || "Translation API returned failed status";
    throw new Error(msg);
  }
  return data;
}

export async function requestAdminTranslation({
  scene = "admin",
  sourceLang,
  targets,
  fields,
}) {
  const source = normalizeLang(sourceLang);
  if (!source) {
    throw new Error("invalid source language");
  }
  if (!fields || typeof fields !== "object") {
    throw new Error("invalid fields");
  }

  const finalTargets = Array.isArray(targets) && targets.length
    ? targets.map((lang) => normalizeLang(lang)).filter(Boolean)
    : getTargetLangs(source);

  return callTranslateApi(API_BASE, {
    scene,
    source_lang: source,
    targets: finalTargets,
    fields,
  });
}

export async function testAdminTranslationConfig({
  sourceLang = "zh",
  targets,
  sampleText = "这是配置测试文本，请翻译。",
  overrideConfig,
}) {
  const source = normalizeLang(sourceLang) || "zh";
  const finalTargets = Array.isArray(targets) && targets.length
    ? targets.map((lang) => normalizeLang(lang)).filter(Boolean)
    : getTargetLangs(source);

  const authHeader = ensureAuthHeader();
  const response = await fetch(`${API_BASE}/test`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: authHeader,
    },
    body: JSON.stringify({
      source_lang: source,
      targets: finalTargets,
      sample_text: sampleText,
      override_config: overrideConfig || null,
      dry_run: true,
    }),
  });

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const msg = data?.error || data?.message || `HTTP ${response.status}`;
    throw new Error(msg);
  }
  if (!data) {
    throw new Error("Invalid test response");
  }
  if (!data.ok) {
    const message = data.error || "Translation configuration test failed";
    logger.warn("Translation config test failed:", message);
  }
  return data;
}
