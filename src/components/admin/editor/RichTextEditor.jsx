import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import { useCallback, useEffect, useRef, useState } from "react";
import pb from "../../../lib/pocketbase";
import MenuBar from "./MenuBar";
import Modal from "../ui/Modal";
import MediaManager from "../media/MediaManager";
import { useUIFeedback } from "../../../hooks/useUIFeedback";
import { createAppLogger } from "../../../lib/appLogger";
import { useTranslation } from "react-i18next";
import ContentFileInput from "../content/ContentFileInput";

const logger = createAppLogger("RichTextEditor");

/**
 * 富文本编辑器组件
 * 基于 Tiptap，支持所见即所得编辑、图片上传等功能
 */
export default function RichTextEditor({ content, onChange, placeholder }) {
  const { t } = useTranslation("admin");
  const fileInputRef = useRef(null);
  const [isMediaLibraryOpen, setIsMediaLibraryOpen] = useState(false);
  const { notify } = useUIFeedback();

  // 初始化编辑器
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        // 禁用默认的硬换行，使用段落
        hardBreak: false,
      }),
      Image.configure({
        inline: true,
        allowBase64: false,
      }),
      Link.configure({
        openOnClick: false,
        HTMLAttributes: {
          target: "_blank",
          rel: "noopener noreferrer",
        },
      }),
      Placeholder.configure({
        placeholder: placeholder || t("postEditor.contentPlaceholder"),
      }),
    ],
    content,
    onUpdate: ({ editor }) => {
      // 当内容更新时，调用 onChange 回调
      const html = editor.getHTML();
      onChange?.(html);
    },
    editorProps: {
      attributes: {
        class: "prose prose-slate prose-lg max-w-none prose-headings:font-bold prose-headings:text-slate-900 prose-a:text-blue-600 prose-a:no-underline hover:prose-a:underline prose-img:rounded-xl prose-img:w-full prose-img:max-w-full prose-blockquote:border-l-slate-300 prose-blockquote:text-slate-700 prose-strong:text-slate-900 min-h-[300px] px-4 py-3",
      },
      handlePaste: (view, event) => {
        // 处理粘贴图片
        const items = Array.from(event.clipboardData?.items || []);
        const imageItem = items.find((item) => item.type.startsWith("image/"));

        if (imageItem) {
          event.preventDefault();
          const file = imageItem.getAsFile();
          if (file) {
            handleImageUpload(file);
          }
          return true;
        }
        return false;
      },
      handleDrop: (view, event) => {
        // 处理拖拽图片
        const files = Array.from(event.dataTransfer?.files || []);
        const imageFile = files.find((file) => file.type.startsWith("image/"));

        if (imageFile) {
          event.preventDefault();
          handleImageUpload(imageFile);
          return true;
        }
        return false;
      },
    },
  });

  // 图片上传处理函数
  const handleImageUpload = useCallback(
    async (file) => {
      if (!editor) return;

      try {
        // 创建 FormData
        const formData = new FormData();
        formData.append("file", file);

        // 上传到 PocketBase
        const record = await pb.collection("media").create(formData);

        // 获取图片 URL
        const baseUrl = import.meta.env.VITE_POCKETBASE_URL || "";
        const fileUrl = `${baseUrl}/api/files/media/${record.id}/${record.file}`;

        // 插入图片到编辑器
        editor.chain().focus().setImage({ src: fileUrl }).run();
      } catch (error) {
        logger.error("图片上传失败:", error);
        notify(t("postEditor.imageUploadError"), "error");
      }
    },
    [editor, notify, t]
  );

  // 处理图片按钮点击
  const handleImageButtonClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  // 处理打开媒体库
  const handleOpenMediaLibrary = useCallback(() => {
    setIsMediaLibraryOpen(true);
  }, []);

  // 处理从媒体库选择图片
  const handleSelectFromLibrary = useCallback(
    (url) => {
      if (!editor) return;
      editor.chain().focus().setImage({ src: url }).run();
      setIsMediaLibraryOpen(false);
    },
    [editor]
  );

  // 处理文件选择
  const handleFileSelect = useCallback(
    (e) => {
      const file = e.target.files?.[0];
      if (file && file.type.startsWith("image/")) {
        handleImageUpload(file);
      }
      // 清空 input，以便可以重复选择同一文件
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    },
    [handleImageUpload]
  );

  // 当外部 content 变化时更新编辑器内容
  useEffect(() => {
    if (editor && content !== editor.getHTML()) {
      editor.commands.setContent(content || "");
    }
  }, [content, editor]);

  if (!editor) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm min-h-[300px] flex items-center justify-center">
        <p className="text-sm text-slate-500">{t("postEditor.editorLoading")}</p>
      </div>
    );
  }

  return (
    <>
      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        {/* 工具栏 */}
        <MenuBar
          editor={editor}
          onImageUpload={handleImageButtonClick}
          onOpenMediaLibrary={handleOpenMediaLibrary}
        />

      {/* 隐藏的文件输入 */}
      <ContentFileInput
        ref={fileInputRef}
        accept="image/jpeg,image/png,image/gif,image/webp"
        className="hidden"
        onChange={handleFileSelect}
      />

      {/* 编辑器内容区 */}
      <EditorContent
        editor={editor}
        className="prose prose-slate prose-lg max-w-none prose-headings:font-bold prose-headings:text-slate-900 prose-a:text-blue-600 prose-a:no-underline hover:prose-a:underline prose-img:rounded-xl prose-img:w-full prose-img:max-w-full prose-blockquote:border-l-slate-300 prose-blockquote:text-slate-700 prose-strong:text-slate-900 focus-within:ring-2 focus-within:ring-[var(--color-brand-blue)]/30 rounded-lg"
      />

      {/* 编辑器样式 */}
      <style>{`
        .ProseMirror {
          outline: 2px solid transparent;
          outline-offset: 2px;
          min-height: 300px;
          padding: 1rem;
        }

        .ProseMirror p.is-editor-empty:first-child::before {
          color: #94a3b8;
          content: attr(data-placeholder);
          float: left;
          height: 0;
          pointer-events: none;
        }

        .ProseMirror h1 {
          font-size: 1.875rem;
          line-height: 2.25rem;
          font-weight: 700;
          margin-top: 1.5rem;
          margin-bottom: 1rem;
        }

        .ProseMirror h2 {
          font-size: 1.5rem;
          line-height: 2rem;
          font-weight: 700;
          margin-top: 1.25rem;
          margin-bottom: 0.75rem;
        }

        .ProseMirror h3 {
          font-size: 1.25rem;
          line-height: 1.75rem;
          font-weight: 600;
          margin-top: 1rem;
          margin-bottom: 0.5rem;
        }

        .ProseMirror p {
          margin-bottom: 0.75rem;
          line-height: 1.75;
        }

        .ProseMirror ul,
        .ProseMirror ol {
          margin-bottom: 0.75rem;
          padding-left: 1.5rem;
        }

        .ProseMirror li {
          margin-bottom: 0.25rem;
        }

        .ProseMirror blockquote {
          border-left: 4px solid #e2e8f0;
          padding-left: 1rem;
          margin: 0.75rem 0;
          color: #64748b;
          font-style: italic;
        }

        .ProseMirror a {
          color: #2563eb;
          text-decoration: underline;
          text-underline-offset: 2px;
        }

        .ProseMirror a:hover {
          color: #1d4ed8;
        }

        .ProseMirror img {
          max-width: 100%;
          height: auto;
          border-radius: 0.5rem;
          margin: 1rem 0;
        }

        .ProseMirror img.ProseMirror-selectednode {
          outline: 2px solid var(--color-brand-blue);
          outline-offset: 2px;
        }

        .ProseMirror:focus {
          outline-color: var(--color-brand-blue);
        }
      `}</style>
      </div>

      {/* 媒体库选择 Modal */}
      <Modal
        isOpen={isMediaLibraryOpen}
        onClose={() => setIsMediaLibraryOpen(false)}
        title={t("mediaLibraryModal.title")}
        size="xl"
      >
        <div className="p-6">
          <MediaManager
            onSelect={handleSelectFromLibrary}
            closeModal={() => setIsMediaLibraryOpen(false)}
          />
        </div>
      </Modal>
    </>
  );
}
