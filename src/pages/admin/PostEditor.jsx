import { lazy, Suspense, useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Save, Pin } from "lucide-react";
import pb from "../../lib/pocketbase";
import ImagePicker from "../../components/admin/ImagePicker";
import { logCreate, logUpdate } from "../../lib/logger";
import { useTranslation } from "react-i18next";
import { createAppLogger } from "../../lib/appLogger";
import { useAdminContentTranslation } from "../../hooks/useAdminContentTranslation";
import TranslateActionButton from "../../components/admin/content/TranslateActionButton";
import { useUIFeedback } from "../../hooks/useUIFeedback";
import MultilangField from "../../components/admin/content/MultilangField";
import MultilangTabs from "../../components/admin/content/MultilangTabs";
import { useTriLanguageOptions } from "../../hooks/useTriLanguageOptions";
import ContentEditorHeader from "../../components/admin/content/ContentEditorHeader";
import ContentStateBlock from "../../components/admin/content/ContentStateBlock";
import ContentFormCard from "../../components/admin/content/ContentFormCard";
import ContentPrimaryButton from "../../components/admin/content/ContentPrimaryButton";
import ContentFieldLabel from "../../components/admin/content/ContentFieldLabel";
import ContentTextInput from "../../components/admin/content/ContentTextInput";
import ContentSelectInput from "../../components/admin/content/ContentSelectInput";
import ContentCheckboxInput from "../../components/admin/content/ContentCheckboxInput";
import TranslationProgressModal from "../../components/admin/content/TranslationProgressModal";

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
  const { notify } = useUIFeedback();
  const {
    translating,
    translationJob,
    translateFields,
    cancelTranslationJob,
    closeTranslationProgress,
  } = useAdminContentTranslation();
  const isEditMode = !!id;

  // 语言选项
  const languages = useTriLanguageOptions();
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
      const result = await translateFields({
        scene: "post_editor",
        fields: [
          { key: "title", value: formData.title },
          { key: "summary", value: formData.summary },
          { key: "content", value: formData.content },
        ],
      });

      if (result.changedCount === 0) {
        notify(t("admin.postEditor.toast.noContent"), "warning");
      } else {
        setFormData((prev) => ({
          ...prev,
          ...result.fields,
        }));
        notify(
          result.partial
            ? t("admin.translationJob.toast.partial")
            : t("admin.postEditor.toast.translateSuccess"),
          result.partial ? "warning" : "success"
        );
      }
    } catch (err) {
      if (err?.code === "TRANSLATION_CANCELED") {
        notify(t("admin.translationJob.toast.canceled"), "warning");
        return;
      }
      logger.error("Translation error:", err);
      notify(t("admin.postEditor.toast.translateError"), "error");
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

      notify(
        isEditMode ? t("admin.postEditor.toast.updateSuccess") : t("admin.postEditor.toast.createSuccess"),
        "success"
      );
      setTimeout(() => {
        navigate(`/${adminKey}/webadmin/posts`);
      }, 900);
    } catch (err) {
      logger.error("Failed to save post:", err);
      const errorMsg = err?.response?.message || err?.message || t("admin.postEditor.toast.saveError");
      setError(errorMsg);
      notify(t("admin.postEditor.toast.saveError"), "error");
    } finally {
      setSaving(false);
    }
  };

  const activeLangLabel = languages.find((lang) => lang.code === activeLang)?.label || "";

  return (
    <div className="space-y-4">
      {loading ? (
        <ContentStateBlock
          loading
          loadingText={t("admin.posts.loading")}
          className="rounded-2xl"
        />
      ) : (
        <div className="space-y-5">
          <form onSubmit={handleSave} className="space-y-4">
            {/* 页面头部 */}
            <ContentEditorHeader
              backTo={`/${adminKey}/webadmin/posts`}
              title={isEditMode ? t("admin.postEditor.editTitle") : t("admin.postEditor.createTitle")}
              actions={(
                <>
                  <TranslateActionButton
                    onClick={handleAutoTranslate}
                    translating={translating}
                  />
                  <ContentPrimaryButton
                    type="submit"
                    disabled={saving}
                    variant="pill"
                    icon={Save}
                    iconSize={14}
                    loading={saving}
                    loadingLabel={t("admin.postEditor.saving")}
                  >
                    {t("admin.postEditor.save")}
                  </ContentPrimaryButton>
                </>
              )}
            />

            {/* 语言标签切换器 */}
            <div className="bg-white rounded-xl border border-slate-200 p-2 shadow-sm">
              <MultilangTabs
                languages={languages}
                activeLang={activeLang}
                onChange={setActiveLang}
                stretch
                buttonBaseClassName="px-4 py-2 text-sm font-medium shadow-sm"
                activeButtonClassName="bg-[var(--color-brand-blue)] text-slate-950"
                inactiveButtonClassName="bg-slate-50 text-slate-600 hover:bg-slate-100"
              />
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] gap-4">
              {/* 左侧：编辑区 */}
              <div className="space-y-4">
                {/* 基本信息：标题、摘要、封面图 */}
                <ContentFormCard
                  title={t("admin.postEditor.basicInfo")}
                  className="space-y-4"
                >

                  {/* 标题（多语言） */}
                  <MultilangField
                    label={`${t("admin.postEditor.titleLabel")} (${activeLangLabel})`}
                    type="text"
                    value={formData.title}
                    onChange={(_, value) => handleTitleChange(value)}
                    activeLang={activeLang}
                    showTabs={false}
                    required
                    placeholder={t("admin.postEditor.titlePlaceholder")}
                    controlClassName="w-full rounded-xl border border-slate-200 bg-slate-50/60 px-3.5 py-2.5 text-base md:text-lg font-semibold text-slate-900 focus:border-[var(--color-brand-blue)] focus:ring-2 focus:ring-[var(--color-brand-blue)]/30"
                    labelClassName="block text-xs font-medium text-slate-500 uppercase tracking-wide"
                    className="space-y-2"
                  />

                  {/* 摘要（多语言） */}
                  <MultilangField
                    label={`${t("admin.postEditor.summaryLabel")} (${activeLangLabel})`}
                    type="textarea"
                    value={formData.summary}
                    onChange={(lang, value) =>
                      setFormData((prev) => ({
                        ...prev,
                        summary: {
                          ...prev.summary,
                          [lang]: value,
                        },
                      }))
                    }
                    activeLang={activeLang}
                    showTabs={false}
                    rows={3}
                    maxLength={500}
                    placeholder={t("admin.postEditor.summaryPlaceholder")}
                    controlClassName="w-full rounded-xl border border-slate-200 bg-slate-50/60 px-3.5 py-2.5 text-sm text-slate-900 focus:border-[var(--color-brand-blue)] focus:ring-2 focus:ring-[var(--color-brand-blue)]/30 resize-none"
                    labelClassName="block text-xs font-medium text-slate-500 uppercase tracking-wide"
                    className="space-y-2"
                    afterControl={(
                      <p className="text-[11px] text-slate-500">
                        {(formData.summary[activeLang] || "").length}/500
                      </p>
                    )}
                  />

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
                      <ContentCheckboxInput
                        checked={formData.is_pinned}
                        onChange={(e) =>
                          setFormData((prev) => ({
                            ...prev,
                            is_pinned: e.target.checked,
                          }))
                        }
                        className="h-4 w-4"
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
                      <ContentFieldLabel className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-1.5">
                        {t("admin.postEditor.categoryLabel")}
                      </ContentFieldLabel>
                      <ContentSelectInput
                        value={formData.category}
                        onChange={(e) =>
                          setFormData((prev) => ({
                            ...prev,
                            category: e.target.value,
                          }))
                        }
                        className="rounded-xl border-slate-200 px-3 py-2 text-sm text-slate-900"
                      >
                        {categories.map((cat) => (
                          <option key={cat} value={cat}>
                            {t(`admin.posts.categories.${cat === "公告" ? "announcement" : (cat === "文档" ? "docs" : "changelog")}`)}
                          </option>
                        ))}
                      </ContentSelectInput>
                    </div>
                    <div className="space-y-1.5">
                      <label className="block text-xs font-medium text-slate-500 uppercase tracking-wide">
                        {t("admin.postEditor.publicStatus")}
                      </label>
                      <label className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50/60 px-3 py-2 cursor-pointer">
                        <ContentCheckboxInput
                          checked={formData.is_public}
                          onChange={(e) =>
                            setFormData((prev) => ({
                              ...prev,
                              is_public: e.target.checked,
                            }))
                          }
                          className="h-4 w-4"
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
                </ContentFormCard>

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
                <ContentFormCard className="space-y-2.5">
                  <ContentFieldLabel className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-0">
                    {t("admin.postEditor.slugLabel")}
                  </ContentFieldLabel>
                  <ContentTextInput
                    type="text"
                    value={formData.slug}
                    onChange={(e) =>
                      setFormData((prev) => ({
                        ...prev,
                        slug: e.target.value,
                      }))
                    }
                    className="rounded-xl border-slate-200 bg-slate-50 px-3 py-2 text-xs md:text-sm font-mono text-slate-900"
                    placeholder="article-slug"
                  />
                  <p className="text-[11px] text-slate-500">
                    {t("admin.postEditor.slugHint")}
                  </p>
                </ContentFormCard>
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
      <TranslationProgressModal
        job={translationJob}
        onCancel={cancelTranslationJob}
        onClose={closeTranslationProgress}
      />
    </div>
  );
}
