import { X } from "lucide-react";
import { useEffect, useId, useRef } from "react";
import { useTranslation } from "react-i18next";
import { createPortal } from "react-dom";
import { openDialog, isBackdropClick, trapDialogTab } from "./dialogLifecycle";

export default function Modal({ isOpen, onClose, title, children, size = "md" }) {
  const { t } = useTranslation("common");
  const dialogRef = useRef(null);
  const titleId = useId();
  useEffect(() => {
    if (isOpen) return openDialog(dialogRef.current, document.body);
  }, [isOpen]);
  if (!isOpen || typeof document === "undefined") return null;
  const sizes = { sm: "max-w-md", md: "max-w-2xl", lg: "max-w-4xl", xl: "max-w-6xl", full: "max-w-none w-screen h-dvh" };
  return createPortal(
    <dialog
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={title ? titleId : undefined}
      aria-label={title ? undefined : t("feedback.confirmTitle")}
      onKeyDown={trapDialogTab}
      onCancel={(event) => { event.preventDefault(); onClose(); }}
      onClick={(event) => { if (isBackdropClick(event)) onClose(); }}
      className={`m-auto w-[calc(100%-2rem)] ${sizes[size]} max-h-[calc(100dvh-2rem)] rounded-2xl bg-white p-0 text-slate-900 shadow-xl backdrop:bg-black/50`}
    >
      <div className="flex items-center justify-between gap-4 px-6 py-4 border-b border-slate-200">
        {title && <h2 id={titleId} className="text-lg font-semibold truncate">{title}</h2>}
        <button type="button" onClick={onClose} className="ml-auto p-2 rounded-lg hover:bg-slate-100" aria-label={t("actions.close")}>
          <X className="w-5 h-5 text-slate-600" />
        </button>
      </div>
      <div className={`overflow-y-auto overscroll-contain ${size === "full" ? "h-[calc(100dvh-6rem)]" : "max-h-[calc(100dvh-8rem)]"}`}>{children}</div>
    </dialog>, document.body);
}
