import { useState, useEffect } from "react";
import { useParams, Outlet } from "react-router-dom";
import { useTranslation } from "react-i18next";
import ErrorPage from "../../pages/ErrorPage";
import pb from "../../lib/pocketbase";
import { createAppLogger } from "../../lib/appLogger";
import { sha256Hex } from "../../lib/adminKeyHash";

const logger = createAppLogger("AdminGuard");

/**
 * 后台管理路由守卫组件
 * 通过 URL 中的 adminKey 参数验证访问权限
 * 比对 system_settings.admin_entrance_key_hash（公开的 SHA-256 哈希）
 * 如果密钥不匹配，显示 404 错误页面（起到迷惑作用）
 *
 * 不再读取明文 admin_entrance_key：该字段已标记为 hidden，因为
 * system_settings 是公开可读的，明文存放等于把入口密钥挂在公网上。
 */
export default function AdminGuard() {
  const { t } = useTranslation("admin");
  const { adminKey } = useParams();
  const [isValidKey, setIsValidKey] = useState(null); // null = 加载中, true/false = 验证结果
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const devFallbackKey = import.meta.env.DEV
      ? import.meta.env.VITE_ADMIN_KEY || ""
      : "";

    const validateKey = async () => {
      try {
        setLoading(true);
        const settings = await pb.collection("system_settings").getOne("1");
        const expectedHash = settings?.admin_entrance_key_hash;

        if (expectedHash) {
          setIsValidKey((await sha256Hex(adminKey)) === expectedHash);
          return;
        }

        // 库里没有哈希时不再回退到明文——明文字段已被删除，因为 PocketBase 会把
        // hidden 字段从非超管的写入里静默剔除，留着它只会和哈希分叉、变成错误值。
        // 开发模式仍可用环境变量顶上。
        setIsValidKey(Boolean(devFallbackKey) && adminKey === devFallbackKey);
      } catch (error) {
        logger.error("Failed to validate admin key:", error);
        // 生产环境读取失败时直接拒绝；开发模式可回退到环境变量
        setIsValidKey(Boolean(devFallbackKey) && adminKey === devFallbackKey);
      } finally {
        setLoading(false);
      }
    };

    validateKey();
  }, [adminKey]);

  // 加载中：显示空白或加载提示（避免闪烁）
  if (loading || isValidKey === null) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-sm text-slate-500">{t("guard.verifying")}</div>
      </div>
    );
  }

  // 如果密钥不匹配，显示 404 页面（迷惑潜在的攻击者）
  if (!isValidKey) {
    return <ErrorPage code="E404" />;
  }

  // 密钥验证通过，渲染子路由
  return <Outlet />;
}
