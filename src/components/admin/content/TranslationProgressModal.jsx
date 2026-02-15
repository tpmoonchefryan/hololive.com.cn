import { useTranslation } from "react-i18next";
import Modal from "../ui/Modal";

const TERMINAL_STATUS = new Set(["succeeded", "partial_success", "failed", "canceled"]);

export default function TranslationProgressModal({ job, onCancel, onClose }) {
  const { t } = useTranslation();
  if (!job?.visible) return null;

  const status = `${job?.status || "idle"}`;
  const isTerminal = TERMINAL_STATUS.has(status);
  const percent = Number.isFinite(job?.percent) ? Math.max(0, Math.min(100, job.percent)) : 0;
  const doneUnits = Number.isFinite(job?.doneUnits) ? job.doneUnits : 0;
  const totalUnits = Number.isFinite(job?.totalUnits) ? job.totalUnits : 0;
  const elapsedSeconds = Math.max(0, Math.floor((job?.elapsedMs || 0) / 1000));
  const handleRequestClose = () => {
    if (isTerminal) {
      if (typeof onClose === "function") {
        onClose();
      }
      return;
    }
    if (!job?.canceling && typeof onCancel === "function") {
      onCancel();
    }
  };

  return (
    <Modal
      isOpen={Boolean(job?.visible)}
      onClose={handleRequestClose}
      title={t("admin.translationJob.title")}
      size="md"
    >
      <div className="space-y-4 px-6 py-5">
        <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
          {t(`admin.translationJob.status.${status}`)}
        </div>

        <div>
          <div className="mb-1 flex items-center justify-between text-xs text-slate-600">
            <span>{t("admin.translationJob.overallProgress")}</span>
            <span>{percent}%</span>
          </div>
          <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full rounded-full bg-[var(--color-brand-blue)] transition-[width] duration-300"
              style={{ width: `${percent}%` }}
            />
          </div>
        </div>

        <div className="space-y-1 text-xs text-slate-600">
          <p>{t("admin.translationJob.completedUnits")}: {doneUnits}/{totalUnits}</p>
          <p>{t("admin.translationJob.elapsed")}: {elapsedSeconds}s</p>
          <p>{t("admin.translationJob.groupProgress")}: {job?.groupIndex || 0}/{job?.groupTotal || 0}</p>
          <p>{t("admin.translationJob.currentField")}: {job?.currentField || "-"}</p>
          <p>{t("admin.translationJob.currentTarget")}: {job?.currentTarget || "-"}</p>
        </div>

        {job?.error ? (
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            {job.error}
          </div>
        ) : null}

        <div className="flex justify-end gap-2">
          {isTerminal ? (
            <button
              type="button"
              onClick={onClose}
              className="rounded-full bg-slate-900 px-4 py-1.5 text-xs font-semibold text-white hover:bg-slate-800"
            >
              {t("admin.translationJob.close")}
            </button>
          ) : (
            <button
              type="button"
              onClick={onCancel}
              disabled={job?.canceling}
              className="rounded-full border border-slate-300 bg-white px-4 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {job?.canceling
                ? t("admin.translationJob.canceling")
                : t("admin.translationJob.cancel")}
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}
