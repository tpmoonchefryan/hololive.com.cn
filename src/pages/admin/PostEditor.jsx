import { lazy, Suspense, useEffect, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { Save, ArrowLeft, Loader2, Pin, Languages } from "lucide-react";
import pb from "../../lib/pocketbase";
import ImagePicker from "../../components/admin/ImagePicker";
import { logCreate, logUpdate } from "../../lib/logger";
import { useTranslation } from "react-i18next";
import { createAppLogger } from "../../lib/appLogger";
import {
  detectSourceLanguage,
  getTargetLangs,
  requestAdminTranslation,
} from "../../lib/adminTranslateApi";

/**
 * 文章编辑器组件（支持三语言）
 * 支持新建 (Create) 和编辑 (Edit) 两种模式
 */
const logger = createAppLogger("PostEditor");
const RichTextEditor = lazy(() => import("../../components/admin/editor/RichTextEditor"));

export default function PostEditor() {
  const { adminKey, id } = useParams();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const isEditMode = !!id;

  // 语言选项
  const languages = [
    { code: "zh", label: t("common.languageNames.zh") },
    { code: "en", label: t("common.languageNames.en") },
    { code: "ja", label: t("common.languageNames.ja") },
  ];
  const [activeLang, setActiveLang] = useState("zh");

  // 表单状态 - 多语言格式
  const [formData, setFormData] = useState({
    title: { zh: "", en: "", ja: "" },
    slug: "",
    category: "公告",
    content: { zh: "", en: "", ja: "" },
    is_public: false,
    summary: { zh: "", en: "", ja: "" },
    cover_ref: null,
    is_pinned: false,
  });

  // UI 状态
  const [loading, setLoading] = useState(isEditMode);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [toast, setToast] = useState(null);
  const [translating, setTranslating] = useState(false);

  // 分类选项
  const categories = ["公告", "文档", "更新日志"];

  // 从标题生成 slug
  const generateSlug = (title) => {
    if (!title) return "";
    return title
      .toLowerCase()
      .replace(/[^\w\s-]/g, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .trim();
  };

  // 处理标题变化 - 自动生成 slug（基于中文标题）
  const handleTitleChange = (value) => {
    setFormData((prev) => {
      const newTitle = { ...prev.title, [activeLang]: value };
      // 如果修改的是中文标题且 slug 为空，自动生成
      if (activeLang === "zh" && !prev.slug) {
        return {
          ...prev,
          title: newTitle,
          slug: generateSlug(value),
        };
      }
      return { ...prev, title: newTitle };
    });
  };

  // 加载文章数据（编辑模式）
  useEffect(() => {
    if (!isEditMode) return;

    const fetchPost = async () => {
      try {
        setLoading(true);
        const post = await pb.collection("posts").getOne(id, {
          expand: "cover_ref",
        });

        // 处理多语言字段：如果已经是对象则直接使用，如果是字符串则转换
        const normalizeField = (field, defaultValue = { zh: "", en: "", ja: "" }) => {
          if (!field) return defaultValue;
          if (typeof field === "string") {
            return { zh: field, en: field, ja: field };
          }
          if (typeof field === "object" && field !== null) {
            return {
              zh: field.zh || "",
              en: field.en || "",
              ja: field.ja || "",
            };
          }
          return defaultValue;
        };

        setFormData({
          title: normalizeField(post.title),
          slug: post.slug || "",
          category: post.category || "公告",
          content: normalizeField(post.content),
          is_public: post.is_public || false,
          summary: normalizeField(post.summary),
          cover_ref: post.cover_ref || null,
          is_pinned: post.is_pinned || false,
        });
        setError(null);
      } catch (err) {
        logger.error("Failed to fetch post:", err);
        setError(t("admin.postEditor.toast.loadError"));
      } finally {
        setLoading(false);
      }
    };

    fetchPost();
  }, [id, isEditMode, t]);

  // 一键智能翻译
  const handleAutoTranslate = async () => {
    try {
      setTranslating(true);
      setToast({ type: "info", message: t("admin.postEditor.toast.connectTranslate") });

      const fieldsToTranslate = ["title", "summary", "content"];
      const updatedFormData = { ...formData };
      let translatedCount = 0;

      for (let i = 0; i < fieldsToTranslate.length; i++) {
        const fieldName = fieldsToTranslate[i];
        const field = formData[fieldName];
        if (!field) continue;

        // 检测源语言
        const sourceLang = detectSourceLanguage(field);
        if (!sourceLang) continue;
        const sourceText = field[sourceLang]?.trim();
        if (!sourceText) continue;

        // 确定目标语言
        const targetLangs = getTargetLangs(sourceLang);
        if (targetLangs.length === 0) continue;

        // 添加延迟
        if (i > 0) {
          await new Promise((resolve) => setTimeout(resolve, 500));
        }

        const response = await requestAdminTranslation({
          scene: "post_editor",
          sourceLang,
          targets: targetLangs,
          fields: {
            [fieldName]: sourceText,
          },
        });
        const translatedMap = response?.translations?.[fieldName] || {};

        let hasAnyTarget = false;
        const nextFieldValue = {
          ...updatedFormData[fieldName],
        };
        for (const targetLang of targetLangs) {
          if (typeof translatedMap[targetLang] === "string") {
            nextFieldValue[targetLang] = translatedMap[targetLang];
            hasAnyTarget = true;
          }
        }
        if (hasAnyTarget) {
          updatedFormData[fieldName] = nextFieldValue;
          translatedCount++;
        }
      }

      if (translatedCount === 0) {
        setToast({
          type: "warning",
          message: t("admin.postEditor.toast.noContent"),
        });
      } else {
        setFormData(updatedFormData);
        setToast({ type: "success", message: t("admin.postEditor.toast.translateSuccess") });
      }
    } catch (err) {
      logger.error("Translation error:", err);
      setToast({
        type: "error",
        message: t("admin.postEditor.toast.translateError"),
      });
    } finally {
      setTranslating(false);
    }
  };

  // 保存文章
  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError(null);

    try {
      // 准备提交数据
      const saveData = {
        title: formData.title,
        slug: formData.slug.trim() || null,
        category: formData.category,
        content: formData.content,
        is_public: formData.is_public,
        summary: formData.summary,
        cover_ref: formData.cover_ref || null,
        is_pinned: formData.is_pinned || false,
      };

      if (isEditMode) {
        await pb.collection("posts").update(id, saveData);
        // 记录更新日志
        const title = typeof formData.title === "object"
          ? (formData.title.zh || formData.title.en || formData.title.ja || "Unknown Title")
          : formData.title || "Unknown Title";
        await logUpdate("Post Editor", `Updated post: ${title}`);
      } else {
        await pb.collection("posts").create(saveData);
        // 记录创建日志
        const title = typeof formData.title === "object"
          ? (formData.title.zh || formData.title.en || formData.title.ja || "Unknown Title")
          : formData.title || "Unknown Title";
        await logCreate("Post Editor", `Created post: ${title}`);
      }

      setToast({
        type: "success",
        message: isEditMode ? t("admin.postEditor.toast.updateSuccess") : t("admin.postEditor.toast.createSuccess"),
      });
      setTimeout(() => {
        setToast(null);
        navigate(`/${adminKey}/webadmin/posts`);
      }, 900);
    } catch (err) {
      logger.error("Failed to save post:", err);
      const errorMsg = err?.response?.message || err?.message || t("admin.postEditor.toast.saveError");
      setError(errorMsg);
      setToast({
        type: "error",
        message: t("admin.postEditor.toast.saveError"),
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Toast 提示 */}
      {toast && (
        <div
          className={`rounded-2xl px-4 py-2.5 text-xs md:text-sm flex items-center justify-between gap-3 shadow-sm ${toast.type === "success"
              ? "bg-emerald-50 text-emerald-800 border border-emerald-200"
              : toast.type === "info"
                ? "bg-blue-50 text-blue-800 border border-blue-200"
                : toast.type === "warning"
                  ? "bg-yellow-50 text-yellow-800 border border-yellow-200"
                  : "bg-red-50 text-red-800 border border-red-200"
            }`}
        >
          <span>{toast.message}</span>
          <button
            type="button"
            onClick={() => setToast(null)}
            className="text-[11px] font-medium opacity-80 hover:opacity-100"
          >
            ×
          </button>
        </div>
      )}

      {loading ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center shadow-sm">
          <Loader2 className="w-7 h-7 animate-spin text-slate-400 mx-auto mb-3" />
          <p className="text-sm text-slate-500">{t("admin.posts.loading")}</p>
        </div>
      ) : (
        <div className="space-y-5">
          <form onSubmit={handleSave} className="space-y-4">
            {/* 页面头部 */}
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-4">
                <Link
                  to={`/${adminKey}/webadmin/posts`}
                  className="text-gray-600 hover:text-gray-900 transition-colors"
                >
                  <ArrowLeft className="w-5 h-5" />
                </Link>
                <div>
                  <h1 className="text-xl md:text-2xl font-bold text-slate-900">
                    {isEditMode ? t("admin.postEditor.editTitle") : t("admin.postEditor.createTitle")}
                  </h1>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {/* 一键翻译按钮 */}
                <button
                  type="button"
                  onClick={handleAutoTranslate}
                  disabled={translating}
                  className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-4 py-1.5 text-xs md:text-sm font-semibold text-slate-900 hover:bg-slate-200 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  <Languages className="w-3.5 h-3.5" />
                  {translating ? t("admin.postEditor.translating") : t("admin.postEditor.translate")}
                </button>
                {/* 保存按钮 */}
                <button
                  type="submit"
                  disabled={saving}
                  className="inline-flex items-center gap-1.5 rounded-full bg-[var(--color-brand-blue)] px-4 py-1.5 text-xs md:text-sm font-semibold text-slate-950 shadow-[0_0_18px_rgba(142,209,252,0.8)] hover:scale-[1.02] active:scale-[0.98] transition-transform disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {saving ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      {t("admin.postEditor.saving")}
                    </>
                  ) : (
                    <>
                      <Save className="w-3.5 h-3.5" />
                      {t("admin.postEditor.save")}
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* 语言标签切换器 */}
            <div className="bg-white rounded-xl border border-slate-200 p-2 shadow-sm">
              <div className="flex gap-2">
                {languages.map((lang) => (
                  <button
                    key={lang.code}
                    type="button"
                    onClick={() => setActiveLang(lang.code)}
                    className={`flex-1 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${activeLang === lang.code
                        ? "bg-[var(--color-brand-blue)] text-slate-950 shadow-sm"
                        : "bg-slate-50 text-slate-600 hover:bg-slate-100"
                      }`}
                  >
                    {lang.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] gap-4">
              {/* 左侧：编辑区 */}
              <div className="space-y-4">
                {/* 基本信息：标题、摘要、封面图 */}
                <div className="rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm space-y-4">
                  <h2 className="text-sm font-semibold text-slate-900 border-b border-slate-200 pb-2">
                    {t("admin.postEditor.basicInfo")}
                  </h2>

                  {/* 标题（多语言） */}
                  <div className="space-y-2">
                    <label className="block text-xs font-medium text-slate-500 uppercase tracking-wide">
                      {t("admin.postEditor.titleLabel")} ({languages.find((l) => l.code === activeLang)?.label})
                    </label>
                    <input
                      type="text"
                      value={formData.title[activeLang] || ""}
                      onChange={(e) => handleTitleChange(e.target.value)}
                      className="w-full rounded-xl border border-slate-200 bg-slate-50/60 px-3.5 py-2.5 text-base md:text-lg font-semibold text-slate-900 focus:border-[var(--color-brand-blue)] focus:ring-2 focus:ring-[var(--color-brand-blue)]/30"
                      placeholder={t("admin.postEditor.titlePlaceholder")}
                      required
                    />
                  </div>

                  {/* 摘要（多语言） */}
                  <div className="space-y-2">
                    <label className="block text-xs font-medium text-slate-500 uppercase tracking-wide">
                      {t("admin.postEditor.summaryLabel")} ({languages.find((l) => l.code === activeLang)?.label})
                    </label>
                    <textarea
                      value={formData.summary[activeLang] || ""}
                      onChange={(e) =>
                        setFormData((prev) => ({
                          ...prev,
                          summary: {
                            ...prev.summary,
                            [activeLang]: e.target.value,
                          },
                        }))
                      }
                      rows={3}
                      maxLength={500}
                      className="w-full rounded-xl border border-slate-200 bg-slate-50/60 px-3.5 py-2.5 text-sm text-slate-900 focus:border-[var(--color-brand-blue)] focus:ring-2 focus:ring-[var(--color-brand-blue)]/30 resize-none"
                      placeholder={t("admin.postEditor.summaryPlaceholder")}
                    />
                    <p className="text-[11px] text-slate-500">
                      {(formData.summary[activeLang] || "").length}/500
                    </p>
                  </div>

                  {/* 封面图 */}
                  <div className="space-y-2">
                    <ImagePicker
                      value={formData.cover_ref}
                      onChange={(mediaId) =>
                        setFormData((prev) => ({
                          ...prev,
                          cover_ref: mediaId,
                        }))
                      }
                      label={t("admin.postEditor.coverLabel")}
                    />
                  </div>

                  {/* 置顶开关 */}
                  <div className="space-y-2 pt-2 border-t border-slate-200">
                    <label className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50/60 px-3 py-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={formData.is_pinned}
                        onChange={(e) =>
                          setFormData((prev) => ({
                            ...prev,
                            is_pinned: e.target.checked,
                          }))
                        }
                        className="h-4 w-4 rounded border-slate-300 text-[var(--color-brand-blue)] focus:ring-2 focus:ring-[var(--color-brand-blue)]/40"
                      />
                      <div className="flex items-center gap-2 flex-1">
                        <Pin className="w-4 h-4 text-slate-600" />
                        <div className="flex flex-col">
                          <span className="text-xs font-medium text-slate-800">
                            {t("admin.postEditor.pinned")}
                          </span>
                          <span className="text-[11px] text-slate-500">
                            {formData.is_pinned
                              ? t("admin.postEditor.pinnedDesc")
                              : t("admin.postEditor.unpinnedDesc")}
                          </span>
                        </div>
                      </div>
                    </label>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-slate-200">
                    <div className="space-y-1.5">
                      <label className="block text-xs font-medium text-slate-500 uppercase tracking-wide">
                        {t("admin.postEditor.categoryLabel")}
                      </label>
                      <select
                        value={formData.category}
                        onChange={(e) =>
                          setFormData((prev) => ({
                            ...prev,
                            category: e.target.value,
                          }))
                        }
                        className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-[var(--color-brand-blue)] focus:ring-2 focus:ring-[var(--color-brand-blue)]/30"
                      >
                        {categories.map((cat) => (
                          <option key={cat} value={cat}>
                            {t(`admin.posts.categories.${cat === "公告" ? "announcement" : (cat === "文档" ? "docs" : "changelog")}`)}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-1.5">
                      <label className="block text-xs font-medium text-slate-500 uppercase tracking-wide">
                        {t("admin.postEditor.publicStatus")}
                      </label>
                      <label className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50/60 px-3 py-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={formData.is_public}
                          onChange={(e) =>
                            setFormData((prev) => ({
                              ...prev,
                              is_public: e.target.checked,
                            }))
                          }
                          className="h-4 w-4 rounded border-slate-300 text-[var(--color-brand-blue)] focus:ring-2 focus:ring-[var(--color-brand-blue)]/40"
                        />
                        <div className="flex flex-col">
                          <span className="text-xs font-medium text-slate-800">
                            {formData.is_public ? t("admin.postEditor.public") : t("admin.postEditor.draft")}
                          </span>
                          <span className="text-[11px] text-slate-500">
                            {formData.is_public
                              ? t("admin.postEditor.publicHint")
                              : t("admin.postEditor.draftHint")}
                          </span>
                        </div>
                      </label>
                    </div>
                  </div>
                </div>

                {/* 富文本编辑区（多语言） */}
                <div className="space-y-2">
                  <label className="block text-xs font-medium text-slate-500 uppercase tracking-wide">
                    {t("admin.postEditor.contentLabel")} ({languages.find((l) => l.code === activeLang)?.label})
                  </label>
                  <Suspense
                    fallback={(
                      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm min-h-[300px] flex items-center justify-center">
                        <p className="text-sm text-slate-500">{t("admin.postEditor.editorLoading")}</p>
                      </div>
                    )}
                  >
                    <RichTextEditor
                      key={activeLang} // 使用 key 强制重新渲染编辑器
                      content={formData.content[activeLang] || ""}
                      onChange={(html) =>
                        setFormData((prev) => ({
                          ...prev,
                          content: {
                            ...prev.content,
                            [activeLang]: html,
                          },
                        }))
                      }
                      placeholder={t("admin.postEditor.contentPlaceholder")}
                    />
                  </Suspense>
                </div>
              </div>

              {/* 右侧：元数据 & Slug */}
              <div className="space-y-4">
                <div className="rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm space-y-2.5">
                  <label className="block text-xs font-medium text-slate-500 uppercase tracking-wide">
                    {t("admin.postEditor.slugLabel")}
                  </label>
                  <input
                    type="text"
                    value={formData.slug}
                    onChange={(e) =>
                      setFormData((prev) => ({
                        ...prev,
                        slug: e.target.value,
                      }))
                    }
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs md:text-sm font-mono text-slate-900 focus:border-[var(--color-brand-blue)] focus:ring-2 focus:ring-[var(--color-brand-blue)]/30"
                    placeholder="article-slug"
                  />
                  <p className="text-[11px] text-slate-500">
                    {t("admin.postEditor.slugHint")}
                  </p>
                </div>
              </div>
            </div>
          </form>

          {/* 错误提示 */}
          {error && (
            <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-2.5 text-xs md:text-sm text-red-800">
              {error}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
