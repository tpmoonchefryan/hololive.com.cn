import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowLeft, Loader2, Calendar, Image as ImageIcon, Pin } from "lucide-react";
import { useTranslation } from "react-i18next";
import { getLocalizedContent } from "../../utils/postHelpers";
import { formatLocalizedDate } from "../../utils/localeFormat";
import ContentPagination from "../admin/content/ContentPagination";
import { usePublicPostsByCategory } from "../../hooks/usePublicPostsByCategory";

export default function PostCategoryListPage({
  category,
  icon: HeaderIcon,
  iconClassName,
  titleKey,
  descriptionKey,
  emptyKey,
  loadErrorKey,
  loggerScope,
}) {
  const { i18n, t } = useTranslation("docs");
  const baseUrl = import.meta.env.VITE_POCKETBASE_URL?.replace(/\/$/, "") || "";
  const query = usePublicPostsByCategory({
    category,
    loadErrorKey,
    loggerScope,
  });

  const { posts, loading, error } = query;

  return (
    <div className="min-h-screen w-full pt-20 pb-10 flex flex-col items-center bg-gradient-to-br from-slate-50 to-blue-50">
      <main className="flex flex-col w-full max-w-4xl mx-auto px-4 md:px-8 py-12">
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="mb-8"
        >
          <Link
            to="/docs"
            className="inline-flex items-center gap-2 text-slate-600 hover:text-slate-900 mb-4 transition-colors"
          >
            <ArrowLeft size={20} />
            <span>{t("common.backToDocs")}</span>
          </Link>
          <div className="flex items-center gap-3 mb-4">
            <HeaderIcon size={32} className={iconClassName} />
            <h1 className="text-4xl md:text-5xl font-extrabold text-slate-900">
              {t(titleKey)}
            </h1>
          </div>
          <p className="text-lg text-slate-600">{t(descriptionKey)}</p>
        </motion.div>

        {loading ? (
          <div className="flex flex-col items-center justify-center py-20">
            <Loader2 className="w-8 h-8 animate-spin text-slate-400 mb-4" />
            <p className="text-slate-600">{t("routeLoading", { ns: "common" })}</p>
          </div>
        ) : error ? (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">
            <p>{error}</p>
            <button type="button" className="mt-2 underline" onClick={query.reload}>{t("home.retry")}</button>
          </div>
        ) : posts.length === 0 ? (
          <div className="bg-white rounded-xl p-8 text-center border border-slate-200">
            <HeaderIcon size={48} className="text-slate-300 mx-auto mb-4" />
            <p className="text-slate-900">{t(emptyKey)}</p>
          </div>
        ) : (
          <div className="space-y-6">
            {posts.map((post, index) => {
              let coverUrl = null;
              if (post.expand?.cover_ref?.file) {
                coverUrl = `${baseUrl}/api/files/media/${post.expand.cover_ref.id}/${post.expand.cover_ref.file}`;
              }

              return (
                <motion.article
                  key={post.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.5, delay: index * 0.1 }}
                  className="bg-white rounded-xl border border-slate-200 shadow-lg hover:shadow-xl transition-shadow duration-300 overflow-hidden w-full"
                >
                  <Link
                    to={`/docs/article/${post.id}`}
                    className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-blue)]/30"
                  >
                    <div className="flex flex-col md:flex-row">
                      <div className="relative w-full md:w-1/3 h-48 md:h-auto bg-gradient-to-br from-slate-100 to-slate-200 overflow-hidden flex-shrink-0">
                        {coverUrl ? (
                          <img
                            src={coverUrl}
                            alt={getLocalizedContent(post, "title", i18n.language)}
                            className="w-full h-full object-cover"
                            style={{ aspectRatio: "16/9" }}
                            onError={(event) => {
                              event.target.style.display = "none";
                            }}
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center" style={{ aspectRatio: "16/9" }}>
                            <ImageIcon className="w-16 h-16 text-slate-300" />
                          </div>
                        )}
                      </div>

                      <div className="w-full md:w-2/3 p-5 md:p-6 flex flex-col justify-between">
                        <div>
                          <div className="flex items-center gap-2 mb-3">
                            <h2 className="text-xl md:text-2xl font-bold text-slate-900">
                              {getLocalizedContent(post, "title", i18n.language)}
                            </h2>
                            {post.is_pinned && (
                              <span className="inline-flex items-center gap-1 px-2 py-1 bg-blue-100 text-blue-700 rounded-full text-xs font-semibold">
                                <Pin size={12} className="fill-current" />
                                {t("common.pinned")}
                              </span>
                            )}
                          </div>
                          {getLocalizedContent(post, "summary", i18n.language) && (
                            <p className="text-sm md:text-base text-slate-600 line-clamp-2 mb-4">
                              {getLocalizedContent(post, "summary", i18n.language)}
                            </p>
                          )}
                        </div>
                        <div className="flex items-center gap-2 text-xs md:text-sm text-slate-500 pt-3 border-t border-slate-100">
                          <Calendar size={14} />
                          <span>{formatLocalizedDate(post.updated, i18n.language)}</span>
                        </div>
                      </div>
                    </div>
                  </Link>
                </motion.article>
              );
            })}
          </div>
        )}
        <ContentPagination query={query} />
      </main>
    </div>
  );
}
