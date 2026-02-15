import { Plus, Play, Server } from "lucide-react";
import { useTranslation } from "react-i18next";
import StatusBadge from "./StatusBadge";
import ContentPrimaryButton from "../content/ContentPrimaryButton";
import ContentStateBlock from "../content/ContentStateBlock";
import ContentTableSurface from "../content/ContentTableSurface";
import ContentTableHeader from "../content/ContentTableHeader";
import ContentTableHeadCell from "../content/ContentTableHeadCell";
import ContentTableCell from "../content/ContentTableCell";
import ContentIconActionButton from "../content/ContentIconActionButton";
import ContentEditDeleteActions from "../content/ContentEditDeleteActions";
import ContentStatusPill from "../content/ContentStatusPill";

export default function ServersTab({
  servers,
  testingMap,
  onTest,
  onAdd,
  onEdit,
  onDelete,
}) {
  const { t } = useTranslation();

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center gap-3">
        <h3 className="text-lg font-semibold text-slate-800">
          {t("admin.velocity.tabs.servers")}
        </h3>
        <ContentPrimaryButton type="button" onClick={onAdd} icon={Plus} iconSize={16}>
          {t("admin.velocity.modal.addTitle")}
        </ContentPrimaryButton>
      </div>

      {servers.length === 0 ? (
        <ContentStateBlock
          icon={Server}
          title={t("admin.velocity.servers.table.empty")}
          className="rounded-2xl"
          action={(
            <ContentPrimaryButton type="button" onClick={onAdd} icon={Plus} iconSize={16}>
              {t("admin.velocity.modal.addTitle")}
            </ContentPrimaryButton>
          )}
        />
      ) : (
        <ContentTableSurface className="rounded-xl">
          <table className="w-full text-left text-sm">
            <ContentTableHeader>
              <tr>
                <ContentTableHeadCell compact>{t("admin.velocity.table.tryOrder")}</ContentTableHeadCell>
                <ContentTableHeadCell compact>{t("admin.velocity.table.name")}</ContentTableHeadCell>
                <ContentTableHeadCell compact>{t("admin.velocity.table.address")}</ContentTableHeadCell>
                <ContentTableHeadCell compact>{t("admin.velocity.table.isTry")}</ContentTableHeadCell>
                <ContentTableHeadCell compact>{t("admin.velocity.table.status")}</ContentTableHeadCell>
                <ContentTableHeadCell compact align="right">{t("admin.velocity.table.actions")}</ContentTableHeadCell>
              </tr>
            </ContentTableHeader>
            <tbody className="divide-y divide-slate-100">
              {servers.map((srv) => (
                <tr key={srv.id} className="hover:bg-slate-50/50">
                  <ContentTableCell compact className="text-slate-600">{srv.try_order}</ContentTableCell>
                  <ContentTableCell compact className="font-medium text-slate-900">{srv.name}</ContentTableCell>
                  <ContentTableCell compact className="text-slate-600 font-mono text-xs">{srv.address}</ContentTableCell>
                  <ContentTableCell compact>
                    <ContentStatusPill
                      active={Boolean(srv.is_try_server)}
                      activeLabel={t("admin.velocity.table.yes")}
                      inactiveLabel={t("admin.velocity.table.no")}
                    />
                  </ContentTableCell>
                  <ContentTableCell compact>
                    <StatusBadge status={srv.status} ping={srv.ping} />
                  </ContentTableCell>
                  <ContentTableCell compact align="right">
                    <div className="flex items-center justify-end gap-2">
                      <ContentIconActionButton
                        onClick={() => onTest(srv.id)}
                        loading={Boolean(testingMap?.[srv.id])}
                        tone="neutral"
                        icon={Play}
                        size="sm"
                        iconSize={16}
                        title={t("admin.velocity.testConnection")}
                        aria-label={t("admin.velocity.testConnection")}
                      />
                      <ContentEditDeleteActions
                        onEdit={() => onEdit(srv)}
                        onDelete={() => onDelete(srv.id)}
                        editTitle={t("admin.velocity.modal.editTitle")}
                        deleteTitle={t("admin.velocity.modal.deleteTitle")}
                        size="sm"
                        iconSize={16}
                      />
                    </div>
                  </ContentTableCell>
                </tr>
              ))}
            </tbody>
          </table>
        </ContentTableSurface>
      )}
    </div>
  );
}
