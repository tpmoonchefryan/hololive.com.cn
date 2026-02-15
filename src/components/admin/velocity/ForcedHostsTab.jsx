import { Globe, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import ContentCardSurface from "../content/ContentCardSurface";
import ContentFieldLabel from "../content/ContentFieldLabel";
import ContentTextInput from "../content/ContentTextInput";
import ContentSelectInput from "../content/ContentSelectInput";
import ContentPrimaryButton from "../content/ContentPrimaryButton";
import ContentTableSurface from "../content/ContentTableSurface";
import ContentTableHeader from "../content/ContentTableHeader";
import ContentTableHeadCell from "../content/ContentTableHeadCell";
import ContentTableCell from "../content/ContentTableCell";
import ContentIconActionButton from "../content/ContentIconActionButton";
import ContentStateBlock from "../content/ContentStateBlock";

export default function ForcedHostsTab({
  forcedHosts,
  servers,
  newForcedHost,
  setNewForcedHost,
  onAdd,
  onDelete,
}) {
  const { t } = useTranslation();

  return (
    <div className="space-y-6">
      <ContentCardSurface className="p-4 bg-slate-50 border-slate-200">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 items-end">
          <div className="w-full">
            <ContentFieldLabel className="mb-1">
              {t("admin.velocity.forcedHosts.hostname")}
            </ContentFieldLabel>
            <ContentTextInput
              type="text"
              value={newForcedHost.hostname}
              onChange={(e) =>
                setNewForcedHost({ ...newForcedHost, hostname: e.target.value })
              }
              className="text-sm font-mono"
              placeholder="lobby.example.com"
            />
          </div>
          <div className="w-full">
            <ContentFieldLabel className="mb-1">
              {t("admin.velocity.forcedHosts.server")}
            </ContentFieldLabel>
            <ContentSelectInput
              value={newForcedHost.server}
              onChange={(e) => {
                const selected = Array.from(e.target.selectedOptions).map((opt) => opt.value);
                setNewForcedHost({ ...newForcedHost, server: selected });
              }}
              className="text-sm min-h-[92px]"
              multiple
            >
              {servers.map((server) => (
                <option key={server.id} value={server.id}>
                  {server.name} ({server.address})
                </option>
              ))}
            </ContentSelectInput>
            <p className="mt-1 text-xs text-slate-400">
              {t("admin.velocity.forcedHosts.selectServer")} (Ctrl/Cmd + Click)
            </p>
          </div>
        </div>

        <div className="mt-3">
          <ContentPrimaryButton
            type="button"
            onClick={onAdd}
            disabled={
              !newForcedHost.hostname ||
              !Array.isArray(newForcedHost.server) ||
              newForcedHost.server.length === 0
            }
          >
            {t("admin.velocity.servers.add")}
          </ContentPrimaryButton>
        </div>
      </ContentCardSurface>

      {forcedHosts.length === 0 ? (
        <ContentStateBlock
          icon={Globe}
          title={t("admin.velocity.forcedHosts.empty")}
          className="rounded-2xl"
        />
      ) : (
        <ContentTableSurface className="rounded-xl">
          <table className="w-full text-left text-sm">
            <ContentTableHeader>
              <tr>
                <ContentTableHeadCell compact>
                  {t("admin.velocity.forcedHosts.hostname")}
                </ContentTableHeadCell>
                <ContentTableHeadCell compact>
                  {t("admin.velocity.forcedHosts.server")}
                </ContentTableHeadCell>
                <ContentTableHeadCell compact align="right">
                  {t("admin.velocity.table.actions")}
                </ContentTableHeadCell>
              </tr>
            </ContentTableHeader>
            <tbody className="divide-y divide-slate-100">
              {forcedHosts.map((host) => {
                const hostServers = Array.isArray(host.server)
                  ? host.server
                  : host.server
                    ? [host.server]
                    : [];
                const targetServers = hostServers
                  .map((id) => servers.find((server) => server.id === id))
                  .filter(Boolean);

                return (
                  <tr key={host.id} className="hover:bg-slate-50/50">
                    <ContentTableCell compact className="font-medium font-mono text-slate-700">
                      {host.hostname}
                    </ContentTableCell>
                    <ContentTableCell compact className="text-slate-600">
                      {targetServers.length > 0 ? (
                        <span className="inline-flex flex-wrap items-center gap-2">
                          {targetServers.map((server) => (
                            <span
                              key={server.id}
                              className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-slate-100 text-slate-700 text-xs"
                            >
                              <span
                                className={`w-2 h-2 rounded-full ${server.status === "online" ? "bg-green-500" : "bg-slate-300"
                                  }`}
                              />
                              {server.name}
                            </span>
                          ))}
                        </span>
                      ) : (
                        Array.isArray(host.server) ? host.server.join(", ") : host.server
                      )}
                    </ContentTableCell>
                    <ContentTableCell compact align="right">
                      <ContentIconActionButton
                        onClick={() => onDelete(host.id)}
                        tone="danger"
                        icon={Trash2}
                        size="sm"
                        iconSize={16}
                        title={t("admin.velocity.modal.deleteTitle")}
                        aria-label={t("admin.velocity.modal.deleteTitle")}
                      />
                    </ContentTableCell>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </ContentTableSurface>
      )}
    </div>
  );
}
