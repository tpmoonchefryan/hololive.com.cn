import { useCallback, useEffect, useState } from "react";
import { createAppLogger } from "../../lib/appLogger";
import {
  Plus,
  Server,
  GripVertical,
  X,
  Save,
} from "lucide-react";
import pb from "../../lib/pocketbase";
import { useTranslation } from "react-i18next";
import { getServerInfoIcon, SERVER_INFO_ICON_NAMES } from "../../lib/serverInfoIcons";
import { useUIFeedback } from "../../hooks/useUIFeedback";
import { useAdminContentTranslation } from "../../hooks/useAdminContentTranslation";
import TranslateActionButton from "../../components/admin/content/TranslateActionButton";
import ContentPageHeader from "../../components/admin/content/ContentPageHeader";
import MultilangField from "../../components/admin/content/MultilangField";
import ContentStateBlock from "../../components/admin/content/ContentStateBlock";
import { useTriLanguageOptions } from "../../hooks/useTriLanguageOptions";
import ContentPrimaryButton from "../../components/admin/content/ContentPrimaryButton";
import ContentEditDeleteActions from "../../components/admin/content/ContentEditDeleteActions";
import ContentSecondaryButton from "../../components/admin/content/ContentSecondaryButton";
import ContentFieldLabel from "../../components/admin/content/ContentFieldLabel";
import ContentSelectInput from "../../components/admin/content/ContentSelectInput";
import ContentTextInput from "../../components/admin/content/ContentTextInput";
import ContentListSurface from "../../components/admin/content/ContentListSurface";
import ContentDraggableRow from "../../components/admin/content/ContentDraggableRow";
import ContentCardSurface from "../../components/admin/content/ContentCardSurface";
import ContentIconActionButton from "../../components/admin/content/ContentIconActionButton";

/**
 * Server Info Fields Management Page
 * Support CRUD and Drag-and-Drop Sort
 */
const logger = createAppLogger("ServerInfoFields");

export default function ServerInfoFields() {
  const { t } = useTranslation();
  const { notify, confirm } = useUIFeedback();
  const { translating, translateFields } = useAdminContentTranslation();
  const languageOptions = useTriLanguageOptions();

  const [fields, setFields] = useState([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [isCreating, setIsCreating] = useState(false);
  const [draggedIndex, setDraggedIndex] = useState(null);

  const [formData, setFormData] = useState({
    icon: "Server",
    label: { zh: "", en: "", ja: "" },
    value: { zh: "", en: "", ja: "" },
    sort_order: 0,
  });

  const fetchFields = useCallback(async () => {
    try {
      setLoading(true);
      const result = await pb.collection("server_info_details").getList(1, 100, {
        sort: "sort_order",
      });
      setFields(result.items);
    } catch (error) {
      logger.error("Failed to fetch fields:", error);
      notify(t("admin.serverInfoFields.toast.saveError"), "error");
    } finally {
      setLoading(false);
    }
  }, [notify, t]);

  useEffect(() => {
    fetchFields();
  }, [fetchFields]);

  const resetForm = () => {
    setFormData({
      icon: "Server",
      label: { zh: "", en: "", ja: "" },
      value: { zh: "", en: "", ja: "" },
      sort_order: 0,
    });
    setEditingId(null);
    setIsCreating(false);
  };

  const handleSave = async (event) => {
    event.preventDefault();

    try {
      if (editingId) {
        await pb.collection("server_info_details").update(editingId, formData);
        notify(t("admin.serverInfoFields.toast.updateSuccess"), "success");
      } else {
        const maxSort =
          fields.length > 0 ? Math.max(...fields.map((item) => item.sort_order || 0)) : 0;
        await pb.collection("server_info_details").create({
          ...formData,
          sort_order: formData.sort_order || maxSort + 1,
        });
        notify(t("admin.serverInfoFields.toast.createSuccess"), "success");
      }

      resetForm();
      await fetchFields();
    } catch (error) {
      logger.error("Failed to save field:", error);
      notify(t("admin.serverInfoFields.toast.saveError"), "error");
    }
  };

  const handleDelete = async (fieldId) => {
    const accepted = await confirm({
      title: t("admin.serverInfoFields.delete.title"),
      message: t("admin.serverInfoFields.delete.desc"),
      confirmText: t("admin.serverInfoFields.delete.confirm"),
      cancelText: t("admin.serverInfoFields.delete.cancel"),
      danger: true,
    });

    if (!accepted) return;

    try {
      setDeletingId(fieldId);
      await pb.collection("server_info_details").delete(fieldId);
      notify(t("admin.serverInfoFields.toast.deleteSuccess"), "success");
      await fetchFields();
    } catch (error) {
      logger.error("Failed to delete field:", error);
      notify(t("admin.serverInfoFields.toast.saveError"), "error");
    } finally {
      setDeletingId(null);
    }
  };

  const handleAutoTranslate = async () => {
    try {
      const result = await translateFields({
        scene: "server_info_fields",
        fields: [
          { key: "label", value: formData.label },
          { key: "value", value: formData.value },
        ],
      });

      if (result.changedCount === 0) {
        notify(t("admin.serverInfoFields.toast.noContent"), "warning");
        return;
      }

      setFormData((prev) => ({
        ...prev,
        ...result.fields,
      }));
      notify(t("admin.serverInfoFields.toast.translateSuccess"), "success");
    } catch (error) {
      logger.error("Failed to translate server info field:", error);
      notify(error?.message || t("admin.serverInfoFields.toast.translateError"), "error");
    }
  };

  const startEdit = (field) => {
    setFormData({
      icon: field.icon || "Server",
      label: field.label || { zh: "", en: "", ja: "" },
      value: field.value || { zh: "", en: "", ja: "" },
      sort_order: field.sort_order || 0,
    });
    setEditingId(field.id);
    setIsCreating(false);
  };

  const handleDragStart = (index) => {
    setDraggedIndex(index);
  };

  const handleDragOver = (event, index) => {
    event.preventDefault();
    if (draggedIndex === null || draggedIndex === index) return;

    const newFields = [...fields];
    const draggedItem = newFields[draggedIndex];
    newFields.splice(draggedIndex, 1);
    newFields.splice(index, 0, draggedItem);
    setFields(newFields);
    setDraggedIndex(index);
  };

  const handleDragEnd = async () => {
    if (draggedIndex === null) return;

    try {
      const updates = fields.map((field, index) => ({
        id: field.id,
        sort_order: index + 1,
      }));

      await Promise.all(
        updates.map((update) =>
          pb.collection("server_info_details").update(update.id, {
            sort_order: update.sort_order,
          })
        )
      );

      notify(t("admin.homeManager.toast.orderSuccess"), "success");
      await fetchFields();
    } catch (error) {
      logger.error("Failed to update sort order:", error);
      notify(t("admin.homeManager.toast.orderError"), "error");
      await fetchFields();
    } finally {
      setDraggedIndex(null);
    }
  };

  const getIconComponent = (iconName) => getServerInfoIcon(iconName);
  return (
    <div className="space-y-6">
      <ContentPageHeader
        title={t("admin.serverInfoFields.title")}
        subtitle={t("admin.serverInfoFields.subtitle")}
        actions={(
          <ContentPrimaryButton
            type="button"
            onClick={() => {
              resetForm();
              setIsCreating(true);
            }}
            icon={Plus}
            iconSize={18}
          >
            {t("admin.serverInfoFields.new")}
          </ContentPrimaryButton>
        )}
      />

      {(isCreating || editingId) && (
        <ContentCardSurface className="rounded-xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-slate-900">
              {editingId
                ? t("admin.serverInfoFields.form.editTitle")
                : t("admin.serverInfoFields.form.createTitle")}
            </h2>
            <ContentIconActionButton
              onClick={resetForm}
              tone="neutral"
              icon={X}
              size="sm"
              iconSize={20}
              title={t("actions.close", { ns: "common" })}
              aria-label={t("actions.close", { ns: "common" })}
            />
          </div>

          <form onSubmit={handleSave} className="space-y-4">
            <div>
              <ContentFieldLabel>
                {t("admin.serverInfoFields.form.icon")}
              </ContentFieldLabel>
              <ContentSelectInput
                required
                value={formData.icon}
                onChange={(event) =>
                  setFormData((prev) => ({ ...prev, icon: event.target.value }))
                }
              >
                {SERVER_INFO_ICON_NAMES.map((iconName) => (
                  <option key={iconName} value={iconName}>
                    {iconName}
                  </option>
                ))}
              </ContentSelectInput>
              <p className="text-xs text-slate-500 mt-1">
                {t("admin.serverInfoFields.form.iconHint")}
              </p>
            </div>

            <div className="flex items-center justify-end">
              <TranslateActionButton
                onClick={handleAutoTranslate}
                translating={translating}
                disabled={false}
              />
            </div>

            <MultilangField
              label={t("admin.serverInfoFields.form.label")}
              type="text"
              value={formData.label}
              onChange={(lang, value) =>
                setFormData((prev) => ({
                  ...prev,
                  label: { ...prev.label, [lang]: value },
                }))
              }
              languages={languageOptions}
              showAllLanguages
              requiredLangs={["zh"]}
              placeholders={{
                zh: "例如：服务器地址",
                en: "e.g. Server Address",
                ja: "例：サーバーアドレス",
              }}
              controlClassName="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-[var(--color-brand-blue)]/40 focus:border-[var(--color-brand-blue)]"
            />

            <MultilangField
              label={t("admin.serverInfoFields.form.value")}
              type="text"
              value={formData.value}
              onChange={(lang, value) =>
                setFormData((prev) => ({
                  ...prev,
                  value: { ...prev.value, [lang]: value },
                }))
              }
              languages={languageOptions}
              showAllLanguages
              requiredLangs={["zh"]}
              placeholders={{
                zh: "例如：play.hololive.com.cn",
                en: "e.g. play.hololive.com.cn",
                ja: "例：play.hololive.com.cn",
              }}
              controlClassName="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-[var(--color-brand-blue)]/40 focus:border-[var(--color-brand-blue)]"
            />

            <div>
              <ContentFieldLabel>
                {t("admin.serverInfoFields.form.sort")}
              </ContentFieldLabel>
              <ContentTextInput
                type="number"
                value={formData.sort_order}
                onChange={(event) =>
                  setFormData((prev) => ({
                    ...prev,
                    sort_order: parseInt(event.target.value, 10) || 0,
                  }))
                }
                placeholder="0"
              />
            </div>

            <div className="flex gap-2">
              <ContentPrimaryButton
                type="submit"
                icon={Save}
                iconSize={18}
              >
                {t("admin.serverInfoFields.form.save")}
              </ContentPrimaryButton>
              <ContentSecondaryButton onClick={resetForm}>
                {t("admin.serverInfoFields.form.cancel")}
              </ContentSecondaryButton>
            </div>
          </form>
        </ContentCardSurface>
      )}

      {loading || fields.length === 0 ? (
        <ContentStateBlock
          loading={loading}
          loadingText={t("routeLoading", { ns: "common" })}
          icon={Server}
          title={t("admin.serverInfoFields.empty")}
          description={t("admin.serverInfoFields.emptyDesc")}
        />
      ) : (
        <ContentListSurface>
          {fields.map((field, index) => {
            const IconComponent = getIconComponent(field.icon);
            return (
              <ContentDraggableRow
                key={field.id}
                onDragStart={() => handleDragStart(index)}
                onDragOver={(event) => handleDragOver(event, index)}
                onDragEnd={handleDragEnd}
                dragged={draggedIndex === index}
              >
                <div className="flex items-center gap-4">
                  <GripVertical className="w-5 h-5 text-slate-400 cursor-move" />
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <IconComponent size={20} className="text-slate-600 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <h3 className="text-base font-semibold text-slate-900">
                        {field.label?.zh ||
                          field.label?.en ||
                          field.label?.ja ||
                          t("admin.serverInfoFields.unnamed")}
                      </h3>
                      <p className="text-sm text-slate-500 truncate">
                        {typeof field.value === "object"
                          ? field.value?.zh || field.value?.en || field.value?.ja || ""
                          : field.value || ""}
                      </p>
                      <p className="text-xs text-slate-400 mt-1">
                        {t("admin.serverInfoFields.icon")}: {field.icon} | {t("admin.serverInfoFields.sort")}: {field.sort_order || 0}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <ContentEditDeleteActions
                      onEdit={() => startEdit(field)}
                      onDelete={() => handleDelete(field.id)}
                      editTitle={t("admin.serverInfoFields.form.editTitle")}
                      deleteTitle={t("admin.serverInfoFields.delete.confirm")}
                      deleting={deletingId === field.id}
                    />
                  </div>
                </div>
              </ContentDraggableRow>
            );
          })}
        </ContentListSurface>
      )}
    </div>
  );
}
