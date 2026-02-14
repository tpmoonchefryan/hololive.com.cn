import { useState, useEffect, useCallback } from "react";
import { createAppLogger } from "../../lib/appLogger";
import {
  Plus,
  Edit,
  Trash2,
  Loader2,
  Bell,
  Save,
  Eye,
  Calendar,
  Clock,
  Languages,
} from "lucide-react";
import pb from "../../lib/pocketbase";
import { useTranslation } from "react-i18next";
import Modal from "../../components/admin/ui/Modal";
import { formatLocalizedDate } from "../../utils/localeFormat";
import {
  detectSourceLanguage,
  getTargetLangs,
  requestAdminTranslation,
} from "../../lib/adminTranslateApi";

/**
 * Announcement Management Page
 * Manage site-wide banner announcements
 */
const logger = createAppLogger("AnnouncementPage");

export default function AnnouncementPage() {
  const { t, i18n } = useTranslation();
  const [announcements, setAnnouncements] = useState([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [translating, setTranslating] = useState(false);
  const [formData, setFormData] = useState({
    content: { zh: "", en: "", ja: "" },
    link: "",
    is_active: false,
    start_time: "",
    end_time: "",
    type: "info",
  });
  const [toast, setToast] = useState(null);

  const closeForm = () => {
    setShowForm(false);
    setEditingId(null);
  };

  // Fetch announcements
  const fetchAnnouncements = useCallback(async () => {
    try {
      setLoading(true);
      const result = await pb.collection("announcements").getList(1, 100, {
        sort: "-created",
      });
      setAnnouncements(result.items);
    } catch (error) {
      logger.error("Failed to fetch announcements:", error);
      setToast({
        type: "error",
        message: t("admin.announcements.toast.deleteError"), // Reuse error message or add generic fetch error later
      });
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    fetchAnnouncements();
  }, [fetchAnnouncements]);

  // Format date time
  const formatDateTime = (dateString) => {
    const value = formatLocalizedDate(dateString, i18n.language, {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
    return value || "-";
  };

  // Open new form
  const handleNew = () => {
    setEditingId(null);
    setFormData({
      content: { zh: "", en: "", ja: "" },
      link: "",
      is_active: false,
      start_time: "",
      end_time: "",
      type: "info",
    });
    setShowForm(true);
  };

  // Open edit form
  const handleEdit = (item) => {
    setEditingId(item.id);
    setFormData({
      content: item.content || { zh: "", en: "", ja: "" },
      link: item.link || "",
      is_active: item.is_active || false,
      start_time: item.start_time
        ? new Date(item.start_time).toISOString().slice(0, 16)
        : "",
      end_time: item.end_time
        ? new Date(item.end_time).toISOString().slice(0, 16)
        : "",
      type: item.type || "info",
    });
    setShowForm(true);
  };

  // Toggle active status
  const handleToggleActive = async (id, currentStatus) => {
    try {
      await pb.collection("announcements").update(id, {
        is_active: !currentStatus,
      });
      await fetchAnnouncements();
      setToast({
        type: "success",
        message: t("admin.announcements.toast.updateSuccess"),
      });
    } catch (error) {
      logger.error("Failed to toggle announcement:", error);
      setToast({
        type: "error",
        message:
          error?.response?.message ||
          error?.message ||
          t("admin.announcements.toast.deleteError"),
      });
    }
  };

  // Save (Create or Update)
  const handleSave = async (e) => {
    e.preventDefault();
    try {
      const saveData = {
        content: formData.content,
        link: formData.link.trim() || "",
        is_active: formData.is_active,
        start_time: formData.start_time || null,
        end_time: formData.end_time || null,
        type: formData.type || "info",
      };

      let saved;
      if (editingId) {
        saved = await pb.collection("announcements").update(editingId, saveData);
        setToast({ type: "success", message: t("admin.announcements.toast.updateSuccess") });
      } else {
        saved = await pb.collection("announcements").create(saveData);
        setToast({ type: "success", message: t("admin.announcements.toast.createSuccess") });
      }

      // Local update to avoid immediate refetch issues
      setAnnouncements((prev) => {
        if (!prev || prev.length === 0) {
          return [saved];
        }
        if (editingId) {
          return prev.map((item) => (item.id === saved.id ? saved : item));
        }
        // Insert at top
        return [saved, ...prev];
      });

      closeForm();
    } catch (error) {
      logger.error("Failed to save announcement:", error);
      const errorMsg =
        error?.response?.message || error?.message || t("admin.announcements.toast.deleteError"); // Fallback
      setToast({ type: "error", message: errorMsg });
    }
  };

  // AI auto translate announcement content
  const handleAutoTranslate = async () => {
    try {
      const sourceLang = detectSourceLanguage(formData.content);
      if (!sourceLang || !formData.content[sourceLang]?.trim()) {
        setToast({
          type: "error",
          message: t("admin.announcements.toast.noContent"),
        });
        return;
      }

      setTranslating(true);
      const targets = getTargetLangs(sourceLang);
      const sourceText = formData.content[sourceLang].trim();

      const response = await requestAdminTranslation({
        scene: "announcement_editor",
        sourceLang,
        targets,
        fields: {
          content: sourceText,
        },
      });

      const translated = response?.translations?.content || {};
      setFormData((prev) => ({
        ...prev,
        content: {
          ...prev.content,
          ...targets.reduce((acc, lang) => {
            if (typeof translated[lang] === "string") {
              acc[lang] = translated[lang];
            }
            return acc;
          }, {}),
        },
      }));

      setToast({
        type: "success",
        message: t("admin.announcements.toast.translateSuccess"),
      });
    } catch (error) {
      logger.error("Failed to auto-translate announcement:", error);
      const errorMsg =
        error?.response?.message ||
        error?.message ||
        t("admin.announcements.toast.translateError");
      setToast({
        type: "error",
        message: errorMsg,
      });
    } finally {
      setTranslating(false);
    }
  };

  // Delete announcement
  const handleDelete = async (id) => {
    try {
      setDeletingId(id);
      await pb.collection("announcements").delete(id);
      await fetchAnnouncements();
      setDeleteConfirmId(null);
      setToast({ type: "success", message: t("admin.announcements.toast.deleteSuccess") });
    } catch (error) {
      logger.error("Failed to delete announcement:", error);
      setToast({ type: "error", message: t("admin.announcements.toast.deleteError") });
    } finally {
      setDeletingId(null);
    }
  };

  // Preview text
  const getPreviewText = () => {
    const lang = i18n.language;
    return (
      formData.content[lang] ||
      formData.content.en ||
      formData.content.zh ||
      formData.content.ja ||
      t("admin.announcements.form.previewEmpty")
    );
  };

  return (
    <div className="space-y-4">
      {/* Toast */}
      {toast && (
        <div
          className={`rounded-2xl px-4 py-2.5 text-xs md:text-sm flex items-center justify-between gap-3 shadow-sm ${toast.type === "success"
              ? "bg-emerald-50 text-emerald-800 border border-emerald-200"
              : "bg-red-50 text-red-800 border border-red-200"
            }`}
        >
          <span>{toast.message}</span>
          <button
            type="button"
            onClick={() => setToast(null)}
            className="text-[11px] font-medium opacity-80 hover:opacity-100"
          >
            {t("common.actions.close")}
          </button>
        </div>
      )}

      <div className="space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-xl md:text-2xl font-bold text-slate-900 mb-1">
              {t("admin.announcements.title")}
            </h1>
            <p className="text-xs md:text-sm text-slate-500">
              {t("admin.announcements.subtitle")}
            </p>
          </div>
          <button
            type="button"
            onClick={handleNew}
            className="inline-flex items-center gap-1.5 rounded-full bg-[var(--color-brand-blue)] px-4 py-1.5 text-xs md:text-sm font-semibold text-slate-950 shadow-[0_0_18px_rgba(142,209,252,0.8)] hover:scale-[1.02] active:scale-[0.98] transition-transform"
          >
            <Plus className="w-4 h-4" />
            {t("admin.announcements.new")}
          </button>
        </div>

        {/* Form Modal */}
        <Modal
          isOpen={showForm}
          onClose={closeForm}
          title={editingId ? t("admin.announcements.form.editTitle") : t("admin.announcements.form.createTitle")}
          size="lg"
        >
          <form onSubmit={handleSave} className="space-y-6 px-6 py-5">
            {/* Multi-language Input */}
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-3">
                <h4 className="text-sm font-semibold text-slate-800">
                  {t("admin.announcements.form.contentLabel")}
                </h4>
                <button
                  type="button"
                  disabled={translating}
                  onClick={handleAutoTranslate}
                  className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-900 hover:bg-slate-200 disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {translating ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Languages className="w-3.5 h-3.5" />
                  )}
                  {translating
                    ? t("admin.announcements.form.translating")
                    : t("admin.announcements.form.translate")}
                </button>
              </div>
              <div className="space-y-3">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">
                    {t("admin.announcements.form.zh")}
                  </label>
                  <input
                    type="text"
                    name="content_zh"
                    autoComplete="off"
                    value={formData.content.zh || ""}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        content: {
                          ...formData.content,
                          zh: e.target.value,
                        },
                      })
                    }
                    className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-[var(--color-brand-blue)]/40 focus:border-transparent bg-slate-50"
                    placeholder={t("admin.announcements.form.zhPlaceholder")}
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">
                    {t("admin.announcements.form.en")}
                  </label>
                  <input
                    type="text"
                    name="content_en"
                    autoComplete="off"
                    value={formData.content.en || ""}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        content: {
                          ...formData.content,
                          en: e.target.value,
                        },
                      })
                    }
                    className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-[var(--color-brand-blue)]/40 focus:border-transparent bg-white"
                    placeholder={t("admin.announcements.form.enPlaceholder")}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">
                    {t("admin.announcements.form.ja")}
                  </label>
                  <input
                    type="text"
                    name="content_ja"
                    autoComplete="off"
                    value={formData.content.ja || ""}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        content: {
                          ...formData.content,
                          ja: e.target.value,
                        },
                      })
                    }
                    className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-[var(--color-brand-blue)]/40 focus:border-transparent bg-white"
                    placeholder={t("admin.announcements.form.jaPlaceholder")}
                  />
                </div>
              </div>
            </div>

            {/* Link */}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">
                {t("admin.announcements.form.link")}
              </label>
              <input
                type="url"
                name="link"
                autoComplete="off"
                value={formData.link}
                onChange={(e) =>
                  setFormData({ ...formData, link: e.target.value })
                }
                className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-[var(--color-brand-blue)]/40 focus:border-transparent"
                placeholder={t("admin.announcements.form.linkPlaceholder")}
              />
            </div>

            {/* Type */}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">
                {t("admin.announcements.form.type")}
              </label>
              <select
                name="type"
                value={formData.type}
                onChange={(e) =>
                  setFormData({ ...formData, type: e.target.value })
                }
                className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-[var(--color-brand-blue)]/40 focus:border-transparent bg-white"
              >
                <option value="info">{t("admin.announcements.form.typeInfo")}</option>
                <option value="urgent">{t("admin.announcements.form.typeUrgent")}</option>
              </select>
              <p className="text-xs text-slate-500 mt-1">
                {t("admin.announcements.form.typeInfo")} / {t("admin.announcements.form.typeUrgent")}
              </p>
            </div>

            {/* Time Range */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  <Calendar className="w-4 h-4 inline mr-1 text-slate-500" />
                  {t("admin.announcements.form.startTime")}
                </label>
                <input
                  type="datetime-local"
                  name="start_time"
                  autoComplete="off"
                  value={formData.start_time}
                  onChange={(e) =>
                    setFormData({ ...formData, start_time: e.target.value })
                  }
                  className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-[var(--color-brand-blue)]/40 focus:border-transparent"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  <Clock className="w-4 h-4 inline mr-1 text-slate-500" />
                  {t("admin.announcements.form.endTime")}
                </label>
                <input
                  type="datetime-local"
                  name="end_time"
                  autoComplete="off"
                  value={formData.end_time}
                  onChange={(e) =>
                    setFormData({ ...formData, end_time: e.target.value })
                  }
                  className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-[var(--color-brand-blue)]/40 focus:border-transparent"
                />
              </div>
            </div>

            {/* Preview */}
            <div className="p-4 bg-sky-50 rounded-lg border border-sky-200">
              <div className="flex items-center gap-2 mb-2">
                <Eye className="w-4 h-4 text-sky-600" />
                <span className="text-sm font-semibold text-sky-900">
                  {t("admin.announcements.form.preview")}
                </span>
              </div>
              <p className="text-sm text-sky-800">{getPreviewText()}</p>
              {formData.link && (
                <p className="text-xs text-sky-700 mt-1">
                  {t("admin.announcements.form.details")}
                </p>
              )}
            </div>

            {/* Active Status */}
            <div className="flex items-center gap-3">
              <input
                id="announcement-active"
                type="checkbox"
                checked={formData.is_active}
                onChange={(e) =>
                  setFormData({ ...formData, is_active: e.target.checked })
                }
                className="w-5 h-5 text-blue-600 border-gray-300 rounded focus:ring-2 focus:ring-blue-500"
              />
              <label htmlFor="announcement-active" className="text-sm font-medium text-slate-700">
                {t("admin.announcements.form.active")}
              </label>
            </div>

            <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-200">
              <button
                type="button"
                onClick={closeForm}
                className="px-4 py-2 text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg font-medium transition-colors"
              >
                {t("admin.announcements.form.cancel")}
              </button>
              <button
                type="submit"
                className="flex items-center gap-2 px-4 py-2 bg-[var(--color-brand-blue)] hover:bg-sky-400 text-slate-950 rounded-lg font-medium transition-colors"
              >
                <Save className="w-4 h-4" />
                {editingId ? t("admin.announcements.form.update") : t("admin.announcements.form.create")}
              </button>
            </div>
          </form>
        </Modal>

        {/* Announcement List */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
          {loading ? (
            <div className="p-12 text-center">
              <Loader2 className="w-8 h-8 animate-spin text-gray-400 mx-auto mb-4" />
              <p className="text-gray-500">{t("admin.announcements.loading")}</p>
            </div>
          ) : announcements.length === 0 ? (
            <div className="p-12 text-center">
              <Bell className="w-16 h-16 text-gray-300 mx-auto mb-4" />
              <p className="text-gray-500 text-lg mb-2">{t("admin.announcements.empty")}</p>
              <p className="text-gray-400 text-sm mb-6">
                {t("admin.announcements.emptyDesc")}
              </p>
              <button
                type="button"
                onClick={handleNew}
                className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors"
              >
                <Plus className="w-5 h-5" />
                {t("admin.announcements.new")}
              </button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      {t("admin.announcements.table.content")}
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      {t("admin.announcements.table.link")}
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      {t("admin.announcements.table.time")}
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      {t("admin.announcements.table.status")}
                    </th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                      {t("admin.announcements.table.actions")}
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {announcements.map((item) => (
                    <tr
                      key={item.id}
                      className="hover:bg-gray-50 transition-colors"
                    >
                      <td className="px-6 py-4">
                        <div className="text-sm font-medium text-gray-900 max-w-md truncate">
                          {item.content?.zh ||
                            item.content?.en ||
                            item.content?.ja ||
                            t("admin.announcements.table.noContent")}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        {item.link ? (
                          <a
                            href={item.link}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-sm text-blue-600 hover:underline truncate max-w-xs block"
                          >
                            {item.link}
                          </a>
                        ) : (
                          <span className="text-sm text-gray-400">-</span>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        <div>
                          {item.start_time ? (
                            <div>{formatDateTime(item.start_time)}</div>
                          ) : (
                            <div className="text-gray-400">-</div>
                          )}
                          {item.end_time && (
                            <div className="text-xs">
                              - {formatDateTime(item.end_time)}
                            </div>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() =>
                            handleToggleActive(item.id, item.is_active)
                          }
                          className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full transition-colors ${item.is_active
                              ? "bg-green-100 text-green-800 hover:bg-green-200"
                              : "bg-gray-100 text-gray-800 hover:bg-gray-200"
                            }`}
                        >
                          {item.is_active ? t("admin.announcements.status.active") : t("admin.announcements.status.disabled")}
                        </button>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => handleEdit(item)}
                            className="text-blue-600 hover:text-blue-900 transition-colors"
                            title={t("admin.announcements.form.editTitle")}
                            aria-label={t("admin.announcements.form.editTitle")}
                          >
                            <Edit className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setDeleteConfirmId(item.id)}
                            className="text-red-600 hover:text-red-900 transition-colors"
                            disabled={deletingId === item.id}
                            title={t("admin.announcements.delete.title")}
                            aria-label={t("admin.announcements.delete.title")}
                          >
                            {deletingId === item.id ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <Trash2 className="w-4 h-4" />
                            )}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Delete Confirm Modal */}
      <Modal
        isOpen={Boolean(deleteConfirmId)}
        onClose={() => setDeleteConfirmId(null)}
        title={t("admin.announcements.delete.title")}
        size="sm"
      >
        <div className="space-y-5 px-6 py-5">
          <p className="text-gray-600">
            {t("admin.announcements.delete.desc")}
          </p>
          <div className="flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={() => setDeleteConfirmId(null)}
              className="px-4 py-2 text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg font-medium transition-colors"
            >
              {t("admin.announcements.delete.cancel")}
            </button>
            <button
              type="button"
              onClick={() => handleDelete(deleteConfirmId)}
              disabled={deletingId === deleteConfirmId}
              className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {deletingId === deleteConfirmId && (
                <Loader2 className="w-4 h-4 animate-spin" />
              )}
              {t("admin.announcements.delete.confirm")}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
