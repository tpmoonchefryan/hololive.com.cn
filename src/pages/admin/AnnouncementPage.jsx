import { useState, useEffect, useCallback } from "react";
import { createAppLogger } from "../../lib/appLogger";
import {
  Plus,
  Bell,
  Save,
  Eye,
  Calendar,
  Clock,
} from "lucide-react";
import pb from "../../lib/pocketbase";
import { useTranslation } from "react-i18next";
import Modal from "../../components/admin/ui/Modal";
import { formatLocalizedDate } from "../../utils/localeFormat";
import { useAdminContentTranslation } from "../../hooks/useAdminContentTranslation";
import TranslateActionButton from "../../components/admin/content/TranslateActionButton";
import { useUIFeedback } from "../../hooks/useUIFeedback";
import ContentPageHeader from "../../components/admin/content/ContentPageHeader";
import MultilangField from "../../components/admin/content/MultilangField";
import ContentStateBlock from "../../components/admin/content/ContentStateBlock";
import { useTriLanguageOptions } from "../../hooks/useTriLanguageOptions";
import ContentPrimaryButton from "../../components/admin/content/ContentPrimaryButton";
import ContentEditDeleteActions from "../../components/admin/content/ContentEditDeleteActions";
import ContentSecondaryButton from "../../components/admin/content/ContentSecondaryButton";
import ContentFieldLabel from "../../components/admin/content/ContentFieldLabel";
import ContentTextInput from "../../components/admin/content/ContentTextInput";
import ContentSelectInput from "../../components/admin/content/ContentSelectInput";
import ContentCheckboxInput from "../../components/admin/content/ContentCheckboxInput";
import ContentTableSurface from "../../components/admin/content/ContentTableSurface";
import ContentStatusPill from "../../components/admin/content/ContentStatusPill";
import ContentOptionalLink from "../../components/admin/content/ContentOptionalLink";
import ContentTableHeader from "../../components/admin/content/ContentTableHeader";
import ContentTableHeadCell from "../../components/admin/content/ContentTableHeadCell";
import ContentTableCell from "../../components/admin/content/ContentTableCell";

/**
 * Announcement Management Page
 * Manage site-wide banner announcements
 */
const logger = createAppLogger("AnnouncementPage");

export default function AnnouncementPage() {
  const { t, i18n } = useTranslation();
  const { notify, confirm } = useUIFeedback();
  const { translating, translateFields } = useAdminContentTranslation();
  const languageOptions = useTriLanguageOptions();
  const [announcements, setAnnouncements] = useState([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [formData, setFormData] = useState({
    content: { zh: "", en: "", ja: "" },
    link: "",
    is_active: false,
    start_time: "",
    end_time: "",
    type: "info",
  });

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
      notify(t("admin.announcements.toast.deleteError"), "error");
    } finally {
      setLoading(false);
    }
  }, [notify, t]);

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
      notify(t("admin.announcements.toast.updateSuccess"), "success");
    } catch (error) {
      logger.error("Failed to toggle announcement:", error);
      notify(
        error?.response?.message || error?.message || t("admin.announcements.toast.deleteError"),
        "error"
      );
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
        notify(t("admin.announcements.toast.updateSuccess"), "success");
      } else {
        saved = await pb.collection("announcements").create(saveData);
        notify(t("admin.announcements.toast.createSuccess"), "success");
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
      notify(errorMsg, "error");
    }
  };

  // AI auto translate announcement content
  const handleAutoTranslate = async () => {
    try {
      const result = await translateFields({
        scene: "announcement_editor",
        fields: [
          {
            key: "content",
            value: formData.content,
          },
        ],
      });

      if (result.changedCount === 0) {
        notify(t("admin.announcements.toast.noContent"), "error");
        return;
      }

      setFormData((prev) => ({
        ...prev,
        ...result.fields,
      }));

      notify(t("admin.announcements.toast.translateSuccess"), "success");
    } catch (error) {
      logger.error("Failed to auto-translate announcement:", error);
      const errorMsg =
        error?.response?.message ||
        error?.message ||
        t("admin.announcements.toast.translateError");
      notify(errorMsg, "error");
    }
  };

  // Delete announcement
  const handleDelete = async (id) => {
    const accepted = await confirm({
      title: t("admin.announcements.delete.title"),
      message: t("admin.announcements.delete.desc"),
      confirmText: t("admin.announcements.delete.confirm"),
      cancelText: t("admin.announcements.delete.cancel"),
      danger: true,
    });
    if (!accepted) return;

    try {
      setDeletingId(id);
      await pb.collection("announcements").delete(id);
      await fetchAnnouncements();
      notify(t("admin.announcements.toast.deleteSuccess"), "success");
    } catch (error) {
      logger.error("Failed to delete announcement:", error);
      notify(t("admin.announcements.toast.deleteError"), "error");
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
      <div className="space-y-4">
        {/* Header */}
        <ContentPageHeader
          title={t("admin.announcements.title")}
          subtitle={t("admin.announcements.subtitle")}
          actions={(
            <ContentPrimaryButton
              type="button"
              onClick={handleNew}
              variant="pill"
              icon={Plus}
              iconSize={16}
            >
              {t("admin.announcements.new")}
            </ContentPrimaryButton>
          )}
        />

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
                <TranslateActionButton
                  onClick={handleAutoTranslate}
                  translating={translating}
                  label={t("admin.announcements.form.translate")}
                  translatingLabel={t("admin.announcements.form.translating")}
                  className="px-3 py-1 text-xs"
                />
              </div>
              <MultilangField
                type="text"
                value={formData.content}
                onChange={(lang, value) =>
                  setFormData((prev) => ({
                    ...prev,
                    content: {
                      ...prev.content,
                      [lang]: value,
                    },
                  }))
                }
                languages={languageOptions}
                showAllLanguages
                requiredLangs={["zh"]}
                placeholders={{
                  zh: t("admin.announcements.form.zhPlaceholder"),
                  en: t("admin.announcements.form.enPlaceholder"),
                  ja: t("admin.announcements.form.jaPlaceholder"),
                }}
                controlClassName="w-full px-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-[var(--color-brand-blue)]/40 focus:border-transparent bg-white"
              />
            </div>

            {/* Link */}
            <div>
              <ContentFieldLabel>
                {t("admin.announcements.form.link")}
              </ContentFieldLabel>
              <ContentTextInput
                type="url"
                name="link"
                autoComplete="off"
                value={formData.link}
                onChange={(e) =>
                  setFormData({ ...formData, link: e.target.value })
                }
                className="px-4 py-2 border-slate-200"
                placeholder={t("admin.announcements.form.linkPlaceholder")}
              />
            </div>

            {/* Type */}
            <div>
              <ContentFieldLabel>
                {t("admin.announcements.form.type")}
              </ContentFieldLabel>
              <ContentSelectInput
                name="type"
                value={formData.type}
                onChange={(e) =>
                  setFormData({ ...formData, type: e.target.value })
                }
                className="px-4 py-2 border-slate-200"
              >
                <option value="info">{t("admin.announcements.form.typeInfo")}</option>
                <option value="urgent">{t("admin.announcements.form.typeUrgent")}</option>
              </ContentSelectInput>
              <p className="text-xs text-slate-500 mt-1">
                {t("admin.announcements.form.typeInfo")} / {t("admin.announcements.form.typeUrgent")}
              </p>
            </div>

            {/* Time Range */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <ContentFieldLabel>
                  <Calendar className="w-4 h-4 inline mr-1 text-slate-500" />
                  {t("admin.announcements.form.startTime")}
                </ContentFieldLabel>
                <ContentTextInput
                  type="datetime-local"
                  name="start_time"
                  autoComplete="off"
                  value={formData.start_time}
                  onChange={(e) =>
                    setFormData({ ...formData, start_time: e.target.value })
                  }
                  className="px-4 py-2 border-slate-200"
                />
              </div>
              <div>
                <ContentFieldLabel>
                  <Clock className="w-4 h-4 inline mr-1 text-slate-500" />
                  {t("admin.announcements.form.endTime")}
                </ContentFieldLabel>
                <ContentTextInput
                  type="datetime-local"
                  name="end_time"
                  autoComplete="off"
                  value={formData.end_time}
                  onChange={(e) =>
                    setFormData({ ...formData, end_time: e.target.value })
                  }
                  className="px-4 py-2 border-slate-200"
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
              <ContentCheckboxInput
                id="announcement-active"
                checked={formData.is_active}
                onChange={(e) =>
                  setFormData({ ...formData, is_active: e.target.checked })
                }
              />
              <label htmlFor="announcement-active" className="text-sm font-medium text-slate-700">
                {t("admin.announcements.form.active")}
              </label>
            </div>

            <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-200">
              <ContentSecondaryButton onClick={closeForm}>
                {t("admin.announcements.form.cancel")}
              </ContentSecondaryButton>
              <ContentPrimaryButton
                type="submit"
                icon={Save}
                iconSize={16}
              >
                {editingId ? t("admin.announcements.form.update") : t("admin.announcements.form.create")}
              </ContentPrimaryButton>
            </div>
          </form>
        </Modal>

        {/* Announcement List */}
        {loading ? (
          <ContentStateBlock
            loading
            loadingText={t("admin.announcements.loading")}
            className="rounded-2xl"
          />
        ) : announcements.length === 0 ? (
          <ContentStateBlock
            icon={Bell}
            title={t("admin.announcements.empty")}
            description={t("admin.announcements.emptyDesc")}
            action={(
              <ContentPrimaryButton
                type="button"
                onClick={handleNew}
                icon={Plus}
                iconSize={20}
              >
                {t("admin.announcements.new")}
              </ContentPrimaryButton>
            )}
            className="rounded-2xl"
          />
        ) : (
          <ContentTableSurface>
            <table className="w-full">
              <ContentTableHeader>
                <tr>
                  <ContentTableHeadCell>
                    {t("admin.announcements.table.content")}
                  </ContentTableHeadCell>
                  <ContentTableHeadCell>
                    {t("admin.announcements.table.link")}
                  </ContentTableHeadCell>
                  <ContentTableHeadCell>
                    {t("admin.announcements.table.time")}
                  </ContentTableHeadCell>
                  <ContentTableHeadCell>
                    {t("admin.announcements.table.status")}
                  </ContentTableHeadCell>
                  <ContentTableHeadCell align="right">
                    {t("admin.announcements.table.actions")}
                  </ContentTableHeadCell>
                </tr>
              </ContentTableHeader>
              <tbody className="bg-white divide-y divide-gray-200">
                {announcements.map((item) => (
                  <tr
                    key={item.id}
                    className="hover:bg-gray-50 transition-colors"
                  >
                    <ContentTableCell>
                      <div className="text-sm font-medium text-gray-900 max-w-md truncate">
                        {item.content?.zh ||
                          item.content?.en ||
                          item.content?.ja ||
                          t("admin.announcements.table.noContent")}
                      </div>
                    </ContentTableCell>
                    <ContentTableCell nowrap>
                      <ContentOptionalLink href={item.link} />
                    </ContentTableCell>
                    <ContentTableCell nowrap className="text-sm text-gray-500">
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
                    </ContentTableCell>
                    <ContentTableCell nowrap>
                      <ContentStatusPill
                        active={Boolean(item.is_active)}
                        activeLabel={t("admin.announcements.status.active")}
                        inactiveLabel={t("admin.announcements.status.disabled")}
                        onClick={() =>
                          handleToggleActive(item.id, item.is_active)
                        }
                      />
                    </ContentTableCell>
                    <ContentTableCell nowrap align="right" className="text-sm font-medium">
                      <div className="flex items-center justify-end gap-2">
                        <ContentEditDeleteActions
                          onEdit={() => handleEdit(item)}
                          onDelete={() => handleDelete(item.id)}
                          editTitle={t("admin.announcements.form.editTitle")}
                          deleteTitle={t("admin.announcements.delete.title")}
                          deleting={deletingId === item.id}
                          iconSize={16}
                          size="sm"
                        />
                      </div>
                    </ContentTableCell>
                  </tr>
                ))}
              </tbody>
            </table>
          </ContentTableSurface>
        )}
      </div>

    </div>
  );
}
