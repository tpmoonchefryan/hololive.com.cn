import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { RefreshCw, Server } from "lucide-react";
import MCSMInstanceCard from "./MCSMInstanceCard";
import ContentSecondaryButton from "../content/ContentSecondaryButton";
import ContentStateBlock from "../content/ContentStateBlock";

export default function MCSMInstancesTab({
  instances,
  fetchAllInstances,
  handleInstanceAction,
  actionLoading,
  config,
  onToggleHide,
  onRename,
}) {
  const { t } = useTranslation();

  useEffect(() => {
    fetchAllInstances();
  }, [fetchAllInstances]);

  const hiddenSet = new Set(config?.hidden_instances || []);
  const labels = config?.instance_labels || {};

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-semibold text-slate-700">
          {t("admin.mcsm.instances.title")} ({instances.length})
        </h3>
        <ContentSecondaryButton
          type="button"
          onClick={fetchAllInstances}
          className="inline-flex items-center gap-2 text-sm"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          {t("admin.mcsm.refresh")}
        </ContentSecondaryButton>
      </div>

      {instances.length === 0 ? (
        <ContentStateBlock
          icon={Server}
          title={t("admin.mcsm.instances.empty")}
          className="rounded-2xl"
        />
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
