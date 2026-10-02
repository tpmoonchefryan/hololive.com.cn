import { Activity, Server } from "lucide-react";
import { useTranslation } from "react-i18next";

export default function DashboardTab({ settings, servers }) {
    const { t } = useTranslation();
    const syncOk = settings.last_sync_status === "ok" && /^[a-f0-9]{64}$/.test(settings.last_applied_hash || "") && Number.isFinite(Date.parse(settings.last_sync_at || ""));
    const syncState = syncOk ? "Last sync succeeded" : settings.last_sync_status === "error" ? "Last sync failed" : settings.last_sync_status === "pending" ? "Sync pending" : "Sync unknown";
    const syncColor = syncOk ? "text-green-600" : settings.last_sync_status === "error" ? "text-red-500" : "text-amber-600";

    return (
        <div className="space-y-8">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">

                <div className="p-4 bg-slate-50 rounded-lg border border-slate-100">
                    <h3 className="text-sm font-medium text-slate-500 mb-1">{t("admin.velocity.dashboard.proxyStatus")}</h3>
                    <div className={`flex items-center gap-2 ${settings.proxy_status === 'active' ? 'text-green-600' : settings.proxy_status ? 'text-red-500' : 'text-amber-600'}`}>
                        <Activity className="w-5 h-5" />
                        <span className="font-semibold text-lg capitalize">
                            {settings.proxy_status || "Unknown"}
                        </span>
                    </div>
                    <p className="text-xs text-slate-400 mt-2">
                        {t("admin.velocity.dashboard.proxyStatusDesc")}
                        {settings.last_heartbeat && (
                            <span className="block mt-1 opacity-70">
                                {new Date(settings.last_heartbeat).toLocaleTimeString()}
                            </span>
                        )}
                    </p>
                </div>
                <div className="p-4 bg-slate-50 rounded-lg border border-slate-100">
                    <h3 className="text-sm font-medium text-slate-500 mb-1">{t("admin.velocity.dashboard.syncStatus", { defaultValue: "Sync" })}</h3>
                    <div className={`flex items-center gap-2 ${syncColor}`}>
                        <Activity className="w-5 h-5" />
                        <span className="font-semibold text-lg capitalize">
                            {t(`admin.velocity.dashboard.${syncOk ? "lastSuccess" : settings.last_sync_status === "error" ? "lastFailure" : settings.last_sync_status === "pending" ? "pending" : "unknown"}`, { defaultValue: syncState })}
                        </span>
                    </div>
                    <p className="text-xs text-slate-400 mt-2">
                        {settings.last_sync_at ? new Date(settings.last_sync_at).toLocaleTimeString() : "-"}
                    </p>
                    {settings.last_sync_status === "error" && settings.last_sync_error && <p className="text-sm text-red-600 mt-2 break-words">{settings.last_sync_error}</p>}
                </div>

                <div className="p-4 bg-slate-50 rounded-lg border border-slate-100">
                    <h3 className="text-sm font-medium text-slate-500 mb-1">{t("admin.velocity.dashboard.servers")}</h3>
                    <div className="flex items-center gap-2 text-slate-700">
                        <Server className="w-5 h-5" />
                        <span className="font-semibold text-lg">{servers.length}</span>
                    </div>
                    <p className="text-xs text-slate-400 mt-2">{t("admin.velocity.dashboard.serversDesc")}</p>
                </div>
                <div className="p-4 bg-slate-50 rounded-lg border border-slate-100">
                    <h3 className="text-sm font-medium text-slate-500 mb-1">{t("admin.velocity.dashboard.port")}</h3>
                    <div className="flex items-center gap-2 text-slate-700">
                        <Activity className="w-5 h-5" />
                        <span className="font-semibold text-lg">{settings.bind_port}</span>
                    </div>
                    <p className="text-xs text-slate-400 mt-2">{t("admin.velocity.dashboard.portDesc")}</p>
                </div>
            </div>

            <div className="bg-blue-50/50 rounded-lg p-6 border border-blue-100">
                <h3 className="font-semibold text-blue-900 mb-2">{t("admin.velocity.dashboard.nextSteps")}</h3>
                <ul className="list-disc list-inside space-y-1 text-sm text-blue-800/80">
                    <li>{t("admin.velocity.dashboard.step1")}</li>
                    <li>{t("admin.velocity.dashboard.step2")}</li>
                    <li>{t("admin.velocity.dashboard.step3")}</li>
                </ul>
            </div>
        </div>
    );
}
