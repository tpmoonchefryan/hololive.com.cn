import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { RefreshCw } from "lucide-react";
import MCSMInstanceCard from "./MCSMInstanceCard";

export default function MCSMInstancesTab({
    instances, fetchAllInstances, handleInstanceAction, actionLoading,
    config, onToggleHide, onRename,
}) {
    const { t } = useTranslation();

    useEffect(() => {
        fetchAllInstances();
    }, [fetchAllInstances]);

    const hiddenSet = new Set(config?.hidden_instances || []);
    const labels = config?.instance_labels || {};

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <h3 className="font-semibold text-slate-700">
                    {t("admin.mcsm.instances.title")} ({instances.length})
                </h3>
                <button
                    onClick={fetchAllInstances}
                    className="flex items-center gap-2 px-3 py-1.5 text-sm bg-white border border-slate-200 rounded-lg hover:bg-slate-50"
                >
                    <RefreshCw className="w-3.5 h-3.5" />
                    {t("admin.mcsm.refresh")}
                </button>
            </div>

            {instances.length === 0 ? (
                <p className="text-slate-500 text-center py-8">{t("admin.mcsm.instances.empty")}</p>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {instances.map((inst) => (
                        <MCSMInstanceCard
                            key={inst.instanceUuid}
                            instance={inst}
                            actions={handleInstanceAction}
                            actionLoading={actionLoading}
                            isHidden={hiddenSet.has(inst.instanceUuid)}
                            displayName={labels[inst.instanceUuid] || ""}
                            onToggleHide={onToggleHide}
                            onRename={onRename}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}
