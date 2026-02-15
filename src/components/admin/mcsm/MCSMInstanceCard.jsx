import { Cpu, MemoryStick, Users, EyeOff, Eye, Pencil } from "lucide-react";
import { useTranslation } from "react-i18next";
import MCSMStatusBadge from "./MCSMStatusBadge";
import ContentInlineActionButton from "../content/ContentInlineActionButton";
import ContentIconActionButton from "../content/ContentIconActionButton";

export default function MCSMInstanceCard({
  instance,
  actions,
  actionLoading,
  isHidden,
  displayName,
  onToggleHide,
  onRename,
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
    <div
      className={`p-4 rounded-lg border ${isHidden ? "bg-slate-100 border-slate-200 opacity-70" : "bg-slate-50 border-slate-100"
        }`}
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2 min-w-0">
          <h4 className="font-semibold text-slate-800 truncate">{name}</h4>
          {isHidden ? (
            <span className="text-xs px-1.5 py-0.5 bg-slate-200 text-slate-500 rounded">
              {t("admin.mcsm.instances.hidden")}
            </span>
          ) : null}
        </div>
        <MCSMStatusBadge status={instance.status} />
      </div>
      <div className="grid grid-cols-3 gap-2 mb-3 text-sm">
        <div className="flex items-center gap-1.5 text-slate-600">
          <Users className="w-3.5 h-3.5" />
          <span>
            {instance.info?.currentPlayers ?? "-"}/{instance.info?.maxPlayers ?? "-"}
          </span>
        </div>
        <div className="flex items-center gap-1.5 text-slate-600">
          <Cpu className="w-3.5 h-3.5" />
          <span>
            {typeof instance.info?.cpuUsage === "number"
              ? `${Math.round(instance.info.cpuUsage)}%`
              : "-"}
          </span>
        </div>
        <div className="flex items-center gap-1.5 text-slate-600">
          <MemoryStick className="w-3.5 h-3.5" />
          <span>
            {typeof instance.info?.memUsage === "number"
              ? `${Math.round(instance.info.memUsage / 1024 / 1024)}MB`
              : "-"}
          </span>
        </div>
      </div>
      <div className="flex gap-2 flex-wrap">
        {actions ? (
          <>
            {!isRunning ? (
              <ContentInlineActionButton
                type="button"
                onClick={() => actions("open", uuid, daemonId)}
                disabled={actionLoading?.[`${uuid}_open`]}
                tone="success"
                className="text-xs"
              >
                {t("admin.mcsm.instances.start")}
              </ContentInlineActionButton>
            ) : (
              <>
                <ContentInlineActionButton
                  type="button"
                  onClick={() => actions("stop", uuid, daemonId)}
                  disabled={actionLoading?.[`${uuid}_stop`]}
                  tone="neutral"
                  className="text-xs bg-amber-600 text-white hover:bg-amber-700"
                >
                  {t("admin.mcsm.instances.stop")}
                </ContentInlineActionButton>
                <ContentInlineActionButton
                  type="button"
                  onClick={() => actions("restart", uuid, daemonId)}
                  disabled={actionLoading?.[`${uuid}_restart`]}
                  tone="neutral"
                  className="text-xs bg-blue-600 text-white hover:bg-blue-700"
                >
                  {t("admin.mcsm.instances.restart")}
                </ContentInlineActionButton>
              </>
            )}
            <ContentInlineActionButton
              type="button"
              onClick={() => actions("kill", uuid, daemonId)}
              disabled={actionLoading?.[`${uuid}_kill`]}
              tone="neutral"
              className="text-xs bg-red-600 text-white hover:bg-red-700"
            >
              {t("admin.mcsm.instances.kill")}
            </ContentInlineActionButton>
          </>
        ) : null}
        <div className="flex gap-1 ml-auto">
          <ContentIconActionButton
            onClick={handleRename}
            tone="edit"
            icon={Pencil}
            size="sm"
            iconSize={14}
            title={t("admin.mcsm.instances.rename")}
            aria-label={t("admin.mcsm.instances.rename")}
          />
          <ContentIconActionButton
            onClick={() => onToggleHide?.(uuid)}
            tone="neutral"
            icon={isHidden ? Eye : EyeOff}
            size="sm"
            iconSize={14}
            title={isHidden ? t("admin.mcsm.instances.unhide") : t("admin.mcsm.instances.hide")}
            aria-label={isHidden ? t("admin.mcsm.instances.unhide") : t("admin.mcsm.instances.hide")}
            className="hover:text-amber-600 hover:bg-amber-50"
          />
        </div>
      </div>
    </div>
  );
}
