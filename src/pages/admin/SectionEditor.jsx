import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Save, Plus, Trash2 } from "lucide-react";
import pb from "../../lib/pocketbase";
import ImagePicker from "../../components/admin/ImagePicker";
import { useTranslation } from "react-i18next";
import { createAppLogger } from "../../lib/appLogger";
import { useUIFeedback } from "../../hooks/useUIFeedback";
import { useAdminContentTranslation } from "../../hooks/useAdminContentTranslation";
import TranslateActionButton from "../../components/admin/content/TranslateActionButton";
import MultilangField from "../../components/admin/content/MultilangField";
import MultilangTabs from "../../components/admin/content/MultilangTabs";
import { useTriLanguageOptions } from "../../hooks/useTriLanguageOptions";
import ContentEditorHeader from "../../components/admin/content/ContentEditorHeader";
import ContentStateBlock from "../../components/admin/content/ContentStateBlock";
import ContentFormCard from "../../components/admin/content/ContentFormCard";
import ContentPrimaryButton from "../../components/admin/content/ContentPrimaryButton";
import ContentIconActionButton from "../../components/admin/content/ContentIconActionButton";
import ContentFieldLabel from "../../components/admin/content/ContentFieldLabel";
import ContentTextInput from "../../components/admin/content/ContentTextInput";
import ContentSelectInput from "../../components/admin/content/ContentSelectInput";
import ContentInlineActionButton from "../../components/admin/content/ContentInlineActionButton";
import ContentSubItemCard from "../../components/admin/content/ContentSubItemCard";

/**
 * 首页分段编辑器组件
 * 支持新建和编辑两种模式
 */
const logger = createAppLogger("SectionEditor");

const emptyI18nMap = () => ({ zh: "", en: "", ja: "" });

export default function SectionEditor() {
  const { adminKey, id } = useParams();
  const navigate = useNavigate();
  const { t } = useTranslation("admin");
  const { notify } = useUIFeedback();
  const { translating, translateFields, translateField } = useAdminContentTranslation();
  const languages = useTriLanguageOptions();
  const isEditMode = !!id;

  const [activeLang, setActiveLang] = useState("zh");

  const [formData, setFormData] = useState({
    title: emptyI18nMap(),
    subtitle: emptyI18nMap(),
    content: emptyI18nMap(),
    announcement: emptyI18nMap(),
    sort_order: 1,
    buttons: [],
    background_ref: null,
  });

  const [loading, setLoading] = useState(isEditMode);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [legacyBackgroundUrl, setLegacyBackgroundUrl] = useState(null);

  useEffect(() => {
    if (!isEditMode) {
      const fetchMaxOrder = async () => {
        try {
          const result = await pb.collection("cms_sections").getList(1, 1, {
            sort: "-sort_order",
          });
          const maxOrder = result.items.length > 0 ? result.items[0].sort_order : 0;
          setFormData((prev) => ({ ...prev, sort_order: maxOrder + 1 }));
        } catch (err) {
          logger.error("Failed to fetch max order:", err);
        }
      };

      fetchMaxOrder();
      return;
    }

    const fetchSection = async () => {
      try {
        setLoading(true);
        const section = await pb.collection("cms_sections").getOne(id, {
          expand: "background_ref",
        });

        const normalizeMultilang = (value) => {
          if (value && typeof value === "object") {
            return {
              zh: value.zh || "",
              en: value.en || "",
              ja: value.ja || "",
            };
          }
          return {
            zh: value || "",
            en: "",
            ja: "",
          };
        };

        const normalizedButtons = Array.isArray(section.buttons)
          ? section.buttons.map((button) => ({
              label: normalizeMultilang(button?.label),
              link: button?.link || "#",
              style: button?.style || "primary",
            }))
          : [];

        setFormData({
          title: normalizeMultilang(section.title),
          subtitle: normalizeMultilang(section.subtitle),
          content: normalizeMultilang(section.content),
          announcement: normalizeMultilang(section.announcement),
          sort_order: section.sort_order || 1,
          buttons: normalizedButtons,
          background_ref: section.background_ref || null,
        });

        let legacyUrl = null;
        if (section.background_ref && section.expand?.background_ref?.file) {
          legacyUrl = pb.files.getUrl(section.expand.background_ref, section.expand.background_ref.file);
        } else if (section.background) {
          legacyUrl = pb.files.getUrl(section, section.background);
        }
        setLegacyBackgroundUrl(legacyUrl);

        setError(null);
      } catch (err) {
        logger.error("Failed to fetch section:", err);
        setError(t("sectionEditor.toast.saveError"));
      } finally {
        setLoading(false);
      }
    };

    fetchSection();
  }, [id, isEditMode, t]);

  const updateMultilangField = (field, lang, value) => {
    setFormData((prev) => ({
      ...prev,
      [field]: {
        ...prev[field],
        [lang]: value,
      },
    }));
  };

  const handleAddButton = () => {
    setFormData((prev) => ({
      ...prev,
      buttons: [
        ...prev.buttons,
        {
          label: emptyI18nMap(),
          link: "#",
          style: "primary",
        },
      ],
    }));
  };

  const handleBackgroundChange = (mediaId) => {
    setFormData((prev) => ({
      ...prev,
      background_ref: mediaId,
    }));
    if (mediaId) {
      setLegacyBackgroundUrl(null);
    }
  };

  const handleRemoveButton = (index) => {
    setFormData((prev) => ({
      ...prev,
      buttons: prev.buttons.filter((_, i) => i !== index),
    }));
  };

  const updateButton = (index, field, value) => {
    setFormData((prev) => {
      const newButtons = [...prev.buttons];
      if (field === "label") {
        newButtons[index] = {
          ...newButtons[index],
          label: {
            ...newButtons[index].label,
            [activeLang]: value,
          },
        };
      } else {
        newButtons[index] = {
          ...newButtons[index],
          [field]: value,
        };
      }
      return { ...prev, buttons: newButtons };
    });
  };

  const handleAutoTranslate = async () => {
    try {
      notify(t("sectionEditor.buttons.translating"), "info");

      const fieldsToTranslate = ["title", "subtitle", "content", "announcement"].map((key) => ({
        key,
        value: formData[key],
      }));

      const translatedFieldResult = await translateFields({
        scene: "section_editor",
        fields: fieldsToTranslate,
      });

      let nextButtons = [...formData.buttons];
      let translatedButtonCount = 0;
      for (let index = 0; index < formData.buttons.length; index += 1) {
        const button = formData.buttons[index];
        const translatedButtonLabel = await translateField({
          scene: "section_editor_button",
          fieldName: "label",
          value: button?.label || emptyI18nMap(),
        });

        if (translatedButtonLabel.changed) {
          translatedButtonCount += 1;
          nextButtons[index] = {
            ...button,
            label: translatedButtonLabel.value,
          };
        }
      }

      const translatedCount =
        translatedFieldResult.changedCount + translatedButtonCount;

      if (translatedCount === 0) {
        notify(t("sectionEditor.toast.noContent"), "warning");
        return;
      }

      setFormData((prev) => ({
        ...prev,
        ...translatedFieldResult.fields,
        buttons: nextButtons,
      }));
      notify(t("sectionEditor.toast.translateSuccess"), "success");
    } catch (err) {
      logger.error("Translation error:", err);
      notify(err?.message || t("sectionEditor.toast.translateError"), "error");
    }
  };

  const handleSave = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError(null);

    try {
      const payload = {
        title: formData.title,
        subtitle: formData.subtitle,
        content: formData.content,
        announcement: formData.announcement,
        sort_order: formData.sort_order,
        buttons: formData.buttons,
        background_ref: formData.background_ref || null,
      };

      if (isEditMode) {
        await pb.collection("cms_sections").update(id, payload);
      } else {
        await pb.collection("cms_sections").create(payload);
      }

      notify(
        isEditMode ? t("sectionEditor.toast.updated") : t("sectionEditor.toast.created"),
        "success"
      );
      setTimeout(() => {
        navigate(`/${adminKey}/webadmin/home`);
      }, 600);
    } catch (err) {
      logger.error("Failed to save section:", err);
      const errorMsg = err?.response?.message || err?.message || t("sectionEditor.toast.saveError");
      setError(errorMsg);
      notify(t("sectionEditor.toast.saveError"), "error");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <ContentStateBlock
        loading
        loadingText={t("common:routeLoading")}
        className="rounded-2xl"
      />
    );
  }

  const multilangConfigs = [
    {
      key: "title",
      label: `${t("sectionEditor.form.title")} *`,
      type: "text",
      required: true,
    },
    {
      key: "subtitle",
      label: t("sectionEditor.form.subtitle"),
      type: "textarea",
      rows: 3,
    },
    {
      key: "content",
      label: t("sectionEditor.form.content"),
      type: "textarea",
      rows: 6,
    },
    {
      key: "announcement",
      label: t("sectionEditor.form.announcement"),
      type: "textarea",
      rows: 4,
    },
  ];
  const activeLangLabel = languages.find((lang) => lang.code === activeLang)?.label || "";

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-2xl px-4 py-2.5 text-sm bg-red-50 text-red-800 border border-red-200">
          {error}
        </div>
      )}

      <ContentEditorHeader
        backTo={`/${adminKey}/webadmin/home`}
        title={isEditMode ? t("sectionEditor.title.edit") : t("sectionEditor.title.create")}
        backClassName="p-2 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors"
        titleClassName="text-2xl font-bold text-slate-900"
        containerClassName="flex items-center justify-between"
        actions={(
          <>
            <TranslateActionButton
              onClick={handleAutoTranslate}
              translating={translating}
              disabled={saving}
            />
            <ContentPrimaryButton
              type="button"
              onClick={handleSave}
              disabled={saving || translating}
              icon={Save}
              loading={saving}
            >
              {t("sectionEditor.buttons.save")}
            </ContentPrimaryButton>
          </>
        )}
      />

      <form onSubmit={handleSave} className="space-y-6">
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

        <ContentFormCard>
          <ContentFieldLabel>
            {t("sectionEditor.form.sort")}
          </ContentFieldLabel>
          <ContentTextInput
            type="number"
            value={formData.sort_order}
            onChange={(event) =>
              setFormData((prev) => ({
                ...prev,
                sort_order: parseInt(event.target.value, 10) || 1,
              }))
            }
            className="px-4 py-2"
            min="1"
            required
          />
          <p className="mt-1 text-xs text-slate-500">{t("sectionEditor.form.sortHint")}</p>
        </ContentFormCard>

        <ContentFormCard className="space-y-6">
          {multilangConfigs.map((config) => (
            <MultilangField
              key={config.key}
              label={`${config.label} (${activeLangLabel})`}
              type={config.type}
              value={formData[config.key]}
              onChange={(lang, value) => updateMultilangField(config.key, lang, value)}
              languages={languages}
              activeLang={activeLang}
              showTabs={false}
              required={Boolean(config.required)}
              rows={config.rows}
              placeholder={(langCode) =>
                t("sectionEditor.placeholders.enter", {
                  lang: languages.find((lang) => lang.code === langCode)?.label || "",
                  field: t(`sectionEditor.form.${config.key}`),
                })
              }
              controlClassName="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-[var(--color-brand-blue)]/40 focus:border-[var(--color-brand-blue)]"
            />
          ))}
        </ContentFormCard>

        <ContentFormCard>
          <ImagePicker
            value={formData.background_ref}
            onChange={handleBackgroundChange}
            previewUrl={legacyBackgroundUrl}
            label={t("sectionEditor.form.background")}
          />
        </ContentFormCard>

        <ContentFormCard>
          <div className="flex items-center justify-between mb-2">
            <ContentFieldLabel className="mb-0">
              {t("sectionEditor.form.buttons")}
            </ContentFieldLabel>
            <ContentInlineActionButton
              onClick={handleAddButton}
              icon={Plus}
            >
              {t("sectionEditor.buttons.add")}
            </ContentInlineActionButton>
          </div>

          {formData.buttons.length === 0 ? (
            <p className="text-sm text-slate-500 py-4 text-center border border-slate-200 rounded-lg">
              {t("sectionEditor.emptyButtons")}
            </p>
          ) : (
            <div className="space-y-3">
              {formData.buttons.map((button, index) => (
                <ContentSubItemCard key={`${button.link}-${index}`}>
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-slate-700">button {index + 1}</span>
                    <ContentIconActionButton
                      onClick={() => handleRemoveButton(index)}
                      tone="danger"
                      icon={Trash2}
                      iconSize={16}
                      size="sm"
                    />
                  </div>

                  <MultilangField
                    type="text"
                    value={button.label || emptyI18nMap()}
                    onChange={(_, value) => updateButton(index, "label", value)}
                    languages={languages}
                    activeLang={activeLang}
                    showTabs={false}
                    label={`${t("sectionEditor.form.buttonLabel")} (${activeLangLabel})`}
                    placeholder={(langCode) =>
                      t("sectionEditor.placeholders.enter", {
                        lang: languages.find((lang) => lang.code === langCode)?.label || "",
                        field: t("sectionEditor.form.buttonLabel"),
                      })
                    }
                    controlClassName="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                    perLangLabelClassName="text-xs font-medium text-slate-600"
                  />

                  <div>
                    <ContentFieldLabel className="text-xs font-medium text-slate-600 mb-1">
                      {t("sectionEditor.form.link")}
                    </ContentFieldLabel>
                    <ContentTextInput
                      type="text"
                      value={button.link}
                      onChange={(event) => updateButton(index, "link", event.target.value)}
                      className="px-3 py-2 text-sm"
                      placeholder="/ or https://..."
                    />
                  </div>

                  <div>
                    <ContentFieldLabel className="text-xs font-medium text-slate-600 mb-1">
                      {t("sectionEditor.form.style")}
                    </ContentFieldLabel>
                    <ContentSelectInput
                      value={button.style}
                      onChange={(event) => updateButton(index, "style", event.target.value)}
                      className="px-3 py-2 text-sm"
                    >
                      <option value="primary">{t("sectionEditor.styles.primary")}</option>
                      <option value="secondary">{t("sectionEditor.styles.secondary")}</option>
                      </ContentSelectInput>
                    </div>
                </ContentSubItemCard>
              ))}
            </div>
          )}
        </ContentFormCard>
      </form>
    </div>
  );
}
