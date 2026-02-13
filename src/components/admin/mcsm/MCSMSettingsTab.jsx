import { useTranslation } from "react-i18next";
import { Save, Loader2, Wifi, Plus, Trash2, EyeOff } from "lucide-react";
import { useState } from "react";

export default function MCSMSettingsTab({ config, setConfig, saving, onSave, onTest, testingConnection }) {
    const { t } = useTranslation();
    const [newLabelUuid, setNewLabelUuid] = useState("");
    const [newLabelName, setNewLabelName] = useState("");

    if (!config) return null;

    const labels = config.instance_labels || {};
    const hiddenInstances = Array.isArray(config.hidden_instances) ? config.hidden_instances : [];

    const handleAddLabel = () => {
        if (!newLabelUuid.trim() || !newLabelName.trim()) return;
        setConfig({ ...config, instance_labels: { ...labels, [newLabelUuid.trim()]: newLabelName.trim() } });
        setNewLabelUuid("");
        setNewLabelName("");
    };

    const handleRemoveLabel = (uuid) => {
        const next = { ...labels };
        delete next[uuid];
        setConfig({ ...config, instance_labels: next });
    };

    const handleUnhide = (uuid) => {
        setConfig({ ...config, hidden_instances: hiddenInstances.filter((id) => id !== uuid) });
    };

    return (
        <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">{t("admin.mcsm.settings.panelUrl")}</label>
                    <input
                        type="url"
                        value={config.panel_url || ""}
                        onChange={(e) => setConfig({ ...config, panel_url: e.target.value })}
                        placeholder="https://mcsm.example.com"
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    />
                </div>
                <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">{t("admin.mcsm.settings.apiKey")}</label>
                    <input
                        type="password"
                        value={config.api_key || ""}
                        onChange={(e) => setConfig({ ...config, api_key: e.target.value })}
                        placeholder="API Key"
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    />
                </div>
            </div>

            <div className="flex items-center gap-4">
                <label className="flex items-center gap-2 cursor-pointer">
                    <input
                        type="checkbox"
                        checked={config.enabled || false}
                        onChange={(e) => setConfig({ ...config, enabled: e.target.checked })}
                        className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                    />
                    <span className="text-sm font-medium text-slate-700">{t("admin.mcsm.settings.enabled")}</span>
                </label>
                <div className="flex items-center gap-2">
                    <label className="text-sm font-medium text-slate-700">{t("admin.mcsm.settings.cacheTtl")}</label>
                    <input
                        type="number"
                        value={config.public_cache_ttl || 10000}
                        onChange={(e) => setConfig({ ...config, public_cache_ttl: Number(e.target.value) })}
                        min={1000}
                        className="w-24 px-2 py-1 border border-slate-300 rounded-lg text-sm"
                    />
                    <span className="text-xs text-slate-500">ms</span>
                </div>
            </div>

            <div>
                <h3 className="text-sm font-semibold text-slate-700 mb-2">{t("admin.mcsm.settings.instanceLabels")}</h3>
                <div className="space-y-2 mb-3">
                    {Object.entries(labels).map(([uuid, name]) => (
                        <div key={uuid} className="flex items-center gap-2 text-sm">
                            <code className="px-2 py-1 bg-slate-100 rounded text-xs flex-1 truncate">{uuid}</code>
                            <span className="text-slate-700">{name}</span>
                            <button onClick={() => handleRemoveLabel(uuid)} className="p-1 text-red-500 hover:text-red-700">
                                <Trash2 className="w-3.5 h-3.5" />
                            </button>
                        </div>
                    ))}
                </div>
                <div className="flex items-center gap-2">
                    <input
                        type="text"
                        value={newLabelUuid}
                        onChange={(e) => setNewLabelUuid(e.target.value)}
                        placeholder="Instance UUID"
                        className="flex-1 px-2 py-1.5 border border-slate-300 rounded-lg text-sm"
                    />
                    <input
                        type="text"
                        value={newLabelName}
                        onChange={(e) => setNewLabelName(e.target.value)}
                        placeholder={t("admin.mcsm.settings.labelName")}
                        className="flex-1 px-2 py-1.5 border border-slate-300 rounded-lg text-sm"
                    />
                    <button onClick={handleAddLabel} className="p-1.5 bg-slate-100 rounded-lg hover:bg-slate-200">
                        <Plus className="w-4 h-4" />
                    </button>
                </div>
            </div>

            {hiddenInstances.length > 0 && (
                <div>
                    <h3 className="text-sm font-semibold text-slate-700 mb-1 flex items-center gap-1.5">
                        <EyeOff className="w-3.5 h-3.5" />
                        {t("admin.mcsm.settings.hiddenInstances")}
                    </h3>
                    <p className="text-xs text-slate-500 mb-2">{t("admin.mcsm.settings.hiddenDesc")}</p>
                    <div className="space-y-1">
                        {hiddenInstances.map((uuid) => (
                            <div key={uuid} className="flex items-center gap-2 text-sm">
                                <code className="px-2 py-1 bg-slate-100 rounded text-xs flex-1 truncate">{uuid}</code>
                                {labels[uuid] && <span className="text-slate-500">{labels[uuid]}</span>}
                                <button onClick={() => handleUnhide(uuid)} className="p-1 text-amber-600 hover:text-amber-800">
                                    <Trash2 className="w-3.5 h-3.5" />
                                </button>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            <div className="flex items-center gap-3 pt-2">
                <button
                    onClick={onSave}
                    disabled={saving}
                    className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                >
                    {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                    {t("admin.mcsm.settings.save")}
                </button>
                <button
                    onClick={onTest}
                    disabled={testingConnection || !config.panel_url || !config.api_key}
                    className="flex items-center gap-2 px-4 py-2 bg-white text-slate-700 border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-50"
                >
                    {testingConnection ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wifi className="w-4 h-4" />}
                    {t("admin.mcsm.settings.testConnection")}
                </button>
            </div>
        </div>
    );
}