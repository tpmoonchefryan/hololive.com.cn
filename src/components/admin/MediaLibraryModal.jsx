import { useTranslation } from "react-i18next";
import Modal from "./ui/Modal";
import MediaManager from "./media/MediaManager";
export default function MediaLibraryModal({ isOpen, onClose, onSelect }) {
  const { t } = useTranslation();
  return <Modal isOpen={isOpen} onClose={onClose} title={t("admin.mediaLibraryModal.title")} size="xl">
    {isOpen && <div className="p-6"><MediaManager onSelect={onSelect} closeModal={onClose} selectRecord /></div>}
  </Modal>;
}
