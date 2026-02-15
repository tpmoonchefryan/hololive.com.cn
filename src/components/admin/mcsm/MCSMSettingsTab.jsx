import { useTranslation } from "react-i18next";
import { Save, Wifi, Plus, Trash2, EyeOff } from "lucide-react";
import { useState } from "react";
import ContentFieldLabel from "../content/ContentFieldLabel";
import ContentTextInput from "../content/ContentTextInput";
import ContentCheckboxInput from "../content/ContentCheckboxInput";
import ContentPrimaryButton from "../content/ContentPrimaryButton";
import ContentSecondaryButton from "../content/ContentSecondaryButton";
import ContentIconActionButton from "../content/ContentIconActionButton";
import ContentInlineActionButton from "../content/ContentInlineActionButton";

export default function MCSMSettingsTab({
  config,
  setConfig,
  saving,
  onSave,
  onTest,
  testingConnection,
}) {
  const { t } = useTranslation();
  const [newLabelUuid, setNewLabelUuid] = useState("");
  const [newLabelName, setNewLabelName] = useState("");

  if (!config) return null;

  const labels = config.instance_labels || {};
  const hiddenInstances = Array.isArray(config.hidden_instances)
    ? config.hidden_instances
    : [];

  const handleAddLabel = () => {
    if (!newLabelUuid.trim() || !newLabelName.trim()) return;
    setConfig({
      ...config,
      instance_labels: {
        ...labels,
        [newLabelUuid.trim()]: newLabelName.trim(),
      },
    });
    setNewLabelUuid("");
    setNewLabelName("");
  };

  const handleRemoveLabel = (uuid) => {
    const next = { ...labels };
    delete next[uuid];
    setConfig({ ...config, instance_labels: next });
  };

  const handleUnhide = (uuid) => {
    setConfig({
      ...config,
      hidden_instances: hiddenInstances.filter((id) => id !== uuid),
    });
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <ContentFieldLabel className="mb-1">
            {t("admin.mcsm.settings.panelUrl")}
          </ContentFieldLabel>
          <ContentTextInput
            type="url"
            value={config.panel_url || ""}
            onChange={(e) => setConfig({ ...config, panel_url: e.target.value })}
            placeholder="https://mcsm.example.com"
          />
        </div>
        <div>
          <ContentFieldLabel className="mb-1">
            {t("admin.mcsm.settings.apiKey")}
          </ContentFieldLabel>
          <ContentTextInput
            type="password"
            value={config.api_key || ""}
            onChange={(e) => setConfig({ ...config, api_key: e.target.value })}
            placeholder="API Key"
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 cursor-pointer">
          <ContentCheckboxInput
            checked={config.enabled || false}
            onChange={(e) => setConfig({ ...config, enabled: e.target.checked })}
            className="w-4 h-4"
          />
          <span className="text-sm font-medium text-slate-700">
            {t("admin.mcsm.settings.enabled")}
          </span>
        </label>
        <div className="flex items-center gap-2">
          <ContentFieldLabel className="mb-0 text-sm">
            {t("admin.mcsm.settings.cacheTtl")}
          </ContentFieldLabel>
          <ContentTextInput
            type="number"
            value={config.public_cache_ttl || 10000}
            onChange={(e) =>
              setConfig({ ...config, public_cache_ttl: Number(e.target.value) })
            }
            min={1000}
            className="w-24 px-2 py-1 text-sm"
          />
          <span className="text-xs text-slate-500">ms</span>
        </div>
      </div>

      <div>
        <h3 className="text-sm font-semibold text-slate-700 mb-2">
          {t("admin.mcsm.settings.instanceLabels")}
        </h3>
        <div className="space-y-2 mb-3">
          {Object.entries(labels).map(([uuid, name]) => (
            <div key={uuid} className="flex items-center gap-2 text-sm">
              <code className="px-2 py-1 bg-slate-100 rounded text-xs flex-1 truncate">
                {uuid}
              </code>
              <span className="text-slate-700">{name}</span>
              <ContentIconActionButton
                onClick={() => handleRemoveLabel(uuid)}
                tone="danger"
                icon={Trash2}
                size="sm"
                iconSize={14}
                title={t("admin.mcsm.files.delete")}
                aria-label={t("admin.mcsm.files.delete")}
              />
            </div>
          ))}
        </div>
        <div className="flex flex-col md:flex-row items-stretch md:items-center gap-2">
          <ContentTextInput
            type="text"
            value={newLabelUuid}
            onChange={(e) => setNewLabelUuid(e.target.value)}
            placeholder="Instance UUID"
            className="flex-1 px-2 py-1.5 text-sm"
          />
          <ContentTextInput
            type="text"
            value={newLabelName}
            onChange={(e) => setNewLabelName(e.target.value)}
            placeholder={t("admin.mcsm.settings.labelName")}
            className="flex-1 px-2 py-1.5 text-sm"
          />
          <ContentInlineActionButton
            type="button"
            onClick={handleAddLabel}
            tone="neutral"
            icon={Plus}
            iconSize={16}
            className="justify-center"
          >
            {t("admin.mcsm.files.create")}
          </ContentInlineActionButton>
        </div>
      </div>

      {hiddenInstances.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-slate-700 mb-1 flex items-center gap-1.5">
            <EyeOff className="w-3.5 h-3.5" />
            {t("admin.mcsm.settings.hiddenInstances")}
          </h3>
          <p className="text-xs text-slate-500 mb-2">
            {t("admin.mcsm.settings.hiddenDesc")}
          </p>
          <div className="space-y-1">
            {hiddenInstances.map((uuid) => (
              <div key={uuid} className="flex items-center gap-2 text-sm">
                <code className="px-2 py-1 bg-slate-100 rounded text-xs flex-1 truncate">
                  {uuid}
                </code>
                {labels[uuid] && <span className="text-slate-500">{labels[uuid]}</span>}
                <ContentIconActionButton
                  onClick={() => handleUnhide(uuid)}
                  tone="edit"
                  icon={Trash2}
                  size="sm"
                  iconSize={14}
                  title={t("admin.mcsm.instances.unhide")}
                  aria-label={t("admin.mcsm.instances.unhide")}
                />
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex items-center gap-3 pt-2">
        <ContentPrimaryButton
          type="button"
          onClick={onSave}
          disabled={saving}
          loading={saving}
          icon={Save}
          iconSize={16}
        >
          {t("admin.mcsm.settings.save")}
        </ContentPrimaryButton>
        <ContentSecondaryButton
          type="button"
          onClick={onTest}
          disabled={testingConnection || !config.panel_url || !config.api_key}
          className="inline-flex items-center gap-2"
        >
          <Wifi className="w-4 h-4" />
          {t("admin.mcsm.settings.testConnection")}
        </ContentSecondaryButton>
      </div>
    </div>
  );
}
