import {
  Bold,
  Italic,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  Quote,
  Link,
  Image,
  Images,
} from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import Modal from "../ui/Modal";
import ContentFieldLabel from "../content/ContentFieldLabel";
import ContentIconActionButton from "../content/ContentIconActionButton";
import ContentPrimaryButton from "../content/ContentPrimaryButton";
import ContentSecondaryButton from "../content/ContentSecondaryButton";
import ContentTextInput from "../content/ContentTextInput";

/**
 * 富文本编辑器工具栏组件
 * 提供格式化按钮：加粗、斜体、标题、列表、引用、链接、图片等
 */
export default function MenuBar({ editor, onImageUpload, onOpenMediaLibrary }) {
  const { t } = useTranslation("admin");
  const [isLinkModalOpen, setIsLinkModalOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");

  if (!editor) {
    return null;
  }

  const handleApplyLink = () => {
    const value = linkUrl.trim();
    if (!value) {
      setIsLinkModalOpen(false);
      return;
    }

    editor.chain().focus().setLink({ href: value }).run();
    setIsLinkModalOpen(false);
    setLinkUrl("");
  };

  const getToolbarButtonClass = (active) =>
    active
      ? "text-[var(--color-brand-blue)] bg-[var(--color-brand-blue)]/20 hover:bg-[var(--color-brand-blue)]/25 hover:text-[var(--color-brand-blue)]"
      : "text-slate-600 hover:bg-slate-200";

  return (
    <>
      <div className="flex items-center gap-1 flex-wrap border-b border-slate-200 bg-slate-50/80 px-3 py-2">
      {/* 加粗 */}
      <ContentIconActionButton
        onClick={() => editor.chain().focus().toggleBold().run()}
        disabled={!editor.can().chain().focus().toggleBold().run()}
        tone="neutral"
        size="sm"
        icon={Bold}
        iconSize={16}
        className={getToolbarButtonClass(editor.isActive("bold"))}
        title={t("menuBar.bold")}
        aria-label={t("menuBar.bold")}
      />

      {/* 斜体 */}
      <ContentIconActionButton
        onClick={() => editor.chain().focus().toggleItalic().run()}
        disabled={!editor.can().chain().focus().toggleItalic().run()}
        tone="neutral"
        size="sm"
        icon={Italic}
        iconSize={16}
        className={getToolbarButtonClass(editor.isActive("italic"))}
        title={t("menuBar.italic")}
        aria-label={t("menuBar.italic")}
      />

      {/* 分隔线 */}
      <div className="w-px h-6 bg-slate-300 mx-1" />

      {/* H1 */}
      <ContentIconActionButton
        onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
        tone="neutral"
        size="sm"
        icon={Heading1}
        iconSize={16}
        className={getToolbarButtonClass(editor.isActive("heading", { level: 1 }))}
        title={t("menuBar.heading1")}
        aria-label={t("menuBar.heading1")}
      />

      {/* H2 */}
      <ContentIconActionButton
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        tone="neutral"
        size="sm"
        icon={Heading2}
        iconSize={16}
        className={getToolbarButtonClass(editor.isActive("heading", { level: 2 }))}
        title={t("menuBar.heading2")}
        aria-label={t("menuBar.heading2")}
      />

      {/* H3 */}
      <ContentIconActionButton
        onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
        tone="neutral"
        size="sm"
        icon={Heading3}
        iconSize={16}
        className={getToolbarButtonClass(editor.isActive("heading", { level: 3 }))}
        title={t("menuBar.heading3")}
        aria-label={t("menuBar.heading3")}
      />

      {/* 分隔线 */}
      <div className="w-px h-6 bg-slate-300 mx-1" />

      {/* 无序列表 */}
      <ContentIconActionButton
        onClick={() => editor.chain().focus().toggleBulletList().run()}
        tone="neutral"
        size="sm"
        icon={List}
        iconSize={16}
        className={getToolbarButtonClass(editor.isActive("bulletList"))}
        title={t("menuBar.bulletList")}
        aria-label={t("menuBar.bulletList")}
      />

      {/* 有序列表 */}
      <ContentIconActionButton
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
        tone="neutral"
        size="sm"
        icon={ListOrdered}
        iconSize={16}
        className={getToolbarButtonClass(editor.isActive("orderedList"))}
        title={t("menuBar.orderedList")}
        aria-label={t("menuBar.orderedList")}
      />

      {/* 引用 */}
      <ContentIconActionButton
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
        tone="neutral"
        size="sm"
        icon={Quote}
        iconSize={16}
        className={getToolbarButtonClass(editor.isActive("blockquote"))}
        title={t("menuBar.quote")}
        aria-label={t("menuBar.quote")}
      />

      {/* 分隔线 */}
      <div className="w-px h-6 bg-slate-300 mx-1" />

      {/* 链接 */}
      <ContentIconActionButton
        onClick={() => setIsLinkModalOpen(true)}
        tone="neutral"
        size="sm"
        icon={Link}
        iconSize={16}
        className={getToolbarButtonClass(editor.isActive("link"))}
        title={t("menuBar.link")}
        aria-label={t("menuBar.link")}
      />

      {/* 图片上传 */}
      <ContentIconActionButton
        onClick={onImageUpload}
        tone="neutral"
        size="sm"
        icon={Image}
        iconSize={16}
        className="text-slate-600 hover:bg-slate-200"
        title={t("menuBar.uploadImage")}
        aria-label={t("menuBar.uploadImage")}
      />

      {/* 媒体库 */}
      <ContentIconActionButton
        onClick={onOpenMediaLibrary}
        tone="neutral"
        size="sm"
        icon={Images}
        iconSize={16}
        className="text-slate-600 hover:bg-slate-200"
        title={t("menuBar.selectFromLibrary")}
        aria-label={t("menuBar.selectFromLibrary")}
      />
      </div>

      <Modal
        isOpen={isLinkModalOpen}
        onClose={() => {
          setIsLinkModalOpen(false);
          setLinkUrl("");
        }}
        title={t("menuBar.linkDialog.title")}
        size="sm"
      >
        <form
          className="p-6 space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            handleApplyLink();
          }}
        >
          <div>
            <ContentFieldLabel htmlFor="editor-link-url" className="mb-2">
              {t("menuBar.linkDialog.label")}
            </ContentFieldLabel>
            <ContentTextInput
              id="editor-link-url"
              type="url"
              value={linkUrl}
              onChange={(event) => setLinkUrl(event.target.value)}
              placeholder={t("menuBar.linkDialog.placeholder")}
              className="text-sm"
              inputMode="url"
              spellCheck={false}
            />
          </div>
          <div className="flex items-center justify-end gap-2">
            <ContentSecondaryButton
              type="button"
              onClick={() => {
                setIsLinkModalOpen(false);
                setLinkUrl("");
              }}
              className="px-3 py-2 rounded-lg border border-slate-200 bg-slate-50 text-slate-700 text-sm"
            >
              {t("menuBar.linkDialog.cancel")}
            </ContentSecondaryButton>
            <ContentPrimaryButton
              type="submit"
              className="px-3 py-2 rounded-lg text-sm font-medium"
            >
              {t("menuBar.linkDialog.confirm")}
            </ContentPrimaryButton>
          </div>
        </form>
      </Modal>
    </>
  );
}
