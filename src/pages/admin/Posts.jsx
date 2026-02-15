import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { Plus, FileText, Search } from "lucide-react";
import { useTranslation } from "react-i18next";
import pb from "../../lib/pocketbase";
import { getLocalizedContent } from "../../utils/postHelpers";
import { logDelete } from "../../lib/logger";
import { createAppLogger } from "../../lib/appLogger";
import { formatLocalizedDate } from "../../utils/localeFormat";
import { useUIFeedback } from "../../hooks/useUIFeedback";
import ContentPageHeader from "../../components/admin/content/ContentPageHeader";
import ContentStateBlock from "../../components/admin/content/ContentStateBlock";
import ContentPrimaryButton from "../../components/admin/content/ContentPrimaryButton";
import ContentEditDeleteActions from "../../components/admin/content/ContentEditDeleteActions";
import ContentCardSurface from "../../components/admin/content/ContentCardSurface";
import ContentTextInput from "../../components/admin/content/ContentTextInput";

/**
 * 文章管理列表页面
 * 使用卡片视图展示文章列表
 */
const logger = createAppLogger("Posts");

export default function Posts() {
  const { adminKey } = useParams();
  const navigate = useNavigate();
  const { t, i18n } = useTranslation();
  const { notify, confirm } = useUIFeedback();
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState(null);
  const [search, setSearch] = useState("");

  // 获取文章列表
  const fetchPosts = useCallback(async () => {
    try {
      setLoading(true);
      const result = await pb.collection("posts").getList(1, 100, {
        sort: "-updated",
      });
      setPosts(result.items);
    } catch (error) {
      logger.error("Failed to fetch posts:", error);
      notify(t("admin.posts.toast.fetchError"), "error");
    } finally {
      setLoading(false);
    }
  }, [notify, t]);

  useEffect(() => {
    fetchPosts();
  }, [fetchPosts]);

  const filteredPosts = useMemo(() => {
    if (!search.trim()) return posts;
    const q = search.trim().toLowerCase();
    return posts.filter((post) => {
      // 处理多语言标题（向后兼容）
      const title = typeof post.title === "string"
        ? post.title
        : (post.title?.zh || post.title?.en || post.title?.ja || "");
      const slug = post.slug || "";
      const category = post.category || "";
      return (
        title.toLowerCase().includes(q) ||
        slug.toLowerCase().includes(q) ||
        category.toLowerCase().includes(q)
      );
    });
  }, [posts, search]);

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

  // 获取分类显示文本
  const getCategoryLabel = (category) => {
    const map = {
      "公告": "announcement",
      "文档": "docs",
      "更新日志": "changelog",
    };
    const key = map[category];
    return key ? t(`admin.posts.categories.${key}`) : (category || t("admin.posts.uncategorized"));
  };

  // 删除文章
  const handleDelete = async (postId) => {
    const accepted = await confirm({
      title: t("admin.posts.delete.title"),
      message: t("admin.posts.delete.desc"),
      confirmText: t("admin.posts.delete.confirm"),
      cancelText: t("admin.posts.delete.cancel"),
      danger: true,
    });
    if (!accepted) return;

    try {
      setDeletingId(postId);

      // 先获取文章信息用于日志记录
      let postTitle = "Unknown Post";
      try {
        const post = await pb.collection("posts").getOne(postId);
        if (post.title) {
          if (typeof post.title === "object") {
            postTitle = post.title.zh || post.title.en || post.title.ja || "Unknown Post";
          } else {
            postTitle = post.title;
          }
        }
      } catch {
        logger.warn("Failed to fetch post info for logging");
      }

      await pb.collection("posts").delete(postId);

      // 记录删除日志
      await logDelete("Posts Manager", `Deleted post: ${postTitle}`);

      await fetchPosts();
      notify(t("admin.posts.toast.deleteSuccess"), "success");
    } catch (error) {
      logger.error("Failed to delete post:", error);
      notify(t("admin.posts.toast.deleteError"), "error");
    } finally {
      setDeletingId(null);
    }
  };

  // 分类颜色映射
  const getCategoryColor = (category) => {
    const colors = {
      "公告": "bg-sky-100 text-sky-800",
      "文档": "bg-emerald-100 text-emerald-800",
      "更新日志": "bg-amber-100 text-amber-800",
    };
    return colors[category] || "bg-slate-100 text-slate-800";
  };

  return (
    <div className="space-y-4">
      {/* 头部：标题 + 搜索 + 新建 */}
      <ContentPageHeader
        title={t("admin.posts.title")}
        subtitle={t("admin.posts.subtitle")}
        actions={(
          <>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <ContentTextInput
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("admin.posts.searchPlaceholder")}
              className="w-full sm:w-60 rounded-full border-slate-200 bg-white pl-8 pr-3 py-1.5 text-xs md:text-sm text-slate-900 placeholder:text-slate-400 focus:ring-[var(--color-brand-blue)]/30"
            />
          </div>
          <ContentPrimaryButton
            as={Link}
            variant="pill"
            to={`/${adminKey}/webadmin/posts/new`}
            icon={Plus}
            iconSize={16}
          >
            {t("admin.posts.new")}
          </ContentPrimaryButton>
          </>
        )}
      />

      {/* 列表内容 */}
      {loading ? (
        <ContentStateBlock
          loading
          loadingText={t("admin.posts.loading")}
          className="rounded-2xl"
        />
      ) : filteredPosts.length === 0 ? (
        <ContentStateBlock
          icon={FileText}
          title={posts.length === 0 ? t("admin.posts.empty") : t("admin.posts.noResults")}
          description={
            posts.length === 0 ? t("admin.posts.emptyDesc") : t("admin.posts.noResultsDesc")
          }
          action={posts.length === 0 ? (
            <ContentPrimaryButton
              as={Link}
              variant="pill"
              to={`/${adminKey}/webadmin/posts/new`}
              icon={Plus}
              iconSize={16}
              className="mt-1"
            >
              {t("admin.posts.new")}
            </ContentPrimaryButton>
          ) : null}
          className="rounded-2xl bg-white/80"
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filteredPosts.map((post) => (
            <ContentCardSurface
              as="article"
              key={post.id}
              className="group bg-white/90 px-4 py-3 flex flex-col gap-2 hover:border-[var(--color-brand-blue)]/70 hover:shadow-[0_10px_35px_rgba(15,23,42,0.14)] transition-[border-color,box-shadow]"
            >
              <header className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0 space-y-1">
                  <h2 className="text-sm md:text-base font-semibold text-slate-900 line-clamp-2">
                    {getLocalizedContent(post, "title", i18n.language) || t("admin.homeManager.card.unnamed")}
                  </h2>
                  <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                    {post.category ? (
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 font-medium ${getCategoryColor(
                          post.category,
                        )}`}
                      >
                        {getCategoryLabel(post.category)}
                      </span>
                    ) : (
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-500">
                        {t("admin.posts.uncategorized")}
                      </span>
                    )}
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 font-medium ${post.is_public
                          ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                          : "bg-slate-100 text-slate-700 border border-slate-200"
                        }`}
                    >
                      {post.is_public ? t("admin.posts.status.published") : t("admin.posts.status.draft")}
                    </span>
                    {post.slug && (
                      <span className="rounded-full bg-slate-50 px-2 py-0.5 font-mono text-[10px] text-slate-500 border border-slate-200">
                        {post.slug}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  <ContentEditDeleteActions
                    onEdit={() => navigate(`/${adminKey}/webadmin/posts/${post.id}`)}
                    onDelete={() => handleDelete(post.id)}
                    editTitle={t("admin.homeManager.actions.edit")}
                    deleteTitle={t("admin.homeManager.actions.delete")}
                    deleting={deletingId === post.id}
                    size="sm"
                    iconSize={14}
                    className="gap-1.5"
                  />
                </div>
              </header>

              <p className="text-xs text-slate-500">
                {t("admin.posts.lastUpdated")} {formatDate(post.updated || post.created)}
              </p>
            </ContentCardSurface>
          ))}
        </div>
      )}
    </div>
  );
}
