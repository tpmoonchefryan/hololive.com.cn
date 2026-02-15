import { Save } from "lucide-react";
import { useTranslation } from "react-i18next";
import Modal from "../ui/Modal";
import ContentFieldLabel from "../content/ContentFieldLabel";
import ContentTextInput from "../content/ContentTextInput";
import ContentCheckboxInput from "../content/ContentCheckboxInput";
import ContentSecondaryButton from "../content/ContentSecondaryButton";
import ContentPrimaryButton from "../content/ContentPrimaryButton";

export default function ServerModal({
  isOpen,
  editingServer,
  newServer,
  setNewServer,
  saving,
  onSave,
  onClose,
}) {
  const { t } = useTranslation();

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={editingServer ? t("admin.velocity.modal.editTitle") : t("admin.velocity.modal.addTitle")}
      size="sm"
    >
      <div className="space-y-4 px-6 py-5">
        <div>
          <ContentFieldLabel className="mb-1">
            {t("admin.velocity.modal.name")}
          </ContentFieldLabel>
          <ContentTextInput
            type="text"
            name="server_name"
            autoComplete="off"
            value={newServer.name}
            onChange={(e) => setNewServer({ ...newServer, name: e.target.value })}
            className="text-sm"
            placeholder={t("admin.velocity.modal.namePlaceholder")}
          />
        </div>
        <div>
          <ContentFieldLabel className="mb-1">
            {t("admin.velocity.modal.address")}
          </ContentFieldLabel>
          <ContentTextInput
            type="text"
            name="server_address"
            autoComplete="off"
            value={newServer.address}
            onChange={(e) => setNewServer({ ...newServer, address: e.target.value })}
            className="font-mono text-sm"
            placeholder={t("admin.velocity.modal.addressPlaceholder")}
          />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <ContentFieldLabel className="mb-1">
              {t("admin.velocity.modal.tryOrder")}
            </ContentFieldLabel>
            <ContentTextInput
              type="number"
              name="server_try_order"
              value={newServer.try_order}
              onChange={(e) =>
                setNewServer({ ...newServer, try_order: parseInt(e.target.value, 10) || 0 })
              }
            />
          </div>
          <div className="flex items-center pt-6">
            <label htmlFor="is-try-server" className="flex items-center gap-2 cursor-pointer">
              <ContentCheckboxInput
                id="is-try-server"
                checked={newServer.is_try_server}
                onChange={(e) => setNewServer({ ...newServer, is_try_server: e.target.checked })}
                className="w-4 h-4"
              />
              <span className="text-sm font-medium text-slate-700">
                {t("admin.velocity.modal.isTry")}
              </span>
            </label>
          </div>
        </div>
      </div>
      <div className="px-6 py-4 bg-slate-50 border-t border-slate-100 flex justify-end gap-3">
        <ContentSecondaryButton type="button" onClick={onClose}>
          {t("admin.velocity.modal.cancel")}
        </ContentSecondaryButton>
        <ContentPrimaryButton
          type="button"
          onClick={onSave}
          loading={saving}
          icon={Save}
          iconSize={14}
        >
          {t("admin.velocity.modal.save")}
        </ContentPrimaryButton>
      </div>
    </Modal>
  );
}
