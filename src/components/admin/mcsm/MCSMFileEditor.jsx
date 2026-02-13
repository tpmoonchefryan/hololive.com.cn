import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { X, Save, Loader2 } from "lucide-react";

export default function MCSMFileEditor({ isOpen, fileName, uuid, daemonId, target, readFile, writeFile, onClose }) {
    const { t } = useTranslation();
    const [content, setContent] = useState("");
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (!isOpen || !target) return;
        setLoading(true);
        readFile(uuid, daemonId, target)
            .then((data) => setContent(typeof data === "string" ? data : JSON.stringify(data, null, 2)))
            .catch(() => setContent(""))
            .finally(() => setLoading(false));
    }, [isOpen, uuid, daemonId, target, readFile]);

    const handleSave = async () => {
        setSaving(true);
        try {
            await writeFile(uuid, daemonId, target, content);
            onClose();
        } catch {
            // error handled in hook
        } finally {
            setSaving(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
            <div className="bg-white rounded-xl shadow-xl w-full max-w-4xl max-h-[90vh] flex flex-col mx-4">
                <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
                    <h3 className="font-semibold text-slate-800 truncate">{fileName || target}</h3>
                    <button onClick={onClose} className="p-1 hover:bg-slate-100 rounded">
                        <X className="w-5 h-5" />
                    </button>
                </div>
                <div className="flex-1 overflow-hidden p-4">
                    {loading ? (
                        <div className="flex items-center justify-center h-full">
                            <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
                        </div>
                    ) : (
                        <textarea
                            value={content}
                            onChange={(e) => setContent(e.target.value)}
                            className="w-full h-full min-h-[400px] font-mono text-sm p-3 border border-slate-200 rounded-lg resize-none focus:ring-2 focus:ring-blue-500"
                            spellCheck={false}
                        />
                    )}
                </div>
                <div className="flex justify-end gap-3 px-6 py-4 border-t border-slate-200">
                    <button onClick={onClose} className="px-4 py-2 text-sm text-slate-700 border border-slate-200 rounded-lg hover:bg-slate-50">
                        {t("admin.mcsm.files.cancel")}
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={saving || loading}
                        className="flex items-center gap-2 px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                    >
                        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                        {t("admin.mcsm.files.save")}
                    </button>
                </div>
            </div>
        </div>
    );
}
