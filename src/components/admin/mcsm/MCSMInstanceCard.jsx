import { Cpu, MemoryStick, Users } from "lucide-react";
import { useTranslation } from "react-i18next";
import MCSMStatusBadge from "./MCSMStatusBadge";

export default function MCSMInstanceCard({ instance, actions, actionLoading }) {
    const { t } = useTranslation();
    const name = instance.config?.nickname || instance.instanceUuid;
    const uuid = instance.instanceUuid;
    const daemonId = instance.daemonId;
    const isRunning = instance.status === 3;

    return (
        <div className="p-4 bg-slate-50 rounded-lg border border-slate-100">
            <div className="flex items-center justify-between mb-3">
                <h4 className="font-semibold text-slate-800 truncate">{name}</h4>
                <MCSMStatusBadge status={instance.status} />
            </div>
            <div className="grid grid-cols-3 gap-2 mb-3 text-sm">
                <div className="flex items-center gap-1.5 text-slate-600">
                    <Users className="w-3.5 h-3.5" />
                    <span>{instance.info?.currentPlayers ?? "-"}/{instance.info?.maxPlayers ?? "-"}</span>
                </div>
                <div className="flex items-center gap-1.5 text-slate-600">
                    <Cpu className="w-3.5 h-3.5" />
                    <span>{typeof instance.info?.cpuUsage === "number" ? `${Math.round(instance.info.cpuUsage)}%` : "-"}</span>
                </div>
                <div className="flex items-center gap-1.5 text-slate-600">
                    <MemoryStick className="w-3.5 h-3.5" />
                    <span>{typeof instance.info?.memUsage === "number" ? `${Math.round(instance.info.memUsage / 1024 / 1024)}MB` : "-"}</span>
                </div>
            </div>
            {actions && (
                <div className="flex gap-2 flex-wrap">
                    {!isRunning && (
                        <button
                            onClick={() => actions("open", uuid, daemonId)}
                            disabled={actionLoading?.[`${uuid}_open`]}
                            className="px-3 py-1.5 text-xs font-medium bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
                        >
                            {t("admin.mcsm.instances.start")}
                        </button>
                    )}
                    {isRunning && (
                        <>
                            <button
                                onClick={() => actions("stop", uuid, daemonId)}
                                disabled={actionLoading?.[`${uuid}_stop`]}
                                className="px-3 py-1.5 text-xs font-medium bg-amber-600 text-white rounded-lg hover:bg-amber-700 disabled:opacity-50"
                            >
                                {t("admin.mcsm.instances.stop")}
                            </button>
                            <button
                                onClick={() => actions("restart", uuid, daemonId)}
                                disabled={actionLoading?.[`${uuid}_restart`]}
                                className="px-3 py-1.5 text-xs font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                            >
                                {t("admin.mcsm.instances.restart")}
                            </button>
                        </>
                    )}
                    <button
                        onClick={() => actions("kill", uuid, daemonId)}
                        disabled={actionLoading?.[`${uuid}_kill`]}
                        className="px-3 py-1.5 text-xs font-medium bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50"
                    >
                        {t("admin.mcsm.instances.kill")}
                    </button>
                </div>
            )}
        </div>
    );
}
