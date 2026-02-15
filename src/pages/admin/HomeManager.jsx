import { useEffect, useState, useCallback } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { Plus, ArrowUp, ArrowDown } from "lucide-react";
import pb from "../../lib/pocketbase";
import { useTranslation } from "react-i18next";
import { createAppLogger } from "../../lib/appLogger";
import { useUIFeedback } from "../../hooks/useUIFeedback";
import { formatLocalizedDate } from "../../utils/localeFormat";
import ContentPageHeader from "../../components/admin/content/ContentPageHeader";
import ContentStateBlock from "../../components/admin/content/ContentStateBlock";
import ContentPrimaryButton from "../../components/admin/content/ContentPrimaryButton";
import ContentEditDeleteActions from "../../components/admin/content/ContentEditDeleteActions";
import ContentCardSurface from "../../components/admin/content/ContentCardSurface";
import ContentIconActionButton from "../../components/admin/content/ContentIconActionButton";

/**
 * 首页分段管理页面
 * 列表展示当前的 Sections，支持新建、编辑、删除和排序
 */
const logger = createAppLogger("HomeManager");

export default function HomeManager() {
  const { t, i18n } = useTranslation();
  const { adminKey } = useParams();
  const navigate = useNavigate();
  const { notify, confirm } = useUIFeedback();
  const [sections, setSections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState(null);
  const [updatingOrder, setUpdatingOrder] = useState({});

  // 获取分段列表
  const fetchSections = useCallback(async () => {
    try {
      setLoading(true);
      const result = await pb.collection("cms_sections").getList(1, 100, {
        sort: "sort_order",
      });
      setSections(result.items);
    } catch (error) {
      logger.error("Failed to fetch sections:", error);
      notify(t("admin.homeManager.toast.fetchError"), "error");
    } finally {
      setLoading(false);
    }
  }, [notify, t]);

  useEffect(() => {
    fetchSections();
  }, [fetchSections]);

  // 删除分段
  const handleDelete = async (sectionId) => {
    const accepted = await confirm({
      title: t("admin.homeManager.delete.title"),
      message: t("admin.homeManager.delete.desc"),
      confirmText: t("admin.homeManager.actions.confirm"),
      cancelText: t("admin.homeManager.actions.cancel"),
      danger: true,
    });
    if (!accepted) return;

    try {
      setDeletingId(sectionId);
      await pb.collection("cms_sections").delete(sectionId);
      await fetchSections();
      notify(t("admin.homeManager.toast.deleteSuccess"), "success");
    } catch (error) {
      logger.error("Failed to delete section:", error);
      notify(t("admin.homeManager.toast.deleteError"), "error");
    } finally {
      setDeletingId(null);
    }
  };

  // 调整排序
  const handleMoveOrder = async (sectionId, direction) => {
    const section = sections.find((s) => s.id === sectionId);
    if (!section) return;

    const currentIndex = sections.findIndex((s) => s.id === sectionId);
    const newIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;

    if (newIndex < 0 || newIndex >= sections.length) return;

    const targetSection = sections[newIndex];
    const newOrder = section.sort_order;
    const targetOrder = targetSection.sort_order;

    try {
      setUpdatingOrder({ [sectionId]: true });
      // 交换排序值
      await pb.collection("cms_sections").update(sectionId, {
        sort_order: targetOrder,
      });
      await pb.collection("cms_sections").update(targetSection.id, {
        sort_order: newOrder,
      });
      await fetchSections();
      notify(t("admin.homeManager.toast.orderSuccess"), "success");
    } catch (error) {
      logger.error("Failed to update order:", error);
      notify(t("admin.homeManager.toast.orderError"), "error");
    } finally {
      setUpdatingOrder({});
    }
  };

  // 格式化日期
  const formatDate = (dateString) => {
    const value = formatLocalizedDate(dateString, i18n.language, {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
    return value || "-";
  };

  // 获取多语言标题（用于显示）
  const getDisplayTitle = (section) => {
    if (!section.title) return t("admin.homeManager.card.unnamed");
    if (typeof section.title === "string") return section.title;
    return section.title[i18n.language] || section.title.zh || section.title.en || section.title.ja || t("admin.homeManager.card.unnamed");
  };

  // 获取多语言副标题
  const getDisplaySubtitle = (section) => {
    if (!section.subtitle) return "";
    if (typeof section.subtitle === "string") return section.subtitle;
    return section.subtitle[i18n.language] || section.subtitle.zh || section.subtitle.en || section.subtitle.ja || "";
  };

  return (
    <div className="space-y-4">
      {/* 页面标题和新建按钮 */}
      <ContentPageHeader
        title={t("admin.homeManager.title")}
        actions={(
          <ContentPrimaryButton
            as={Link}
            to={`/${adminKey}/webadmin/home/new`}
            icon={Plus}
          >
            {t("admin.homeManager.new")}
          </ContentPrimaryButton>
        )}
      />

      {/* 分段列表 */}
      {loading ? (
        <ContentStateBlock
          loading
          loadingText={t("routeLoading", { ns: "common" })}
          className="rounded-2xl"
        />
      ) : sections.length === 0 ? (
        <ContentStateBlock
          title={t("admin.homeManager.empty")}
          className="rounded-2xl"
        />
      ) : (
        <div className="grid gap-4">
          {sections.map((section, index) => (
            <ContentCardSurface
              key={section.id}
              className="p-6 hover:shadow-md transition-shadow"
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-2">
                    <span className="text-sm font-medium text-slate-500">
                      {t("admin.homeManager.card.sort")}: {section.sort_order}
                    </span>
                    <h3 className="text-lg font-semibold text-slate-900">
                      {getDisplayTitle(section)}
                    </h3>
                  </div>
                  {section.subtitle && (
                    <p className="text-sm text-slate-600 mb-3">
                      {getDisplaySubtitle(section)}
                    </p>
                  )}
                  <div className="flex items-center gap-4 text-xs text-slate-500">
                    <span>{t("admin.homeManager.card.buttons")}: {section.buttons?.length || 0}</span>
                    <span>{t("admin.homeManager.card.updated")}: {formatDate(section.updated)}</span>
                    {section.background && (
                      <span className="text-emerald-600">{t("admin.homeManager.card.bgSet")}</span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 ml-4">
                  {/* 排序按钮 */}
                  <ContentIconActionButton
                    onClick={() => handleMoveOrder(section.id, "up")}
                    disabled={index === 0 || updatingOrder[section.id]}
                    tone="neutral"
                    icon={ArrowUp}
                    size="sm"
                    iconSize={16}
                    title={t("admin.homeManager.actions.up")}
                    aria-label={t("admin.homeManager.actions.up")}
                  />
                  <ContentIconActionButton
                    onClick={() => handleMoveOrder(section.id, "down")}
                    disabled={index === sections.length - 1 || updatingOrder[section.id]}
                    tone="neutral"
                    icon={ArrowDown}
                    size="sm"
                    iconSize={16}
                    title={t("admin.homeManager.actions.down")}
                    aria-label={t("admin.homeManager.actions.down")}
                  />
                  {/* 编辑按钮 */}
                  <ContentEditDeleteActions
                    onEdit={() => navigate(`/${adminKey}/webadmin/home/${section.id}`)}
                    onDelete={() => handleDelete(section.id)}
                    editTitle={t("admin.homeManager.actions.edit")}
                    deleteTitle={t("admin.homeManager.actions.delete")}
                    deleting={deletingId === section.id}
                    iconSize={16}
                  />
                </div>
              </div>
            </ContentCardSurface>
          ))}
        </div>
      )}
    </div>
  );
}
