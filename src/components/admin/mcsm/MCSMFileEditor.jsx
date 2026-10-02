import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Save } from "lucide-react";
import ContentStateBlock from "../content/ContentStateBlock";
import ContentTextareaInput from "../content/ContentTextareaInput";
import ContentSecondaryButton from "../content/ContentSecondaryButton";
import ContentPrimaryButton from "../content/ContentPrimaryButton";
import Modal from "../ui/Modal";

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
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!isOpen || !target) return;
    let cancelled = false;
    setLoading(true);
    setLoaded(false);
    setContent("");
    readFile(uuid, daemonId, target)
      .then((data) => { if (!cancelled) { setContent(data); setLoaded(true); } })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [isOpen, uuid, daemonId, target, readFile]);

  const handleSave = async () => {
    if (!loaded || loading || saving) return;
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
    <Modal isOpen={isOpen} onClose={onClose} title={fileName || target} size="lg">
        <div className="flex-1 overflow-hidden p-4">
          {loading ? (
            <ContentStateBlock loading className="h-full rounded-lg" />
          ) : !loaded ? (
            <div role="alert">{t("admin.mcsm.error.loadFailed")}</div>
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
            disabled={saving || loading || !loaded}
            loading={saving}
            icon={Save}
            iconSize={16}
          >
            {t("admin.mcsm.files.save")}
          </ContentPrimaryButton>
        </div>
    </Modal>
  );
}
