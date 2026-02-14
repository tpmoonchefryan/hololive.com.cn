import { useCallback, useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import { Save, Loader2, Settings, AlertTriangle } from "lucide-react";
import pb from "../../lib/pocketbase";
import { logSystemSettings } from "../../lib/logger";
import { useTranslation } from "react-i18next";
import { useUIFeedback } from "../../hooks/useUIFeedback";
import { createAppLogger } from "../../lib/appLogger";
import Modal from "../../components/admin/ui/Modal";

const SETTINGS_ID = "1"; // 单例模式，固定 ID

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
  const [showKeyWarning, setShowKeyWarning] = useState(false);
  const [pendingUpdate, setPendingUpdate] = useState(null);

  // 表单状态
  const [formData, setFormData] = useState({
    microsoft_auth_config: {},
    analytics_config: {
      google: "",
      baidu: "",
    },
    admin_entrance_key: "",
    enable_pb_public_entry: true,
  });
  const [baiduExtractToast, setBaiduExtractToast] = useState(false);

  // 获取系统设置
  const fetchSettings = useCallback(async () => {
    try {
      setLoading(true);
      const settingsData = await pb.collection("system_settings").getOne(SETTINGS_ID);
      setSettings(settingsData);
      setFormData({
        microsoft_auth_config: settingsData.microsoft_auth_config || {},
        analytics_config: settingsData.analytics_config || { google: "", baidu: "" },
        admin_entrance_key: settingsData.admin_entrance_key || "",
        enable_pb_public_entry: settingsData.enable_pb_public_entry !== false,
      });
    } catch (error) {
      logger.error("Failed to fetch settings:", error);
      // 如果记录不存在，使用默认值
      if (error?.status === 404) {
        setFormData({
          microsoft_auth_config: {},
          analytics_config: { google: "", baidu: "" },
          admin_entrance_key: "",
          enable_pb_public_entry: true,
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

  const saveSettings = async (updateData, keyChanged) => {
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

    // 检查 admin_entrance_key 是否改变
    const keyChanged =
      settings && settings.admin_entrance_key !== updateData.admin_entrance_key;

    if (keyChanged) {
      // 触发自定义红色警告模态，而不是直接保存
      setPendingUpdate(updateData);
      setShowKeyWarning(true);
      return;
    }

    await saveSettings(updateData, false);
  };

  return (
    <div className="space-y-4">
      {/* Key 修改警告模态框 */}
      <Modal
        isOpen={Boolean(showKeyWarning && pendingUpdate)}
        onClose={() => {
          setShowKeyWarning(false);
          setPendingUpdate(null);
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
              }}
              className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 transition-colors"
            >
              {t("admin.settingsPage.modal.cancel")}
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => pendingUpdate && saveSettings(pendingUpdate, true)}
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
