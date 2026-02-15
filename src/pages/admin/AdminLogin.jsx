import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import pb from "../../lib/pocketbase";
import { createAppLogger } from "../../lib/appLogger";
// 注意：ALLOWED_ADMINS 仅用于开发环境的显式回退白名单
import { ALLOWED_ADMINS } from "../../config/auth_whitelist";
import { logLogin } from "../../lib/logger";
import { useTranslation } from "react-i18next";
import { useUIFeedback } from "../../hooks/useUIFeedback";
import ContentPrimaryButton from "../../components/admin/content/ContentPrimaryButton";
import ContentTextInput from "../../components/admin/content/ContentTextInput";

/**
 * Microsoft 四色方块 Logo SVG 组件
 */
const MicrosoftLogo = ({ className, size = 20 }) => (
  <svg
    viewBox="0 0 21 21"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    style={className ? undefined : { width: size, height: size }}
  >
    <rect x="0" y="0" width="10" height="10" fill="#F25022" />
    <rect x="11" y="0" width="10" height="10" fill="#7FBA00" />
    <rect x="0" y="11" width="10" height="10" fill="#00A4EF" />
    <rect x="11" y="11" width="10" height="10" fill="#FFB900" />
  </svg>
);

/**
 * 后台登录页面
 * 支持 Microsoft OAuth2 登录和本地开发密码登录
 */
const logger = createAppLogger("AdminLogin");

export default function AdminLogin() {
  const { t } = useTranslation();
  const { notify } = useUIFeedback();
  const [microsoftLoading, setMicrosoftLoading] = useState(false);
  const [localLoading, setLocalLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [enableLocalLogin, setEnableLocalLogin] = useState(true); // 默认开启（安全回退）
  const [loadingSettings, setLoadingSettings] = useState(true);
  const navigate = useNavigate();
  const allowLocalWhitelistFallback =
    import.meta.env.DEV &&
    import.meta.env.VITE_ALLOW_LOCAL_WHITELIST_FALLBACK === "true";

  // 从数据库读取本地登录开关状态
  useEffect(() => {
    const fetchLoginSetting = async () => {
      try {
        setLoadingSettings(true);
        const settings = await pb.collection("system_settings").getFirstListItem("");
        setEnableLocalLogin(settings?.enable_local_login ?? true);
      } catch (error) {
        logger.error("Failed to fetch login setting:", error);
        // 如果读取失败，默认开启（安全回退，避免管理员被锁在外面）
        setEnableLocalLogin(true);
      } finally {
        setLoadingSettings(false);
      }
    };

    fetchLoginSetting();
  }, []);

  // 白名单验证和跳转的通用逻辑
  const handleAuthSuccess = async (userEmail, isLocalLogin = false) => {
    if (!userEmail) {
      pb.authStore.clear();
      navigate("/403");
      return false;
    }

    // 本地登录：优先检查数据库白名单，仅在开发模式显式开启时允许回退
    if (isLocalLogin) {
      try {
        // 优先从数据库 whitelists 集合查询
        await pb.collection("whitelists").getFirstListItem(
          `email="${userEmail}"`
        );
        // 找到白名单记录，允许登录
        navigate("../dashboard");
        return true;
      } catch (error) {
        if (allowLocalWhitelistFallback) {
          logger.warn(
            "Whitelist DB check failed; using local fallback list in DEV mode."
          );
          if (ALLOWED_ADMINS.includes(userEmail)) {
            navigate("../dashboard");
            return true;
          }
        }

        pb.authStore.clear();
        throw new Error("Whitelist verification failed", { cause: error });
      }
    }

    // SSO 登录：从 whitelists 集合查询
    try {
      await pb.collection("whitelists").getFirstListItem(
        `email="${userEmail}"`
      );
      // 找到白名单记录，允许登录
      navigate("../dashboard");
      return true;
    } catch {
      // 未找到白名单记录，强制登出
      logger.error("Email not whitelisted");
      pb.authStore.clear();
      throw new Error("Email not whitelisted");
    }
  };

  // Microsoft OAuth2 登录
  const handleMicrosoftLogin = async () => {
    setMicrosoftLoading(true);

    try {
      // 首先检查 OAuth2 提供者是否可用（仅用于诊断，不阻止登录尝试）
      try {
        const authMethods = await pb.collection("users").listAuthMethods();
        const microsoftProvider = authMethods?.oauth2?.providers?.find(
          (p) => p.name === "microsoft"
        );

        if (!microsoftProvider) {
          logger.warn("Microsoft OAuth2 provider not found in listAuthMethods()");
        }
      } catch (checkError) {
        logger.warn("OAuth2 provider check failed (continuing anyway):", checkError);
      }

      // 执行 Microsoft OAuth2 认证
      const authData = await pb.collection("users").authWithOAuth2({
        provider: "microsoft",
      });

      // 获取登录后的用户邮箱（从 authData.record.email）
      const userEmail = authData?.record?.email;

      if (!userEmail) {
        throw new Error(t("admin.login.alerts.missingEmail"));
      }

      // 白名单校验：从 whitelists 集合查询
      const success = await handleAuthSuccess(userEmail, false);

      // 记录登录日志
      if (success) {
        await logLogin("SSO 登录");
      }
    } catch (error) {
      // 处理认证失败
      logger.error("Microsoft login error:", error);

      // 确保清除可能的认证状态
      pb.authStore.clear();

      // 提取详细错误信息
      let errorMessage = t("admin.login.alerts.unknownError");

      // ... (Error extraction logic maintained but abbreviated for clarity)
      if (error?.message) {
        errorMessage = error.message;
      }

      // 白名单验证失败
      if (errorMessage === "Email not whitelisted" || errorMessage?.includes("白名单")) {
        notify(t("admin.login.alerts.notWhitelisted"), "error");
        return;
      }

      // ... (Other error checks using t())
      if (
        errorMessage?.includes("cancel") ||
        errorMessage?.includes("aborted")
      ) {
        notify(t("admin.login.alerts.cancelled"), "info");
        return;
      }

      // 网络错误
      if (errorMessage?.includes("network")) {
        notify(t("admin.login.alerts.networkError"), "error");
        return;
      }

      notify(
        `${t("admin.login.alerts.failed")}\n\n` +
        `Error: ${errorMessage}`,
        "error"
      );
    } finally {
      setMicrosoftLoading(false);
    }
  };

  // 本地密码登录
  const handleLocalLogin = async (e) => {
    e.preventDefault();
    setLocalLoading(true);

    try {
      // 执行密码认证
      await pb.collection("users").authWithPassword(email, password);

      // 获取登录后的用户邮箱
      const userEmail = pb.authStore.model?.email;
      const success = await handleAuthSuccess(userEmail, true);

      // 记录登录日志
      if (success) {
        await logLogin("本地登录");
      }
    } catch (error) {
      // 处理认证失败
      logger.error("Local login error:", error);

      // 确保清除可能的认证状态
      pb.authStore.clear();

      // 显示错误提示
      let errorMessage = t("admin.login.alerts.failed");
      if (
        error?.message === "Email not whitelisted" ||
        error?.message === "Whitelist verification failed"
      ) {
        errorMessage = t("admin.login.alerts.notWhitelisted");
      }
      notify(errorMessage, "error");
    } finally {
      setLocalLoading(false);
    }
  };

  const isLoading = microsoftLoading || localLoading || loadingSettings;

  return (
    <div className="min-h-screen bg-gray-950 text-white flex items-center justify-center p-4">
      {/* 背景渐变 */}
      <div className="fixed inset-0 -z-10 bg-gradient-to-b from-gray-900 via-gray-950 to-black pointer-events-none" />

      {/* 玻璃拟态卡片 */}
      <div className="w-full max-w-md backdrop-blur-xl bg-white/5 border border-white/10 rounded-2xl shadow-2xl p-8 space-y-6">
        {/* 标题 */}
        <div className="text-center space-y-2">
          <h1 className="text-3xl font-bold text-white">{t("admin.login.title")}</h1>
          <p className="text-gray-400 text-sm">{t("admin.login.subtitle")}</p>
        </div>

        {/* 加载状态 */}
        {loadingSettings && (
          <div className="flex items-center justify-center py-8">
            <svg
              className="animate-spin h-8 w-8 text-white"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              ></circle>
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
              ></path>
            </svg>
          </div>
        )}

        {/* Microsoft 登录按钮 */}
        {!loadingSettings && (
          <ContentPrimaryButton
            type="button"
            onClick={handleMicrosoftLogin}
            disabled={isLoading}
            loading={microsoftLoading}
            loadingLabel={t("admin.login.loading")}
            icon={MicrosoftLogo}
            iconSize={20}
            className="w-full flex items-center justify-center gap-3 px-6 py-3 bg-white hover:bg-gray-50 text-gray-900 rounded-lg font-medium transition-[transform,background-color,color,border-color,box-shadow] duration-200 disabled:opacity-50 disabled:cursor-not-allowed hover:scale-[1.02] active:scale-[0.98] shadow-lg border border-gray-200"
          >
            {t("admin.login.microsoftBtn")}
          </ContentPrimaryButton>
        )}

        {/* 本地登录部分 - 根据数据库配置显示/隐藏 */}
        {!loadingSettings && enableLocalLogin && (
          <>
            {/* 分隔线 */}
            <div className="relative my-6">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-white/10"></div>
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-white/5 px-2 text-gray-500">
                  {t("admin.login.orDev")}
                </span>
              </div>
            </div>

            {/* 本地登录表单 */}
            <form onSubmit={handleLocalLogin} className="space-y-4">
              <div>
                <label
                  htmlFor="email"
                  className="block text-sm font-medium text-gray-300 mb-2"
                >
                  {t("admin.login.email")}
                </label>
                <ContentTextInput
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={isLoading}
                  className="px-4 py-2 bg-white/5 border-white/10 rounded-lg text-white placeholder-gray-500 focus:ring-blue-500 focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed"
                  placeholder={t("admin.login.emailPlaceholder")}
                  required
                />
              </div>

              <div>
                <label
                  htmlFor="password"
                  className="block text-sm font-medium text-gray-300 mb-2"
                >
                  {t("admin.login.password")}
                </label>
                <ContentTextInput
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={isLoading}
                  className="px-4 py-2 bg-white/5 border-white/10 rounded-lg text-white placeholder-gray-500 focus:ring-blue-500 focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed"
                  placeholder={t("admin.login.passwordPlaceholder")}
                  required
                />
              </div>

              <ContentPrimaryButton
                type="submit"
                disabled={isLoading}
                loading={localLoading}
                loadingLabel={t("admin.login.verifying")}
                className="w-full flex items-center justify-center gap-2 px-6 py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-medium transition-[transform,background-color,color,border-color,box-shadow] duration-200 disabled:opacity-50 disabled:cursor-not-allowed hover:scale-[1.02] active:scale-[0.98] shadow-lg"
              >
                {t("admin.login.passwordBtn")}
              </ContentPrimaryButton>
            </form>
          </>
        )}

        {/* 提示信息 */}
        <p className="text-center text-xs text-gray-500">
          {t("admin.login.footer")}
        </p>
      </div>
    </div>
  );
}
