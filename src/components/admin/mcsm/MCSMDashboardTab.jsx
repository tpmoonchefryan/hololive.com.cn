import { useEffect } from "react";
import { Cpu, MemoryStick, Server } from "lucide-react";
import { useTranslation } from "react-i18next";
import ContentStateBlock from "../content/ContentStateBlock";
import ContentCardSurface from "../content/ContentCardSurface";

export default function MCSMDashboardTab({ overview, fetchOverview }) {
  const { t } = useTranslation();

  useEffect(() => {
    fetchOverview();
    const timer = setInterval(fetchOverview, 15000);
    return () => clearInterval(timer);
  }, [fetchOverview]);

  if (!overview) {
    return (
      <ContentStateBlock
        loading
        loadingText={t("admin.mcsm.dashboard.loading")}
        className="rounded-xl"
      />
    );
  }

  const remoteNodes = overview.remote || [];
  const totalInstances = remoteNodes.reduce((sum, node) => sum + (node.instance?.total || 0), 0);
  const runningInstances = remoteNodes.reduce(
    (sum, node) => sum + (node.instance?.running || 0),
    0
  );

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <ContentCardSurface className="p-4 bg-slate-50 border-slate-100 rounded-lg shadow-none">
          <h3 className="text-sm font-medium text-slate-500 mb-1">
            {t("admin.mcsm.dashboard.version")}
          </h3>
          <p className="text-lg font-semibold text-slate-800">{overview.version || "-"}</p>
        </ContentCardSurface>
        <ContentCardSurface className="p-4 bg-slate-50 border-slate-100 rounded-lg shadow-none">
          <h3 className="text-sm font-medium text-slate-500 mb-1">
            {t("admin.mcsm.dashboard.nodes")}
          </h3>
          <div className="flex items-center gap-2">
            <Server className="w-5 h-5 text-slate-600" />
            <span className="text-lg font-semibold text-slate-800">{remoteNodes.length}</span>
          </div>
        </ContentCardSurface>
        <ContentCardSurface className="p-4 bg-slate-50 border-slate-100 rounded-lg shadow-none">
          <h3 className="text-sm font-medium text-slate-500 mb-1">
            {t("admin.mcsm.dashboard.instances")}
          </h3>
          <p className="text-lg font-semibold text-slate-800">
            <span className="text-green-600">{runningInstances}</span> / {totalInstances}
          </p>
        </ContentCardSurface>
        <ContentCardSurface className="p-4 bg-slate-50 border-slate-100 rounded-lg shadow-none">
          <h3 className="text-sm font-medium text-slate-500 mb-1">
            {t("admin.mcsm.dashboard.system")}
          </h3>
          <div className="flex items-center gap-3 text-sm text-slate-600">
            <span className="flex items-center gap-1">
              <Cpu className="w-3.5 h-3.5" />
              {overview.process?.cpu ? `${Math.round(overview.process.cpu)}%` : "-"}
            </span>
            <span className="flex items-center gap-1">
              <MemoryStick className="w-3.5 h-3.5" />
              {overview.process?.memory
                ? `${Math.round(overview.process.memory / 1024 / 1024)}MB`
                : "-"}
            </span>
          </div>
        </ContentCardSurface>
      </div>

      {remoteNodes.length > 0 ? (
        <div>
          <h3 className="font-semibold text-slate-700 mb-3">
            {t("admin.mcsm.dashboard.nodeList")}
          </h3>
          <div className="space-y-3">
            {remoteNodes.map((node) => (
              <ContentCardSurface key={node.uuid} className="p-4 rounded-lg">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-medium text-slate-800">{node.remarks || node.uuid}</span>
                  <span
                    className={`text-xs px-2 py-0.5 rounded-full ${node.available ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"
                      }`}
                  >
                    {node.available
                      ? t("admin.mcsm.dashboard.online")
                      : t("admin.mcsm.dashboard.offline")}
                  </span>
                </div>
                <div className="flex items-center gap-4 text-xs text-slate-500 flex-wrap">
                  <span>
                    {t("admin.mcsm.dashboard.instanceCount", { count: node.instance?.total || 0 })} (
                    {node.instance?.running || 0} {t("admin.mcsm.dashboard.online")})
                  </span>
                  {node.system ? (
                    <>
                      <span className="flex items-center gap-1">
                        <Cpu className="w-3 h-3" />
                        {typeof node.system.cpuUsage === "number"
                          ? `${Math.round(node.system.cpuUsage * 100)}%`
                          : "-"}
                      </span>
                      <span className="flex items-center gap-1">
                        <MemoryStick className="w-3 h-3" />
                        {node.system.totalmem
                          ? `${
                            Math.round(
                              ((node.system.totalmem - (node.system.freemem || 0)) /
                                1024 /
                                1024 /
                                1024) *
                              10
                            ) / 10
                          }/${Math.round((node.system.totalmem / 1024 / 1024 / 1024) * 10) / 10}GB`
                          : "-"}
                      </span>
                    </>
                  ) : null}
                </div>
              </ContentCardSurface>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
