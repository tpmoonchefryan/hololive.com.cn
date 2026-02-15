import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { X, Save } from "lucide-react";
import ContentStateBlock from "../content/ContentStateBlock";
import ContentTextareaInput from "../content/ContentTextareaInput";
import ContentSecondaryButton from "../content/ContentSecondaryButton";
import ContentPrimaryButton from "../content/ContentPrimaryButton";
import ContentIconActionButton from "../content/ContentIconActionButton";

export default function MCSMFileEditor({
  isOpen,
  fileName,
  uuid,
  daemonId,
  target,
  readFile,
  writeFile,
  onClose,
}) {
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
          <ContentIconActionButton
            onClick={onClose}
            tone="neutral"
            icon={X}
            size="sm"
            iconSize={20}
            title={t("admin.mcsm.files.cancel")}
            aria-label={t("admin.mcsm.files.cancel")}
          />
        </div>
        <div className="flex-1 overflow-hidden p-4">
          {loading ? (
            <ContentStateBlock loading className="h-full rounded-lg" />
          ) : (
            <ContentTextareaInput
              value={content}
              onChange={(e) => setContent(e.target.value)}
              className="w-full h-full min-h-[400px] font-mono text-sm p-3 border-slate-200 resize-none"
              spellCheck={false}
            />
          )}
        </div>
        <div className="flex justify-end gap-3 px-6 py-4 border-t border-slate-200">
          <ContentSecondaryButton type="button" onClick={onClose}>
            {t("admin.mcsm.files.cancel")}
          </ContentSecondaryButton>
          <ContentPrimaryButton
            type="button"
            onClick={handleSave}
            disabled={saving || loading}
            loading={saving}
            icon={Save}
            iconSize={16}
          >
            {t("admin.mcsm.files.save")}
          </ContentPrimaryButton>
        </div>
      </div>
    </div>
  );
}
