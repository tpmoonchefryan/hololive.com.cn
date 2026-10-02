import { useEffect, useState } from "react";
import { ShieldCheck, User } from "lucide-react";
import { useTranslation } from "react-i18next";
import pb, { refreshAdminSession } from "../../lib/pocketbase";
import ContentPageHeader from "../../components/admin/content/ContentPageHeader";
import ContentCardSurface from "../../components/admin/content/ContentCardSurface";
import ContentStateBlock from "../../components/admin/content/ContentStateBlock";

export default function AdminUsersPage() {
  const { t } = useTranslation();
  const [account, setAccount] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loginState, setLoginState] = useState("loading");

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const { record } = await refreshAdminSession();
        if (active) setAccount(record);
      } catch {
        if (active) setAccount(null);
      } finally {
        if (active) setLoading(false);
      }
    };
    const loadSetting = async () => {
      try {
        const settings = await pb.collection("system_settings").getFirstListItem("");
        if (active) setLoginState(typeof settings?.enable_local_login === "boolean"
          ? (settings.enable_local_login ? "on" : "off") : "unknown");
      } catch {
        if (active) setLoginState("unknown");
      }
    };
    load();
    loadSetting();
    return () => { active = false; };
  }, []);

  return (
    <div className="space-y-4">
      <ContentPageHeader title={t("admin.users.title")} subtitle={t("admin.users.subtitle")} />
      <ContentCardSurface className="space-y-3 p-5">
        <h2 className="flex items-center gap-2 text-lg font-semibold text-gray-900">
          <ShieldCheck className="h-5 w-5 text-blue-600" />{t("admin.users.provision.title")}
        </h2>
        <p className="text-sm text-gray-600">{t("admin.users.provision.desc")}</p>
        <p className="text-sm text-gray-600">{t("admin.users.provision.service")}</p>
      </ContentCardSurface>
      {loading ? <ContentStateBlock loading loadingText={t("admin.users.loading")} /> : account ? (
        <ContentCardSurface className="space-y-3 p-5">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-gray-900">
            <User className="h-5 w-5 text-blue-600" />{t("admin.users.provision.current")}
          </h2>
          <dl className="space-y-2 text-sm">
            <div><dt className="text-gray-500">{t("admin.users.table.email")}</dt><dd className="break-all font-medium text-gray-900">{account.email || account.id}</dd></div>
            <div><dt className="text-gray-500">{t("admin.users.provision.identity")}</dt><dd className="text-gray-900">{t(account.is_admin && account.service_account ? "admin.users.provision.serviceIdentity" : "admin.users.provision.humanIdentity")}</dd></div>
          </dl>
        </ContentCardSurface>
      ) : <ContentStateBlock icon={User} title={t("admin.users.provision.unavailable")} />}
      <ContentCardSurface className="space-y-2 p-5" aria-live="polite">
        <h2 className="text-lg font-semibold text-gray-900">{t("admin.users.toggle.title")}</h2>
        <p className="text-sm font-medium text-gray-900">{t(`admin.users.toggle.${loginState}`)}</p>
        <p className="text-sm text-gray-600">{t("admin.users.toggle.desc")}</p>
      </ContentCardSurface>
    </div>
  );
}
