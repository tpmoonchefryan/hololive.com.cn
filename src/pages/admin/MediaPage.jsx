import MediaManager from "../../components/admin/media/MediaManager";
import { useTranslation } from "react-i18next";
import ContentPageHeader from "../../components/admin/content/ContentPageHeader";

/**
 * 资源库页面
 * 独立管理所有上传的资源
 */
export default function MediaPage() {
  const { t } = useTranslation();

  return (
    <div className="space-y-4">
      <ContentPageHeader
        title={t("admin.media.title")}
        subtitle={t("admin.media.subtitle")}
      />

      <MediaManager />
    </div>
  );
}
