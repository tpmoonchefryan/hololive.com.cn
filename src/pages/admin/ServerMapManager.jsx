import { useCallback, useEffect, useState } from "react";
import { Plus, Map, GripVertical, Save } from "lucide-react";
import pb from "../../lib/pocketbase";
import { useTranslation } from "react-i18next";
import { useUIFeedback } from "../../hooks/useUIFeedback";
import { createAppLogger } from "../../lib/appLogger";
import Modal from "../../components/admin/ui/Modal";
import ContentPageHeader from "../../components/admin/content/ContentPageHeader";
import ContentStateBlock from "../../components/admin/content/ContentStateBlock";
import ContentPrimaryButton from "../../components/admin/content/ContentPrimaryButton";
import ContentEditDeleteActions from "../../components/admin/content/ContentEditDeleteActions";
import ContentSecondaryButton from "../../components/admin/content/ContentSecondaryButton";
import ContentFieldLabel from "../../components/admin/content/ContentFieldLabel";
import ContentTextInput from "../../components/admin/content/ContentTextInput";
import ContentListSurface from "../../components/admin/content/ContentListSurface";
import ContentDraggableRow from "../../components/admin/content/ContentDraggableRow";

/**
 * Server Map Manager Page
 * Manage external links for server maps
 */
const logger = createAppLogger("ServerMapManager");

export default function ServerMapManager() {
  const { t } = useTranslation();
  const { notify, confirm } = useUIFeedback();
  const [maps, setMaps] = useState([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [isCreating, setIsCreating] = useState(false);
  const [draggedIndex, setDraggedIndex] = useState(null);

  const [formData, setFormData] = useState({
    name: "",
    url: "",
    sort_order: 0,
  });

  const normalizeMapUrl = (rawUrl) => {
    const trimmed = `${rawUrl || ""}`.trim();
    if (!trimmed) return "";

    const withProtocol = /^[a-zA-Z][a-zA-Z\d+.-]*:\/\//.test(trimmed)
      ? trimmed
      : `http://${trimmed}`;

    try {
      const parsed = new URL(withProtocol);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return "";
      }
      return parsed.toString();
    } catch {
      return "";
    }
  };

  const fetchMaps = useCallback(async () => {
    try {
      setLoading(true);
      const result = await pb.collection("server_maps").getList(1, 100, {
        sort: "sort_order",
      });
      setMaps(result.items);
    } catch (error) {
      logger.error("Failed to fetch maps:", error);
      notify(t("admin.serverMaps.toast.saveError"), "error");
    } finally {
      setLoading(false);
    }
  }, [notify, t]);

  useEffect(() => {
    fetchMaps();
  }, [fetchMaps]);

  const showToast = useCallback(
    (type, message) => {
      notify(message, type);
    },
    [notify]
  );

  const resetForm = () => {
    setFormData({ name: "", url: "", sort_order: 0 });
    setEditingId(null);
    setIsCreating(false);
  };

  const handleSave = async (event) => {
    event.preventDefault();
    const normalizedUrl = normalizeMapUrl(formData.url);
    if (!normalizedUrl) {
      showToast("error", t("admin.serverMaps.validation.invalidUrl"));
      return;
    }

    const payload = {
      ...formData,
      url: normalizedUrl,
    };

    try {
      if (editingId) {
        await pb.collection("server_maps").update(editingId, payload);
        showToast("success", t("admin.serverMaps.toast.updateSuccess"));
      } else {
        const maxSort = maps.length > 0 ? Math.max(...maps.map((item) => item.sort_order || 0)) : 0;
        await pb.collection("server_maps").create({
          ...payload,
          sort_order: payload.sort_order || maxSort + 1,
        });
        showToast("success", t("admin.serverMaps.toast.createSuccess"));
      }

      resetForm();
      await fetchMaps();
    } catch (error) {
      logger.error("Failed to save map:", error);
      showToast("error", t("admin.serverMaps.toast.saveError"));
    }
  };

  const handleDelete = async (mapId, mapName = "") => {
    const accepted = await confirm({
      title: t("admin.serverMaps.delete.title"),
      message: t("admin.serverMaps.delete.confirmHint", { name: mapName }),
      confirmText: t("admin.serverMaps.delete.confirm"),
      cancelText: t("admin.serverMaps.delete.cancel"),
      danger: true,
    });
    if (!accepted) return;

    try {
      setDeletingId(mapId);
      await pb.collection("server_maps").delete(mapId);
      showToast("success", t("admin.serverMaps.toast.deleteSuccess"));
      await fetchMaps();
    } catch (error) {
      logger.error("Failed to delete map:", error);
      showToast("error", t("admin.serverMaps.toast.saveError"));
    } finally {
      setDeletingId(null);
    }
  };

  const startEdit = (map) => {
    setFormData({
      name: map.name || "",
      url: map.url || "",
      sort_order: map.sort_order || 0,
    });
    setEditingId(map.id);
    setIsCreating(false);
  };

  const handleDragStart = (index) => {
    setDraggedIndex(index);
  };

  const handleDragOver = (event, index) => {
    event.preventDefault();
    if (draggedIndex === null || draggedIndex === index) return;

    const newMaps = [...maps];
    const draggedItem = newMaps[draggedIndex];
    newMaps.splice(draggedIndex, 1);
    newMaps.splice(index, 0, draggedItem);
    setMaps(newMaps);
    setDraggedIndex(index);
  };

  const handleDragEnd = async () => {
    if (draggedIndex === null) return;

    try {
      const updates = maps.map((map, index) => ({
        id: map.id,
        sort_order: index + 1,
      }));

      await Promise.all(
        updates.map((update) =>
          pb.collection("server_maps").update(update.id, { sort_order: update.sort_order })
        )
      );

      showToast("success", t("admin.homeManager.toast.orderSuccess"));
      await fetchMaps();
    } catch (error) {
      logger.error("Failed to update sort order:", error);
      showToast("error", t("admin.homeManager.toast.orderError"));
      await fetchMaps();
    } finally {
      setDraggedIndex(null);
    }
  };

  return (
    <div className="space-y-6">
      <ContentPageHeader
        title={t("admin.serverMaps.title")}
        subtitle={t("admin.serverMaps.subtitle")}
        actions={(
          <ContentPrimaryButton
            onClick={() => {
              resetForm();
              setIsCreating(true);
            }}
            icon={Plus}
            iconSize={18}
          >
            {t("admin.serverMaps.new")}
          </ContentPrimaryButton>
        )}
      />

      <Modal
        isOpen={isCreating || Boolean(editingId)}
        onClose={resetForm}
        title={editingId ? t("admin.serverMaps.form.editTitle") : t("admin.serverMaps.form.createTitle")}
        size="md"
      >
        <form onSubmit={handleSave} className="space-y-4 p-6">
          <div>
            <ContentFieldLabel>
              {t("admin.serverMaps.form.name")}
            </ContentFieldLabel>
            <ContentTextInput
              type="text"
              required
              value={formData.name}
              onChange={(event) => setFormData({ ...formData, name: event.target.value })}
              placeholder={t("admin.serverMaps.form.namePlaceholder")}
            />
          </div>
          <div>
            <ContentFieldLabel>
              {t("admin.serverMaps.form.url")}
            </ContentFieldLabel>
            <ContentTextInput
              type="text"
              required
              value={formData.url}
              onChange={(event) => setFormData({ ...formData, url: event.target.value })}
              placeholder={t("admin.serverMaps.form.urlPlaceholder")}
              inputMode="url"
              spellCheck={false}
            />
            <p className="text-xs text-slate-500 mt-1">
              {t("admin.serverMaps.form.urlHint")}
            </p>
          </div>
          <div>
            <ContentFieldLabel>
              {t("admin.serverMaps.form.sort")}
            </ContentFieldLabel>
            <ContentTextInput
              type="number"
              value={formData.sort_order}
              onChange={(event) =>
                setFormData({ ...formData, sort_order: parseInt(event.target.value, 10) || 0 })
              }
              placeholder={t("admin.serverMaps.form.sortPlaceholder")}
            />
          </div>
          <div className="flex gap-2 justify-end">
            <ContentSecondaryButton onClick={resetForm}>
              {t("admin.serverMaps.form.cancel")}
            </ContentSecondaryButton>
            <ContentPrimaryButton
              type="submit"
              icon={Save}
              iconSize={18}
            >
              {t("admin.serverMaps.form.save")}
            </ContentPrimaryButton>
          </div>
        </form>
      </Modal>

      {loading || maps.length === 0 ? (
        <ContentStateBlock
          loading={loading}
          loadingText={t("admin.serverMaps.loading")}
          icon={Map}
          title={t("admin.serverMaps.empty")}
          description={t("admin.serverMaps.emptyDesc")}
        />
      ) : (
        <ContentListSurface>
          {maps.map((map, index) => (
            <ContentDraggableRow
              key={map.id}
              onDragStart={() => handleDragStart(index)}
              onDragOver={(event) => handleDragOver(event, index)}
              onDragEnd={handleDragEnd}
              dragged={draggedIndex === index}
            >
              <div className="flex items-center gap-4">
                <GripVertical className="w-5 h-5 text-slate-400 cursor-move" />
                <div className="flex-1 min-w-0">
                  <h3 className="text-base font-semibold text-slate-900">{map.name}</h3>
                  <p className="text-sm text-slate-500 truncate">{map.url}</p>
                  <p className="text-xs text-slate-400 mt-1">{t("admin.serverMaps.sort")}: {map.sort_order || 0}</p>
                </div>
                <div className="flex items-center gap-2">
                  <ContentEditDeleteActions
                    onEdit={() => startEdit(map)}
                    onDelete={() => handleDelete(map.id, map.name || "")}
                    editTitle={t("admin.serverMaps.form.editTitle")}
                    deleteTitle={t("admin.serverMaps.delete.title")}
                    deleting={deletingId === map.id}
                  />
                </div>
              </div>
            </ContentDraggableRow>
          ))}
        </ContentListSurface>
      )}
    </div>
  );
}
