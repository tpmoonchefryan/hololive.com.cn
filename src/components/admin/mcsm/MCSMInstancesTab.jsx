import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { RefreshCw } from "lucide-react";
import MCSMInstanceCard from "./MCSMInstanceCard";

export default function MCSMInstancesTab({ overview, fetchOverview, handleInstanceAction, actionLoading }) {
    const { t } = useTranslation();
    const remoteNodes = overview?.remote || [];

    useEffect(() => {
        if (!overview) fetchOverview();
    }, [overview, fetchOverview]);

    // Flatten all instances from overview for display
    const allInstances = remoteNodes.flatMap((node) =>
        (node.instances || []).map((inst) => ({ ...inst, daemonId: node.uuid, nodeName: node.remarks || node.uuid }))
    );

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <h3 className="font-semibold text-slate-700">
                    {t("admin.mcsm.instances.title")} ({allInstances.length})
                </h3>
                <button
                    onClick={fetchOverview}
                    className="flex items-center gap-2 px-3 py-1.5 text-sm bg-white border border-slate-200 rounded-lg hover:bg-slate-50"
                >
                    <RefreshCw className="w-3.5 h-3.5" />
                    {t("admin.mcsm.refresh")}
                </button>
            </div>

            {allInstances.length === 0 ? (
                <p className="text-slate-500 text-center py-8">{t("admin.mcsm.instances.empty")}</p>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {allInstances.map((inst) => (
                        <MCSMInstanceCard
                            key={inst.instanceUuid}
                            instance={inst}
                            actions={handleInstanceAction}
                            actionLoading={actionLoading}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}
