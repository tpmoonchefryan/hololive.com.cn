import { useState, useEffect, useRef } from "react";
import {
  Upload,
  Search,
  Image as ImageIcon,
  Video,
  File,
  Trash2,
} from "lucide-react";
import pb from "../../../lib/pocketbase";
import { useUIFeedback } from "../../../hooks/useUIFeedback";
import { createAppLogger } from "../../../lib/appLogger";
import { useTranslation } from "react-i18next";
import Modal from "../ui/Modal";
import { formatLocalizedDate } from "../../../utils/localeFormat";
import ContentStateBlock from "../content/ContentStateBlock";
import ContentTextInput from "../content/ContentTextInput";
import ContentPrimaryButton from "../content/ContentPrimaryButton";
import ContentSecondaryButton from "../content/ContentSecondaryButton";
import ContentIconActionButton from "../content/ContentIconActionButton";
import ContentFileInput from "../content/ContentFileInput";
import ContentTextButton from "../content/ContentTextButton";

const logger = createAppLogger("MediaManager");

/**
 * 通用资源管理组件
 * 可以作为独立页面使用，也可以在 Modal 中作为选择器使用
 *
 * @param {Function} onSelect - 可选，选择文件时的回调函数 (url) => void
 * @param {Function} closeModal - 可选，关闭模态框的函数
 */
export default function MediaManager({ onSelect, closeModal }) {
  const { t, i18n } = useTranslation();
  const { notify, confirm } = useUIFeedback();
  const [mediaList, setMediaList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [category, setCategory] = useState("all"); // all, images, videos, files
  const [selectedMedia, setSelectedMedia] = useState(null);
  const fileInputRef = useRef(null);
  const baseUrl = import.meta.env.VITE_POCKETBASE_URL?.replace(/\/$/, "") || "";

  const formatDateTime = (dateString) => {
    const value = formatLocalizedDate(dateString, i18n.language, {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
    return value || "-";
  };

  // 获取媒体列表
  const fetchMedia = async () => {
    try {
      setLoading(true);
      const result = await pb.collection("media").getList(1, 200, {
        sort: "-created",
      });
      setMediaList(result.items);
    } catch (error) {
      logger.error("获取媒体列表失败:", error);
      notify(t("admin.media.manager.toast.fetchError"), "error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMedia();
  }, []);

  // 上传文件
  const handleUpload = async (file) => {
    if (!file) return;

    try {
      setUploading(true);
      const formData = new FormData();
      formData.append("file", file);

      await pb.collection("media").create(formData);
      await fetchMedia(); // 刷新列表
    } catch (error) {
      logger.error("上传失败:", error);
      notify(t("admin.media.manager.toast.uploadError"), "error");
    } finally {
      setUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  // 删除文件
  const handleDelete = async (id) => {
    const accepted = await confirm({
      title: t("admin.media.manager.delete.title"),
      message: t("admin.media.manager.delete.desc"),
      danger: true,
      confirmText: t("admin.media.manager.delete.confirm"),
      cancelText: t("admin.media.manager.delete.cancel"),
    });
    if (!accepted) {
      return;
    }

    try {
      await pb.collection("media").delete(id);
      await fetchMedia(); // 刷新列表
      setSelectedMedia(null);
    } catch (error) {
      logger.error("删除失败:", error);
      notify(t("admin.media.manager.toast.deleteError"), "error");
    }
  };

  // 获取文件 URL
  const getFileUrl = (record, thumb = false) => {
    if (!record.file) return "";
    const url = `${baseUrl}/api/files/media/${record.id}/${record.file}`;
    if (thumb && getFileType(record.file) === "image") {
      return `${url}?thumb=100x100`;
    }
    return url;
  };

  // 判断文件类型（从文件名推断）
  const getFileType = (fileName) => {
    if (!fileName) return "file";
    const lowerName = fileName.toLowerCase();
    // 图片扩展名
    if (/\.(jpg|jpeg|png|gif|webp|svg|bmp|ico)$/i.test(lowerName)) {
      return "image";
    }
    // 视频扩展名
    if (/\.(mp4|webm|ogg|avi|mov|wmv|flv|mkv)$/i.test(lowerName)) {
      return "video";
    }
    return "file";
  };

  // 获取文件图标
  const getFileIcon = (fileName) => {
    const type = getFileType(fileName);
    switch (type) {
      case "image":
        return ImageIcon;
      case "video":
        return Video;
      default:
        return File;
    }
  };

  // 过滤文件
  const filteredMedia = mediaList.filter((item) => {
    const fileName = item.file || "";
    
    // 选择模式：只显示图片
    if (onSelect) {
      if (getFileType(fileName) !== "image") return false;
    }
    
    // 分类过滤
    if (category !== "all") {
      const type = getFileType(fileName);
      if (category === "images" && type !== "image") return false;
      if (category === "videos" && type !== "video") return false;
      if (category === "files" && (type === "image" || type === "video")) {
        return false;
      }
    }

    // 搜索过滤
    if (searchQuery.trim()) {
      if (!fileName.toLowerCase().includes(searchQuery.toLowerCase())) {
        return false;
      }
    }

    return true;
  });

  // 处理文件选择
  const handleFileClick = (item) => {
    if (onSelect) {
      // 选择模式：触发回调并关闭模态框
      const url = getFileUrl(item);
      onSelect(url);
      if (closeModal) closeModal();
    } else {
      // 管理模式：显示详情
      setSelectedMedia(item);
    }
  };

  return (
    <div className="space-y-4">
      {/* 顶部工具栏 */}
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
        {/* 搜索框 */}
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <ContentTextInput
            type="text"
            name="search"
            autoComplete="off"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t("admin.media.manager.searchPlaceholder")}
            className="pl-10 pr-4 py-2 rounded-xl border-slate-200 bg-white text-sm text-slate-900"
          />
        </div>

        {/* 分类 Tabs（选择模式下隐藏） */}
        {!onSelect && (
          <div className="flex items-center gap-2">
            {[
              { key: "all", label: t("admin.media.manager.tabs.all") },
              { key: "images", label: t("admin.media.manager.tabs.images") },
              { key: "videos", label: t("admin.media.manager.tabs.videos") },
              { key: "files", label: t("admin.media.manager.tabs.files") },
            ].map((tab) => (
              <ContentSecondaryButton
                key={tab.key}
                type="button"
                variant="pill"
                onClick={() => setCategory(tab.key)}
                className={`px-3 py-1.5 text-xs ${
                  category === tab.key
                    ? "bg-[var(--color-brand-blue)] text-white hover:bg-[var(--color-brand-blue)]/90"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                }`}
              >
                {tab.label}
              </ContentSecondaryButton>
            ))}
          </div>
        )}

        {/* 上传按钮 */}
        <div className="relative">
          <ContentFileInput
            ref={fileInputRef}
            accept="image/*,video/*"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleUpload(file);
            }}
            className="hidden"
          />
          <ContentPrimaryButton
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            loading={uploading}
            loadingLabel={t("admin.media.manager.uploading")}
            icon={Upload}
            iconSize={16}
            className="rounded-xl text-white"
          >
            {t("admin.media.manager.upload")}
          </ContentPrimaryButton>
        </div>
      </div>

      {/* 文件网格 */}
      {loading ? (
        <ContentStateBlock
          loading
          loadingText={t("routeLoading", { ns: "common" })}
          className="rounded-2xl"
        />
      ) : filteredMedia.length === 0 ? (
        <ContentStateBlock
          icon={File}
          title={
            searchQuery || category !== "all"
              ? t("admin.media.manager.empty.noResults")
              : t("admin.media.manager.empty.default")
          }
          className="rounded-2xl"
        />
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
          {filteredMedia.map((item) => {
            const fileName = item.file || "";
            const fileType = getFileType(fileName);
            const Icon = getFileIcon(fileName);
            const fileUrl = getFileUrl(item);
            const thumbUrl = getFileUrl(item, true);

            return (
              <ContentTextButton
                key={item.id}
                className="group relative aspect-square rounded-xl border border-slate-200 bg-slate-50 overflow-hidden cursor-pointer hover:border-[var(--color-brand-blue)] hover:shadow-md transition-[border-color,box-shadow]"
                onClick={() => handleFileClick(item)}
                aria-label={`${t("admin.media.manager.details.title")}: ${fileName || t("admin.media.manager.details.unknown")}`}
              >
                {fileType === "image" ? (
                  <img
                    src={thumbUrl}
                    alt={fileName}
                    className="w-full h-full object-cover"
                    onError={(e) => {
                      e.target.src = fileUrl;
                    }}
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center bg-slate-100">
                    <Icon className="w-12 h-12 text-slate-400" />
                  </div>
                )}

                {/* 悬停遮罩 */}
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
                  {!onSelect && (
                    <ContentIconActionButton
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDelete(item.id);
                      }}
                      tone="danger"
                      icon={Trash2}
                      size="sm"
                      iconSize={16}
                      className="opacity-0 group-hover:opacity-100 rounded-full bg-red-500 text-white hover:bg-red-600 hover:text-white transition-[background-color,opacity]"
                      aria-label={t("admin.media.manager.delete.confirm")}
                    />
                  )}
                </div>

                {/* 文件名（底部） */}
                <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent p-2">
                  <p className="text-xs text-white truncate">{fileName}</p>
                </div>
              </ContentTextButton>
            );
          })}
        </div>
      )}

      {/* 文件详情 Modal（管理模式） */}
      <Modal
        isOpen={Boolean(selectedMedia && !onSelect)}
        onClose={() => setSelectedMedia(null)}
        title={t("admin.media.manager.details.title")}
        size="lg"
      >
        {selectedMedia && (
          <div className="p-6">
            {getFileType(selectedMedia.file) === "image" ? (
              <img
                src={getFileUrl(selectedMedia)}
                alt={selectedMedia.file || t("admin.media.manager.details.unknown")}
                className="w-full max-h-[60vh] object-contain rounded-lg"
              />
            ) : (
              <div className="flex items-center justify-center py-20 bg-slate-50 rounded-lg">
                {(() => {
                  const Icon = getFileIcon(selectedMedia.file);
                  return <Icon className="w-24 h-24 text-slate-400" />;
                })()}
              </div>
            )}

            {/* 文件信息 */}
            <div className="mt-6 space-y-2">
              <div className="flex items-center justify-between text-sm gap-3">
                <span className="text-slate-500">{t("admin.media.manager.details.fileName")}</span>
                <span className="text-slate-900 font-mono break-all text-right">{selectedMedia.file || t("admin.media.manager.details.unknown")}</span>
              </div>
              <div className="flex items-center justify-between text-sm gap-3">
                <span className="text-slate-500">{t("admin.media.manager.details.uploadedAt")}</span>
                <span className="text-slate-900 text-right">
                  {formatDateTime(selectedMedia.created)}
                </span>
              </div>
              <div className="flex items-center justify-between text-sm gap-3">
                <span className="text-slate-500">{t("admin.media.manager.details.fileUrl")}</span>
                <span className="text-slate-900 font-mono text-xs break-all text-right max-w-md">
                  {getFileUrl(selectedMedia)}
                </span>
              </div>
            </div>

            {/* 操作按钮 */}
            <div className="mt-6 flex items-center justify-end gap-3">
              <ContentSecondaryButton
                type="button"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(getFileUrl(selectedMedia));
                    notify(t("admin.media.manager.toast.copySuccess"), "success");
                  } catch (error) {
                    logger.error("复制 URL 失败:", error);
                    notify(t("admin.media.manager.toast.copyError"), "error");
                  }
                }}
                className="rounded-xl border border-slate-200 text-slate-700 hover:bg-slate-50 text-sm font-medium"
              >
                {t("admin.media.manager.actions.copyUrl")}
              </ContentSecondaryButton>
              <ContentPrimaryButton
                type="button"
                onClick={() => handleDelete(selectedMedia.id)}
                className="rounded-xl bg-red-500 text-white hover:bg-red-600 text-sm font-medium"
              >
                {t("admin.media.manager.actions.deleteFile")}
              </ContentPrimaryButton>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
