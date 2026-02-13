import { Cpu, MemoryStick, Users, EyeOff, Eye, Pencil } from "lucide-react";
import { useTranslation } from "react-i18next";
import MCSMStatusBadge from "./MCSMStatusBadge";

export default function MCSMInstanceCard({
    instance, actions, actionLoading,
    isHidden, displayName, onToggleHide, onRename,
}) {
    const { t } = useTranslation();
    const name = displayName || instance.config?.nickname || instance.instanceUuid;
    const uuid = instance.instanceUuid;
    const daemonId = instance.daemonId;
    const isRunning = instance.status === 3;

    const handleRename = () => {
        const newName = prompt(t("admin.mcsm.instances.renamePrompt"), name);
        if (newName !== null && newName.trim() !== "") {
            onRename?.(uuid, newName.trim());
        }
    };

    return (
        <div className={`p-4 rounded-lg border ${isHidden ? "bg-slate-100 border-slate-200 opacity-70" : "bg-slate-50 border-slate-100"}`}>
            <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2 min-w-0">
                    <h4 className="font-semibold text-slate-800 truncate">{name}</h4>
                    {isHidden && (
                        <span className="text-xs px-1.5 py-0.5 bg-slate-200 text-slate-500 rounded">
                            {t("admin.mcsm.instances.hidden")}
                        </span>
                    )}
                </div>
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
            <div className="flex gap-2 flex-wrap">
                {actions && (
                    <>
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
                    </>
                )}
                <div className="flex gap-1 ml-auto">
                    <button
                        onClick={handleRename}
                        className="p-1.5 text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded"
                        title={t("admin.mcsm.instances.rename")}
                    >
                        <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button
                        onClick={() => onToggleHide?.(uuid)}
                        className="p-1.5 text-slate-500 hover:text-amber-600 hover:bg-amber-50 rounded"
                        title={isHidden ? t("admin.mcsm.instances.unhide") : t("admin.mcsm.instances.hide")}
                    >
                        {isHidden ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                    </button>
                </div>
            </div>
        </div>
    );
}
