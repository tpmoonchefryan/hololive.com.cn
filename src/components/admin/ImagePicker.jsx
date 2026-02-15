import { useState, useRef, useEffect } from "react";
import { Upload, Image as ImageIcon, X } from "lucide-react";
import pb from "../../lib/pocketbase";
import MediaLibraryModal from "./MediaLibraryModal";
import { useTranslation } from "react-i18next";
import { useUIFeedback } from "../../hooks/useUIFeedback";
import { createAppLogger } from "../../lib/appLogger";
import ContentFieldLabel from "./content/ContentFieldLabel";
import ContentPrimaryButton from "./content/ContentPrimaryButton";
import ContentSecondaryButton from "./content/ContentSecondaryButton";
import ContentIconActionButton from "./content/ContentIconActionButton";
import ContentFileInput from "./content/ContentFileInput";

const logger = createAppLogger("ImagePicker");

/**
 * ImagePicker Component
 * 可重用的图片选择器组件
 * 
 * @param {string} value - 当前选中的媒体 ID（Relation ID）
 * @param {Function} onChange - 选择回调 (mediaId) => void
 * @param {string} previewUrl - 可选的旧版 URL（用于向后兼容）
 * @param {string} label - 标签文本
 */
export default function ImagePicker({ value, onChange, previewUrl, label }) {
  const { t } = useTranslation();
  const { notify } = useUIFeedback();
  const [uploading, setUploading] = useState(false);
  const [showMediaLibrary, setShowMediaLibrary] = useState(false);
  const [preview, setPreview] = useState(null);
  const fileInputRef = useRef(null);
  const baseUrl = import.meta.env.VITE_POCKETBASE_URL?.replace(/\/$/, "") || "";

  const displayLabel = label || t("admin.imagePicker.defaultLabel");

  // Load preview from media collection
  useEffect(() => {
    const loadPreview = async () => {
      if (value) {
        try {
          const mediaRecord = await pb.collection("media").getOne(value);
          if (mediaRecord && mediaRecord.file) {
            const url = `${baseUrl}/api/files/media/${mediaRecord.id}/${mediaRecord.file}`;
            setPreview({ url, filename: mediaRecord.file });
          }
        } catch (error) {
          logger.error("Failed to load media preview:", error);
          // Fallback to legacy URL if available
          if (previewUrl) {
            setPreview({ url: previewUrl, filename: null });
          } else {
            setPreview(null);
          }
        }
      } else if (previewUrl) {
        // Use legacy URL if no relation ID
        setPreview({ url: previewUrl, filename: null });
      } else {
        setPreview(null);
      }
    };

    loadPreview();
  }, [value, previewUrl, baseUrl]);

  // Handle file upload
  const handleUpload = async (file) => {
    if (!file) return;

    try {
      setUploading(true);
      const formData = new FormData();
      formData.append("file", file);

      // Upload to media collection
      const record = await pb.collection("media").create(formData);

      // Return the ID to parent
      if (onChange) {
        onChange(record.id);
      }
    } catch (error) {
      logger.error("上传失败:", error);
      notify(`${t("admin.imagePicker.uploadError")}, ${t("admin.imagePicker.retry")}`, "error");
    } finally {
      setUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  // Handle file select
  const handleFileSelect = (e) => {
    const file = e.target.files?.[0];
    if (file && file.type.startsWith("image/")) {
      handleUpload(file);
    }
  };

  // Handle select from library
  const handleSelectFromLibrary = (mediaId) => {
    if (onChange) {
      onChange(mediaId);
    }
  };

  // Handle remove
  const handleRemove = () => {
    if (onChange) {
      onChange(null);
    }
    setPreview(null);
  };

  return (
    <div>
      <ContentFieldLabel>
        {displayLabel}
      </ContentFieldLabel>

      {preview ? (
        <div className="relative inline-block">
          <img
            src={preview.url}
            alt={t("admin.imagePicker.preview")}
            className="max-w-xs rounded-lg border border-slate-200"
            onError={(e) => {
              // Fallback handling
              if (previewUrl && e.target.src !== previewUrl) {
                e.target.src = previewUrl;
              }
            }}
          />
          <ContentIconActionButton
            onClick={handleRemove}
            tone="danger"
            icon={X}
            size="sm"
            iconSize={16}
            className="absolute top-2 right-2 bg-red-600 text-white rounded-full hover:bg-red-700 hover:text-white"
            title={t("admin.media.manager.actions.deleteFile")}
            aria-label={t("admin.media.manager.actions.deleteFile")}
          />
        </div>
      ) : (
        <div className="border-2 border-dashed border-slate-300 rounded-lg p-6 text-center space-y-3">
          <Upload className="w-8 h-8 text-slate-400 mx-auto" />
          <p className="text-sm text-slate-600">{t("admin.imagePicker.uploadOrSelect")}</p>
          <div className="flex gap-3 justify-center">
            <ContentPrimaryButton
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              loading={uploading}
              loadingLabel={t("admin.imagePicker.uploading")}
              icon={Upload}
              iconSize={16}
            >
              {t("admin.imagePicker.upload")}
            </ContentPrimaryButton>
            <ContentSecondaryButton
              type="button"
              onClick={() => setShowMediaLibrary(true)}
              disabled={uploading}
              className="inline-flex items-center gap-2"
            >
              <ImageIcon className="w-4 h-4" />
              {t("admin.imagePicker.selectFromLib")}
            </ContentSecondaryButton>
          </div>
        </div>
      )}

      <ContentFileInput
        ref={fileInputRef}
        accept="image/jpeg,image/png,image/gif,image/webp"
        className="hidden"
        onChange={handleFileSelect}
      />

      {/* Media Library Modal */}
      <MediaLibraryModal
        isOpen={showMediaLibrary}
        onClose={() => setShowMediaLibrary(false)}
        onSelect={handleSelectFromLibrary}
      />
    </div>
  );
}
