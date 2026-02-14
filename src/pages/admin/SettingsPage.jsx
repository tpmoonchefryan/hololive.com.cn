import { useCallback, useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import { Save, Loader2, Settings, AlertTriangle } from "lucide-react";
import pb from "../../lib/pocketbase";
import { logSystemSettings } from "../../lib/logger";
import { useTranslation } from "react-i18next";
import { useUIFeedback } from "../../hooks/useUIFeedback";
import { createAppLogger } from "../../lib/appLogger";
import Modal from "../../components/admin/ui/Modal";
import { testAdminTranslationConfig } from "../../lib/adminTranslateApi";

const SETTINGS_ID = "1"; // 单例模式，固定 ID
const DEFAULT_TRANSLATION_TEST_TEXT = "这是配置测试文本，请翻译。";
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

function normalizeTranslationConfig(raw = {}) {
  const normalizedApiKey = `${raw?.right_code_api_key || ""}`
    .trim()
    .replace(/^Bearer\s+/i, "");
  return {
    ...DEFAULT_TRANSLATION_CONFIG,
    ...raw,
    enabled: raw?.enabled !== false,
    engine: raw?.engine === "ai" ? "ai" : "free",
    ai_provider: raw?.ai_provider === "right_code" ? "right_code" : "right_code",
    right_code_base_url: `${raw?.right_code_base_url || DEFAULT_TRANSLATION_CONFIG.right_code_base_url}`.replace(/\/$/, ""),
    right_code_api_key: normalizedApiKey,
    right_code_model: `${raw?.right_code_model || DEFAULT_TRANSLATION_CONFIG.right_code_model}`,
    right_code_endpoint:
      raw?.right_code_endpoint === "chat_completions" ? "chat_completions" : "responses",
    request_timeout_ms: Number.isFinite(Number(raw?.request_timeout_ms))
      ? Number(raw.request_timeout_ms)
      : DEFAULT_TRANSLATION_CONFIG.request_timeout_ms,
    max_input_chars: Number.isFinite(Number(raw?.max_input_chars))
      ? Number(raw.max_input_chars)
      : DEFAULT_TRANSLATION_CONFIG.max_input_chars,
    fill_policy:
      raw?.fill_policy === "overwrite_target" ? "overwrite_target" : "fill_empty_only",
    enable_cache: raw?.enable_cache !== false,
    cache_ttl_ms: Number.isFinite(Number(raw?.cache_ttl_ms))
      ? Number(raw.cache_ttl_ms)
      : DEFAULT_TRANSLATION_CONFIG.cache_ttl_ms,
  };
}

function normalizeTranslationConfigForSave(raw = {}) {
  const normalized = normalizeTranslationConfig(raw);
  const normalizedApiKey = `${normalized.right_code_api_key || ""}`
    .trim()
    .replace(/^Bearer\s+/i, "");
  return {
    enabled: normalized.enabled !== false,
    engine: normalized.engine === "ai" ? "ai" : "free",
    ai_provider: "right_code",
    right_code_base_url: `${normalized.right_code_base_url || DEFAULT_TRANSLATION_CONFIG.right_code_base_url}`.replace(/\/$/, ""),
    right_code_api_key: normalizedApiKey,
    right_code_model: `${normalized.right_code_model || DEFAULT_TRANSLATION_CONFIG.right_code_model}`.trim() || DEFAULT_TRANSLATION_CONFIG.right_code_model,
    right_code_endpoint:
      normalized.right_code_endpoint === "chat_completions" ? "chat_completions" : "responses",
    request_timeout_ms: Math.max(
      1000,
      Number.parseInt(`${normalized.request_timeout_ms || DEFAULT_TRANSLATION_CONFIG.request_timeout_ms}`, 10) || DEFAULT_TRANSLATION_CONFIG.request_timeout_ms
    ),
    max_input_chars: Math.max(
      100,
      Number.parseInt(`${normalized.max_input_chars || DEFAULT_TRANSLATION_CONFIG.max_input_chars}`, 10) || DEFAULT_TRANSLATION_CONFIG.max_input_chars
    ),
    fill_policy:
      normalized.fill_policy === "overwrite_target" ? "overwrite_target" : "fill_empty_only",
    enable_cache: normalized.enable_cache !== false,
    cache_ttl_ms: Math.max(
      1000,
      Number.parseInt(`${normalized.cache_ttl_ms || DEFAULT_TRANSLATION_CONFIG.cache_ttl_ms}`, 10) || DEFAULT_TRANSLATION_CONFIG.cache_ttl_ms
    ),
  };
}

/**
 * 系统设置页面
 * 管理全局系统配置
 */
const logger = createAppLogger("SettingsPage");

export default function SettingsPage() {
  const { t } = useTranslation();
  const { notify, confirm } = useUIFeedback();
  const { adminKey } = useParams();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [settings, setSettings] = useState(null);
  const [translationConfigId, setTranslationConfigId] = useState("");
  const [showKeyWarning, setShowKeyWarning] = useState(false);
  const [pendingUpdate, setPendingUpdate] = useState(null);
  const [pendingTranslationUpdate, setPendingTranslationUpdate] = useState(null);
  const [testingTranslation, setTestingTranslation] = useState(false);
  const [translationTestText, setTranslationTestText] = useState(DEFAULT_TRANSLATION_TEST_TEXT);
  const [translationTestResult, setTranslationTestResult] = useState(null);

  // 表单状态
  const [formData, setFormData] = useState({
    microsoft_auth_config: {},
    analytics_config: {
      google: "",
      baidu: "",
    },
    admin_entrance_key: "",
    enable_pb_public_entry: true,
    translation_config: { ...DEFAULT_TRANSLATION_CONFIG },
  });
  const [baiduExtractToast, setBaiduExtractToast] = useState(false);

  // 获取系统设置
  const fetchSettings = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      let settingsData = null;
      try {
        settingsData = await pb.collection("system_settings").getOne(SETTINGS_ID);
      } catch (err) {
        if (err?.status !== 404) {
          throw err;
        }
      }

      let translationRecord = null;
      try {
        const result = await pb.collection("translation_config").getList(1, 1, {
          sort: "-updated",
        });
        translationRecord = result?.items?.[0] || null;
      } catch (err) {
        const message = `${err?.response?.message || err?.message || ""}`.toLowerCase();
        const missingCollectionContext =
          err?.status === 404 && message.includes("missing collection context");
        if (err?.status !== 404 && !missingCollectionContext) {
          throw err;
        }
        logger.warn("translation_config is unavailable, fallback to defaults.");
      }

      setSettings(settingsData);
      setTranslationConfigId(translationRecord?.id || "");
      setFormData({
        microsoft_auth_config: settingsData?.microsoft_auth_config || {},
        analytics_config: settingsData?.analytics_config || { google: "", baidu: "" },
        admin_entrance_key: settingsData?.admin_entrance_key || "",
        enable_pb_public_entry: settingsData?.enable_pb_public_entry !== false,
        translation_config: normalizeTranslationConfig(translationRecord || {}),
      });
    } catch (error) {
      logger.error("Failed to fetch settings:", error);
      // 如果记录不存在，使用默认值
      if (error?.status === 404) {
        setSettings(null);
        setTranslationConfigId("");
        setFormData({
          microsoft_auth_config: {},
          analytics_config: { google: "", baidu: "" },
          admin_entrance_key: "",
          enable_pb_public_entry: true,
          translation_config: { ...DEFAULT_TRANSLATION_CONFIG },
        });
      } else {
        setError(t("admin.settingsPage.error"));
        notify(
          `${t("admin.settingsPage.errorLoadPrefix")}: ${error?.message || t("admin.settingsPage.unknownError")}`,
          "error"
        );
      }
    } finally {
      setLoading(false);
    }
  }, [t, notify]);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  // 检查当前 URL 中的 Key 是否与数据库中的 Key 一致
  useEffect(() => {
    if (!settings || !settings.admin_entrance_key) return;

    const dbKey = settings.admin_entrance_key;
    if (adminKey === dbKey) return;

    const currentUrl = window.location.href;
    const newUrl = currentUrl.replace(`/${adminKey}/`, `/${dbKey}/`);

    const checkMismatch = async () => {
      const accepted = await confirm({
        title: t("admin.settingsPage.modal.title"),
        message: `${t("admin.settingsPage.modal.desc")}\n\n${t("admin.settingsPage.modal.dbKey")} ${dbKey}\n${t("admin.settingsPage.modal.currentKey")} ${adminKey}\n\n${t("admin.settingsPage.modal.newUrl")} ${newUrl}`,
        confirmText: t("admin.settingsPage.modal.confirm"),
        cancelText: t("admin.settingsPage.modal.cancel"),
      });
      if (accepted) {
        window.location.href = newUrl;
      }
    };

    checkMismatch();
  }, [settings, adminKey, t, confirm]);

  const patchTranslationConfig = (patch) => {
    setFormData((prev) => ({
      ...prev,
      translation_config: {
        ...prev.translation_config,
        ...patch,
      },
    }));
  };

  const saveTranslationConfig = async (updateData) => {
    if (!updateData || typeof updateData !== "object") return;

    try {
      if (translationConfigId) {
        await pb.collection("translation_config").update(translationConfigId, updateData);
        return;
      }

      const list = await pb.collection("translation_config").getList(1, 1, {
        sort: "-updated",
      });
      const existing = list?.items?.[0];
      if (existing?.id) {
        await pb.collection("translation_config").update(existing.id, updateData);
        setTranslationConfigId(existing.id);
        return;
      }

      const created = await pb.collection("translation_config").create(updateData);
      if (created?.id) {
        setTranslationConfigId(created.id);
      }
    } catch (error) {
      const message = `${error?.response?.message || error?.message || ""}`.toLowerCase();
      const missingCollectionContext =
        error?.status === 404 && message.includes("missing collection context");
      if (error?.status === 404 || missingCollectionContext) {
        throw new Error(t("admin.settingsPage.translation.errors.collectionMissing"), {
          cause: error,
        });
      }
      throw error;
    }
  };

  const saveSettings = async (updateData, translationUpdateData, keyChanged) => {
    setSaving(true);
    setError(null);

    try {
      // 先尝试更新，如果不存在再创建
      try {
        await pb.collection("system_settings").update(SETTINGS_ID, updateData);
      } catch (err) {
        if (err?.status === 404) {
          await pb.collection("system_settings").create({
            id: SETTINGS_ID,
            ...updateData,
          });
        } else {
          throw err;
        }
      }

      // 保存翻译配置（单例）
      await saveTranslationConfig(translationUpdateData);

      // 记录系统设置更新日志
      const logDetails = keyChanged
        ? `Updated Admin Key: ${settings?.admin_entrance_key || "Unknown"} → ${updateData.admin_entrance_key}`
        : "Updated System Settings";
      await logSystemSettings(logDetails);

      // 如果 Key 改变了，直接跳转到新地址
      if (keyChanged) {
        const newKey = updateData.admin_entrance_key;
        const newUrl = `/${newKey}/webadmin/settings`;
        window.location.href = newUrl;
        return;
      }

      await fetchSettings();
      notify(t("admin.settingsPage.success"), "success");
    } catch (error) {
      logger.error("Failed to save settings:", error);
      const errorMsg =
        error?.response?.message || error?.message || t("admin.settingsPage.error");
      setError(errorMsg);
      notify(`${t("admin.settingsPage.error")}: ${errorMsg}`, "error");
    } finally {
      setSaving(false);
    }
  };

  const handleTestTranslation = async () => {
    try {
      setTestingTranslation(true);
      setTranslationTestResult(null);

      const overrideConfig = normalizeTranslationConfigForSave(formData.translation_config);
      const result = await testAdminTranslationConfig({
        sourceLang: "zh",
        targets: ["en", "ja"],
        sampleText: translationTestText || DEFAULT_TRANSLATION_TEST_TEXT,
        overrideConfig,
      });

      setTranslationTestResult(result);
      if (result?.ok) {
        notify(t("admin.settingsPage.translation.test.success"), "success");
      } else {
        notify(
          `${t("admin.settingsPage.translation.test.failed")}: ${result?.error || t("admin.settingsPage.unknownError")}`,
          "error"
        );
      }
    } catch (error) {
      logger.error("Failed to test translation config:", error);
      const errorMsg =
        error?.response?.message ||
        error?.message ||
        t("admin.settingsPage.translation.test.failed");
      setTranslationTestResult({
        ok: false,
        connectivity_ok: false,
        structure_ok: false,
        error: errorMsg,
      });
      notify(`${t("admin.settingsPage.translation.test.failed")}: ${errorMsg}`, "error");
    } finally {
      setTestingTranslation(false);
    }
  };

  // 保存设置（含 Key 修改前置检查）
  const handleSave = async (e) => {
    e.preventDefault();
    const normalizedKey = formData.admin_entrance_key.trim();

    if (normalizedKey.length < 8) {
      setError(t("admin.settingsPage.validation.keyTooShort"));
      return;
    }

    if (normalizedKey === "secret-admin-entrance") {
      setError(t("admin.settingsPage.validation.weakKey"));
      return;
    }

    const updateData = {
      analytics_config: {
        google: formData.analytics_config.google?.trim() || "",
        baidu: formData.analytics_config.baidu?.trim() || "",
      },
      admin_entrance_key: normalizedKey,
      enable_pb_public_entry: formData.enable_pb_public_entry !== false,
    };
    const translationUpdateData = normalizeTranslationConfigForSave(
      formData.translation_config
    );

    // 检查 admin_entrance_key 是否改变
    const keyChanged =
      settings && settings.admin_entrance_key !== updateData.admin_entrance_key;

    if (keyChanged) {
      // 触发自定义红色警告模态，而不是直接保存
      setPendingUpdate(updateData);
      setPendingTranslationUpdate(translationUpdateData);
      setShowKeyWarning(true);
      return;
    }

    await saveSettings(updateData, translationUpdateData, false);
  };

  return (
    <div className="space-y-4">
      {/* Key 修改警告模态框 */}
      <Modal
        isOpen={Boolean(showKeyWarning && pendingUpdate)}
        onClose={() => {
          setShowKeyWarning(false);
          setPendingUpdate(null);
          setPendingTranslationUpdate(null);
        }}
        title={t("admin.settingsPage.modal.title")}
        size="md"
      >
        <div className="space-y-4 px-6 py-5">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-red-600 mt-0.5 flex-shrink-0" />
            <div className="min-w-0">
              <p className="text-xs md:text-sm text-red-700 mb-2">
                {t("admin.settingsPage.modal.desc")}
              </p>
              <div className="mt-2 rounded-lg bg-red-50 border border-red-100 px-3 py-2 text-[11px] md:text-xs text-red-800 space-y-1">
                <p className="break-words">
                  {t("admin.settingsPage.modal.currentKey")}
                  <code className="px-1 rounded bg-white border border-red-100">
                    {adminKey}
                  </code>
                </p>
                {settings?.admin_entrance_key && (
                  <p className="break-words">
                    {t("admin.settingsPage.modal.dbKey")}
                    <code className="px-1 rounded bg-white border border-red-100">
                      {settings.admin_entrance_key}
                    </code>
                  </p>
                )}
                <p className="break-words">
                  {t("admin.settingsPage.modal.newKey")}
                  <code className="px-1 rounded bg-white border border-red-100">
                    {pendingUpdate?.admin_entrance_key || ""}
                  </code>
                </p>
                <p className="break-words">
                  {t("admin.settingsPage.modal.newUrl")}
                  <code className="px-1 rounded bg-white border border-red-100">
                    /{pendingUpdate?.admin_entrance_key || ""}/webadmin
                  </code>
                </p>
              </div>
            </div>
          </div>
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setShowKeyWarning(false);
                setPendingUpdate(null);
                setPendingTranslationUpdate(null);
              }}
              className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 transition-colors"
            >
              {t("admin.settingsPage.modal.cancel")}
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() =>
                pendingUpdate &&
                saveSettings(pendingUpdate, pendingTranslationUpdate, true)
              }
              className="inline-flex items-center gap-1.5 rounded-full bg-red-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
            >
              {saving && (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              )}
              {t("admin.settingsPage.modal.confirm")}
            </button>
          </div>
        </div>
      </Modal>

      {loading ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center shadow-sm">
          <Loader2 className="w-7 h-7 animate-spin text-slate-400 mx-auto mb-3" />
          <p className="text-sm text-slate-500">{t("admin.settingsPage.loading")}</p>
        </div>
      ) : (
        <div className="max-w-4xl">
          {/* 页面头部 */}
          <div className="mb-4">
            <h1 className="text-xl md:text-2xl font-bold text-slate-900 mb-1">
              {t("admin.settingsPage.title")}
            </h1>
            <p className="text-xs md:text-sm text-slate-500">
              {t("admin.settingsPage.description")}
            </p>
          </div>

          {/* 错误提示 */}
          {error && (
            <div className="mb-4 p-3 rounded-2xl border border-red-200 bg-red-50 text-xs md:text-sm text-red-800">
              {error}
            </div>
          )}

          <form onSubmit={handleSave} className="space-y-5">
            {/* Section 1: 接口设置 */}
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
              <div className="flex items-center gap-2 mb-6">
                <Settings className="w-5 h-5 text-slate-600" />
                <h2 className="text-lg md:text-xl font-semibold text-slate-900">
                  {t("admin.settingsPage.interface.title")}
                </h2>
              </div>

              {/* SSO 配置展示 */}
              <div className="mb-6">
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  {t("admin.settingsPage.interface.sso")}
                </label>
                <div className="p-4 bg-slate-50 rounded-lg border border-slate-200">
                  <p className="text-sm text-slate-600 mb-2">
                    {t("admin.settingsPage.interface.ssoDesc")}
                  </p>
                  <p className="text-xs text-slate-500">
                    {t("admin.settingsPage.interface.ssoHint")}
                  </p>
                </div>
              </div>

              {/* Analytics 配置 */}
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">
                    {t("admin.settingsPage.interface.googleId")}
                  </label>
                  <input
                    type="text"
                    value={formData.analytics_config.google || ""}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        analytics_config: {
                          ...formData.analytics_config,
                          google: e.target.value,
                        },
                      })
                    }
                    className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-[var(--color-brand-blue)]/40 focus:border-transparent"
                    placeholder={t("admin.settingsPage.interface.googlePlaceholder")}
                  />
                  <p className="mt-1 text-xs text-slate-500">
                    {t("admin.settingsPage.interface.googleIdHint")}
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">
                    {t("admin.settingsPage.interface.baiduId")}
                  </label>
                  <input
                    type="text"
                    value={formData.analytics_config.baidu || ""}
                    onChange={(e) => {
                      const inputValue = e.target.value;
                      // 智能提取：检测是否包含完整代码
                      const baiduIdPattern = /hm\.js\?([a-z0-9]{32})/i;
                      const match = inputValue.match(baiduIdPattern);

                      if (match && match[1]) {
                        // 找到 32 位 ID，自动提取
                        const extractedId = match[1];
                        setFormData({
                          ...formData,
                          analytics_config: {
                            ...formData.analytics_config,
                            baidu: extractedId,
                          },
                        });
                        // 显示提示
                        setBaiduExtractToast(true);
                        setTimeout(() => setBaiduExtractToast(false), 3000);
                      } else {
                        // 普通输入，直接更新
                        setFormData({
                          ...formData,
                          analytics_config: {
                            ...formData.analytics_config,
                            baidu: inputValue,
                          },
                        });
                      }
                    }}
                    className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-[var(--color-brand-blue)]/40 focus:border-transparent"
                    placeholder={t("admin.settingsPage.interface.baiduPlaceholder")}
                  />
                  <p className="mt-1 text-xs text-slate-500">
                    {t("admin.settingsPage.interface.baiduIdHint")}
                  </p>
                  {baiduExtractToast && (
                    <div className="mt-2 p-2 bg-green-50 border border-green-200 rounded-lg text-xs text-green-700">
                      {t("admin.settingsPage.interface.baiduExtracted")}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Section 2: 后台入口设置 */}
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
              <div className="flex items-center gap-2 mb-6">
                <Settings className="w-5 h-5 text-slate-600" />
                <h2 className="text-lg md:text-xl font-semibold text-slate-900">
                  {t("admin.settingsPage.access.title")}
                </h2>
              </div>

              {/* 警告提示 */}
              <div className="mb-6 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="w-5 h-5 text-yellow-600 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-semibold text-yellow-800 mb-1">
                      {t("admin.settingsPage.access.warningTitle")}
                    </p>
                    <p className="text-sm text-yellow-700">
                      {t("admin.settingsPage.access.warningDesc")}
                    </p>
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  {t("admin.settingsPage.access.keyLabel")}
                </label>
                <input
                  type="text"
                  value={formData.admin_entrance_key}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      admin_entrance_key: e.target.value,
                    })
                  }
                  className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-[var(--color-brand-blue)]/40 focus:border-transparent font-mono"
                  placeholder={t("admin.settingsPage.access.keyPlaceholder")}
                  required
                />
                <p className="mt-1 text-xs text-slate-500">
                  {t("admin.settingsPage.access.currentUrl")}{" "}
                  <code className="bg-slate-100 px-1 rounded">
                    /{adminKey}/webadmin
                  </code>
                </p>
              </div>

              <div className="mt-6 rounded-xl border border-slate-200 bg-slate-50 p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-900">
                      {t("admin.settingsPage.access.pbPublicEntryLabel")}
                    </p>
                    <p className="mt-1 text-xs text-slate-600">
                      {t("admin.settingsPage.access.pbPublicEntryDesc")}
                    </p>
                    <p className="mt-2 text-xs text-slate-500">
                      {t("admin.settingsPage.access.pbPublicEntryHint")}
                    </p>
                  </div>
                  <label className="inline-flex items-center gap-2 text-xs text-slate-700 flex-shrink-0">
                    <input
                      type="checkbox"
                      checked={formData.enable_pb_public_entry !== false}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          enable_pb_public_entry: e.target.checked,
                        })
                      }
                      className="h-4 w-4 rounded border-slate-300 text-[var(--color-brand-blue)] focus:ring-2 focus:ring-[var(--color-brand-blue)]/40"
                    />
                    <span className="font-medium">
                      {formData.enable_pb_public_entry !== false
                        ? t("admin.settingsPage.access.pbPublicEntryOn")
                        : t("admin.settingsPage.access.pbPublicEntryOff")}
                    </span>
                  </label>
                </div>
              </div>
            </div>

            {/* Section 3: 翻译管理 */}
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
              <div className="flex items-center gap-2 mb-3">
                <Settings className="w-5 h-5 text-slate-600" />
                <h2 className="text-lg md:text-xl font-semibold text-slate-900">
                  {t("admin.settingsPage.translation.title")}
                </h2>
              </div>
              <p className="text-xs md:text-sm text-slate-500 mb-6">
                {t("admin.settingsPage.translation.description")}
              </p>

              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">
                    {t("admin.settingsPage.translation.enabled")}
                  </label>
                  <label className="inline-flex items-center gap-2 text-xs text-slate-700">
                    <input
                      type="checkbox"
                      checked={formData.translation_config.enabled !== false}
                      onChange={(e) =>
                        patchTranslationConfig({ enabled: e.target.checked })
                      }
                      className="h-4 w-4 rounded border-slate-300 text-[var(--color-brand-blue)] focus:ring-2 focus:ring-[var(--color-brand-blue)]/40"
                    />
                    <span className="font-medium">
                      {formData.translation_config.enabled !== false
                        ? t("admin.settingsPage.translation.enabledOn")
                        : t("admin.settingsPage.translation.enabledOff")}
                    </span>
                  </label>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">
                    {t("admin.settingsPage.translation.engineLabel")}
                  </label>
                  <select
                    value={formData.translation_config.engine}
                    onChange={(e) =>
                      patchTranslationConfig({ engine: e.target.value })
                    }
                    className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-[var(--color-brand-blue)]/40 focus:border-transparent"
                  >
                    <option value="free">
                      {t("admin.settingsPage.translation.engineFree")}
                    </option>
                    <option value="ai">
                      {t("admin.settingsPage.translation.engineAi")}
                    </option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">
                    {t("admin.settingsPage.translation.fillPolicyLabel")}
                  </label>
                  <select
                    value={formData.translation_config.fill_policy}
                    onChange={(e) =>
                      patchTranslationConfig({ fill_policy: e.target.value })
                    }
                    className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-[var(--color-brand-blue)]/40 focus:border-transparent"
                  >
                    <option value="fill_empty_only">
                      {t("admin.settingsPage.translation.fillPolicyFillEmpty")}
                    </option>
                    <option value="overwrite_target">
                      {t("admin.settingsPage.translation.fillPolicyOverwrite")}
                    </option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">
                    {t("admin.settingsPage.translation.cacheLabel")}
                  </label>
                  <label className="inline-flex items-center gap-2 text-xs text-slate-700">
                    <input
                      type="checkbox"
                      checked={formData.translation_config.enable_cache !== false}
                      onChange={(e) =>
                        patchTranslationConfig({ enable_cache: e.target.checked })
                      }
                      className="h-4 w-4 rounded border-slate-300 text-[var(--color-brand-blue)] focus:ring-2 focus:ring-[var(--color-brand-blue)]/40"
                    />
                    <span className="font-medium">
                      {formData.translation_config.enable_cache !== false
                        ? t("admin.settingsPage.translation.cacheOn")
                        : t("admin.settingsPage.translation.cacheOff")}
                    </span>
                  </label>
                </div>

                {formData.translation_config.engine === "ai" && (
                  <>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-2">
                        {t("admin.settingsPage.translation.providerLabel")}
                      </label>
                      <select
                        value={formData.translation_config.ai_provider}
                        onChange={(e) =>
                          patchTranslationConfig({ ai_provider: e.target.value })
                        }
                        className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-[var(--color-brand-blue)]/40 focus:border-transparent"
                      >
                        <option value="right_code">Right Code</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-2">
                        {t("admin.settingsPage.translation.endpointLabel")}
                      </label>
                      <select
                        value={formData.translation_config.right_code_endpoint}
                        onChange={(e) =>
                          patchTranslationConfig({
                            right_code_endpoint: e.target.value,
                          })
                        }
                        className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-[var(--color-brand-blue)]/40 focus:border-transparent"
                      >
                        <option value="responses">responses</option>
                        <option value="chat_completions">chat/completions</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-2">
                        {t("admin.settingsPage.translation.baseUrlLabel")}
                      </label>
                      <input
                        type="text"
                        value={formData.translation_config.right_code_base_url}
                        onChange={(e) =>
                          patchTranslationConfig({
                            right_code_base_url: e.target.value,
                          })
                        }
                        className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-[var(--color-brand-blue)]/40 focus:border-transparent"
                        placeholder="https://www.right.codes/codex/v1"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-2">
                        {t("admin.settingsPage.translation.modelLabel")}
                      </label>
                      <input
                        type="text"
                        value={formData.translation_config.right_code_model}
                        onChange={(e) =>
                          patchTranslationConfig({
                            right_code_model: e.target.value,
                          })
                        }
                        className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-[var(--color-brand-blue)]/40 focus:border-transparent"
                        placeholder="gpt-5.2"
                      />
                    </div>

                    <div className="md:col-span-2">
                      <label className="block text-sm font-medium text-slate-700 mb-2">
                        {t("admin.settingsPage.translation.apiKeyLabel")}
                      </label>
                      <input
                        type="password"
                        value={formData.translation_config.right_code_api_key}
                        onChange={(e) =>
                          patchTranslationConfig({
                            right_code_api_key: e.target.value,
                          })
                        }
                        className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-[var(--color-brand-blue)]/40 focus:border-transparent font-mono"
                        placeholder={t("admin.settingsPage.translation.apiKeyPlaceholder")}
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-2">
                        {t("admin.settingsPage.translation.timeoutLabel")}
                      </label>
                      <input
                        type="number"
                        min={1000}
                        step={1000}
                        value={formData.translation_config.request_timeout_ms}
                        onChange={(e) =>
                          patchTranslationConfig({
                            request_timeout_ms: Number.parseInt(e.target.value || "0", 10) || 0,
                          })
                        }
                        className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-[var(--color-brand-blue)]/40 focus:border-transparent"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-2">
                        {t("admin.settingsPage.translation.maxInputLabel")}
                      </label>
                      <input
                        type="number"
                        min={100}
                        step={100}
                        value={formData.translation_config.max_input_chars}
                        onChange={(e) =>
                          patchTranslationConfig({
                            max_input_chars: Number.parseInt(e.target.value || "0", 10) || 0,
                          })
                        }
                        className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-[var(--color-brand-blue)]/40 focus:border-transparent"
                      />
                    </div>
                  </>
                )}
              </div>

              <div className="mt-6 rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-3">
                <div>
                  <p className="text-sm font-medium text-slate-900">
                    {t("admin.settingsPage.translation.test.title")}
                  </p>
                  <p className="text-xs text-slate-600 mt-1">
                    {t("admin.settingsPage.translation.test.desc")}
                  </p>
                </div>
                <textarea
                  rows={3}
                  value={translationTestText}
                  onChange={(e) => setTranslationTestText(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-[var(--color-brand-blue)]/40 focus:border-transparent text-sm"
                  placeholder={t("admin.settingsPage.translation.test.placeholder")}
                />
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={testingTranslation}
                    onClick={handleTestTranslation}
                    className="inline-flex items-center gap-1.5 rounded-full bg-slate-900 px-4 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    {testingTranslation && (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    )}
                    {testingTranslation
                      ? t("admin.settingsPage.translation.test.testing")
                      : t("admin.settingsPage.translation.test.button")}
                  </button>
                  <span className="text-xs text-slate-500">
                    {t("admin.settingsPage.translation.onlyTwoTargetsHint")}
                  </span>
                </div>

                {translationTestResult && (
                  <div className="rounded-lg border border-slate-200 bg-white p-3 text-xs space-y-2">
                    <p className="text-slate-700">
                      {t("admin.settingsPage.translation.test.connectivity")}{" "}
                      <strong className={translationTestResult.connectivity_ok ? "text-emerald-700" : "text-red-700"}>
                        {translationTestResult.connectivity_ok
                          ? t("admin.settingsPage.translation.test.ok")
                          : t("admin.settingsPage.translation.test.failedShort")}
                      </strong>
                    </p>
                    <p className="text-slate-700">
                      {t("admin.settingsPage.translation.test.structure")}{" "}
                      <strong className={translationTestResult.structure_ok ? "text-emerald-700" : "text-red-700"}>
                        {translationTestResult.structure_ok
                          ? t("admin.settingsPage.translation.test.ok")
                          : t("admin.settingsPage.translation.test.failedShort")}
                      </strong>
                    </p>
                    {translationTestResult?.result_preview && (
                      <div className="space-y-1">
                        <p className="text-slate-600">
                          EN: {translationTestResult.result_preview.en || ""}
                        </p>
                        <p className="text-slate-600">
                          JA: {translationTestResult.result_preview.ja || ""}
                        </p>
                      </div>
                    )}
                    {translationTestResult?.error && (
                      <p className="text-red-700">
                        {t("admin.settingsPage.translation.test.errorLabel")}
                        {translationTestResult.error}
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* 保存按钮 */}
            <div className="flex items-center justify-end">
              <button
                type="submit"
                disabled={saving}
                className="inline-flex items-center gap-2 rounded-full bg-[var(--color-brand-blue)] px-5 py-2 text-xs md:text-sm font-semibold text-slate-950 shadow-[0_0_18px_rgba(142,209,252,0.8)] hover:scale-[1.02] active:scale-[0.98] transition-transform disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {saving ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    {t("admin.settingsPage.saving")}
                  </>
                ) : (
                  <>
                    <Save className="w-4 h-4" />
                    {t("admin.settingsPage.save")}
                  </>
                )}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
