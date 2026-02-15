import { useState, useEffect } from "react";
import { Search, Image as ImageIcon } from "lucide-react";
import pb from "../../lib/pocketbase";
import { useTranslation } from "react-i18next";
import { createAppLogger } from "../../lib/appLogger";
import Modal from "./ui/Modal";
import ContentTextInput from "./content/ContentTextInput";
import ContentStateBlock from "./content/ContentStateBlock";
import ContentTextButton from "./content/ContentTextButton";

const logger = createAppLogger("MediaLibraryModal");

/**
 * Media Library Modal Component
 * 媒体库选择器模态框
 * 
 * @param {boolean} isOpen - 是否显示
 * @param {Function} onClose - 关闭回调
 * @param {Function} onSelect - 选择回调 (mediaId) => void
 */
export default function MediaLibraryModal({ isOpen, onClose, onSelect }) {
  const { t } = useTranslation();
  const [mediaList, setMediaList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");

  // Fetch media list
  const fetchMedia = async () => {
    try {
      setLoading(true);
      const result = await pb.collection("media").getList(1, 200, {
        sort: "-created",
        filter: 'file != ""', // Only get items with files
      });
      setMediaList(result.items);
    } catch (error) {
      logger.error("获取媒体列表失败:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchMedia();
    }
  }, [isOpen]);

  // Get file URL
  const getFileUrl = (record, thumb = false) => {
    if (!record.file) return "";
    const baseUrl = import.meta.env.VITE_POCKETBASE_URL?.replace(/\/$/, "") || "";
    const url = `${baseUrl}/api/files/media/${record.id}/${record.file}`;
    if (thumb) {
      return `${url}?thumb=100x100`;
    }
    return url;
  };

  // Check if file is image
  const isImage = (fileName) => {
    if (!fileName) return false;
    const lowerName = fileName.toLowerCase();
    return /\.(jpg|jpeg|png|gif|webp|svg|bmp|ico)$/i.test(lowerName);
  };

  // Filter media
  const filteredMedia = mediaList.filter((item) => {
    // Only show images
    if (!isImage(item.file)) return false;

    // Search filter
    if (searchQuery.trim()) {
      const fileName = item.file || "";
      if (!fileName.toLowerCase().includes(searchQuery.toLowerCase())) {
        return false;
      }
    }

    return true;
  });

  // Handle select
  const handleSelect = (item) => {
    if (onSelect) {
      onSelect(item.id);
    }
    if (onClose) {
      onClose();
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t("admin.mediaLibraryModal.title")}
      size="xl"
    >
      {/* Search */}
      <div className="px-6 py-4 border-b border-slate-200">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <ContentTextInput
            type="text"
            name="media_search"
            autoComplete="off"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t("admin.mediaLibraryModal.search")}
            className="pl-10 pr-4 py-2 border-slate-300"
          />
        </div>
      </div>

      {/* Content */}
      <div className="p-6">
        {loading ? (
          <ContentStateBlock
            loading
            loadingText={t("admin.mediaLibraryModal.loading")}
            className="rounded-xl"
          />
        ) : filteredMedia.length === 0 ? (
          <ContentStateBlock
            icon={ImageIcon}
            title={searchQuery ? t("admin.mediaLibraryModal.noResults") : t("admin.mediaLibraryModal.empty")}
            className="rounded-xl"
          />
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
            {filteredMedia.map((item) => {
              const fileUrl = getFileUrl(item);
              const thumbUrl = getFileUrl(item, true);

              return (
                <ContentTextButton
                  key={item.id}
                  className="group relative aspect-square rounded-lg border border-slate-200 bg-slate-50 overflow-hidden hover:border-blue-500 hover:shadow-md transition-[border-color,box-shadow]"
                  onClick={() => handleSelect(item)}
                  aria-label={`${t("admin.mediaLibraryModal.clickToSelect")}: ${item.file || t("admin.mediaLibraryModal.unknown")}`}
                >
                  <img
                    src={thumbUrl}
                    alt={item.file || t("admin.mediaLibraryModal.image")}
                    width={100}
                    height={100}
                    loading="lazy"
                    className="w-full h-full object-cover"
                    onError={(e) => {
                      e.target.src = fileUrl;
                    }}
                  />
                  {/* Hover overlay */}
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
                    <div className="opacity-0 group-hover:opacity-100 transition-opacity text-white text-xs px-2 py-1 bg-black/60 rounded">
                      {t("admin.mediaLibraryModal.clickToSelect")}
                    </div>
                  </div>
                  {/* Filename */}
                  <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent p-2">
                    <p className="text-xs text-white truncate">{item.file || t("admin.mediaLibraryModal.unknown")}</p>
                  </div>
                </ContentTextButton>
              );
            })}
          </div>
        )}
      </div>
    </Modal>
  );
}
