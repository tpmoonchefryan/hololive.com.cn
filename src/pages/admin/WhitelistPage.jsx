import { useCallback, useState, useEffect } from "react";
import { Plus, Mail, Save } from "lucide-react";
import pb from "../../lib/pocketbase";
import { logCreate, logUpdate, logDelete } from "../../lib/logger";
import { useTranslation } from "react-i18next";
import { createAppLogger } from "../../lib/appLogger";
import Modal from "../../components/admin/ui/Modal";
import { formatLocalizedDate } from "../../utils/localeFormat";
import ContentPageHeader from "../../components/admin/content/ContentPageHeader";
import ContentPrimaryButton from "../../components/admin/content/ContentPrimaryButton";
import ContentSecondaryButton from "../../components/admin/content/ContentSecondaryButton";
import ContentFieldLabel from "../../components/admin/content/ContentFieldLabel";
import ContentTextInput from "../../components/admin/content/ContentTextInput";
import ContentStateBlock from "../../components/admin/content/ContentStateBlock";
import ContentTableSurface from "../../components/admin/content/ContentTableSurface";
import ContentTableHeader from "../../components/admin/content/ContentTableHeader";
import ContentTableHeadCell from "../../components/admin/content/ContentTableHeadCell";
import ContentTableCell from "../../components/admin/content/ContentTableCell";
import ContentEditDeleteActions from "../../components/admin/content/ContentEditDeleteActions";

/**
 * SSO 白名单管理页面
 * 管理允许通过 SSO 登录的邮箱地址
 */
const logger = createAppLogger("WhitelistPage");

export default function WhitelistPage() {
  const { t, i18n } = useTranslation("admin");
  const [whitelists, setWhitelists] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [formData, setFormData] = useState({
    email: "",
    description: "",
  });
  const [toast, setToast] = useState(null);

  const closeForm = () => {
    setShowForm(false);
    setEditingId(null);
    setFormData({ email: "", description: "" });
  };

  // 获取白名单列表
  const fetchWhitelists = useCallback(async () => {
    try {
      setLoading(true);

      // 检查用户是否已登录
      if (!pb.authStore.isValid) {
        throw new Error(t("whitelist.error.login"));
      }

      const result = await pb.collection("whitelists").getList(1, 100, {
        sort: "-created",
      });
      setWhitelists(result.items);
      setError(null);
    } catch (error) {
      logger.error("Failed to fetch whitelists:", error);
      if (import.meta.env.DEV) {
        logger.error("Error details:", {
          status: error?.status,
          response: error?.response,
          data: error?.data,
          message: error?.message,
        });
      }

      // 提供更详细的错误信息 - 支持 PocketBase 错误格式
      let errorMessage = t("whitelist.toast.fetchError");

      // PocketBase 错误 usually via status or response.data
      if (error?.status === 401 || error?.status === 403) {
        errorMessage = t("whitelist.error.permission");
      } else if (error?.status === 404) {
        errorMessage = t("whitelist.error.notFound");
      } else if (error?.response?.data?.message) {
        errorMessage = error.response.data.message;
      } else if (error?.response?.message) {
        errorMessage = error.response.message;
      } else if (error?.data?.message) {
        errorMessage = error.data.message;
      } else if (error?.message) {
        errorMessage = error.message;
      }

      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    fetchWhitelists();
  }, [fetchWhitelists]);

  // 格式化日期
  const formatDate = (dateString) => {
    const value = formatLocalizedDate(dateString, i18n.language, {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
    return value || "-";
  };

  // 打开新建表单
  const handleNew = () => {
    setEditingId(null);
    setFormData({ email: "", description: "" });
    setShowForm(true);
  };

  // 打开编辑表单
  const handleEdit = (item) => {
    setEditingId(item.id);
    setFormData({
      email: item.email,
      description: item.description || "",
    });
    setShowForm(true);
  };

  // 保存（新建或更新）
  const handleSave = async (e) => {
    e.preventDefault();
    try {
      if (editingId) {
        // 更新
        await pb.collection("whitelists").update(editingId, formData);
        await logUpdate("白名单", `更新了白名单：${formData.email}`);
        setToast({ type: "success", message: t("whitelist.toast.updated") });
      } else {
        // 创建
        await pb.collection("whitelists").create(formData);
        await logCreate("白名单", `添加了白名单：${formData.email}`);
        setToast({ type: "success", message: t("whitelist.toast.added") });
      }
      closeForm();
      await fetchWhitelists();
    } catch (error) {
      logger.error("Failed to save whitelist:", error);
      const errorMsg =
        error?.response?.message || error?.message || t("whitelist.toast.saveError");
      setToast({ type: "error", message: errorMsg });
    }
  };

  // 删除白名单
  const handleDelete = async (id) => {
    try {
      setDeletingId(id);

      // 先获取白名单信息用于日志记录
      let email = "Unknown";
      try {
        const item = await pb.collection("whitelists").getOne(id);
        email = item.email || "Unknown";
      } catch {
        logger.warn("Failed to fetch whitelist info for log");
      }

      await pb.collection("whitelists").delete(id);

      // 记录删除日志
      await logDelete("Whitelist", `Removed whitelist: ${email}`);

      await fetchWhitelists();
      setDeleteConfirmId(null);
      setToast({ type: "success", message: t("whitelist.toast.deleted", { email }) });
    } catch (error) {
      logger.error("Failed to delete whitelist:", error);
      setToast({ type: "error", message: t("whitelist.toast.deleteError") });
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="space-y-4">
      {/* Toast */}
      {toast && (
        <div
          className={`rounded-2xl px-4 py-2.5 text-xs md:text-sm flex items-center justify-between gap-3 shadow-sm ${toast.type === "success"
              ? "bg-emerald-50 text-emerald-800 border border-emerald-200"
              : "bg-red-50 text-red-800 border border-red-200"
            }`}
        >
          <span>{toast.message}</span>
          <ContentSecondaryButton
            onClick={() => setToast(null)}
            className="px-2 py-1 text-[11px] font-medium opacity-80 hover:opacity-100 bg-white/40 hover:bg-white/60"
          >
            {t("whitelist.buttons.close")}
          </ContentSecondaryButton>
        </div>
      )}

      <div className="space-y-4">
        <ContentPageHeader
          title={t("whitelist.title")}
          subtitle={t("whitelist.subtitle")}
          actions={(
            <ContentPrimaryButton
              type="button"
              onClick={handleNew}
              variant="pill"
              icon={Plus}
              iconSize={20}
            >
              {t("whitelist.buttons.add")}
            </ContentPrimaryButton>
          )}
        />

        {/* 错误提示 */}
        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-2xl text-red-700 text-xs md:text-sm">
            <p className="font-semibold mb-1">{t("whitelist.error.title")}</p>
            <p>{error}</p>
            <ContentSecondaryButton
              onClick={fetchWhitelists}
              className="mt-2 px-0 py-0 text-sm underline hover:no-underline bg-transparent hover:bg-transparent"
            >
              {t("whitelist.buttons.retry")}
            </ContentSecondaryButton>
          </div>
        )}

        {/* 表单弹窗 */}
        <Modal
          isOpen={showForm}
          onClose={closeForm}
          title={editingId ? t("whitelist.buttons.edit") : t("whitelist.buttons.add")}
          size="sm"
        >
          <form onSubmit={handleSave} className="space-y-4 px-6 py-5">
            <div>
              <ContentFieldLabel htmlFor="whitelist-email">
                {t("whitelist.form.email")} *
              </ContentFieldLabel>
              <ContentTextInput
                id="whitelist-email"
                type="email"
                name="email"
                autoComplete="off"
                spellCheck={false}
                value={formData.email}
                onChange={(e) =>
                  setFormData({ ...formData, email: e.target.value })
                }
                className="px-4 py-2 border-slate-200"
                placeholder={t("whitelist.form.emailPlaceholder")}
                required
                disabled={Boolean(editingId)}
              />
              {editingId && (
                <p className="mt-1 text-xs text-slate-500">
                  {t("whitelist.form.emailDisabled")}
                </p>
              )}
            </div>
            <div>
              <ContentFieldLabel htmlFor="whitelist-description">
                {t("whitelist.form.desc")}
              </ContentFieldLabel>
              <ContentTextInput
                id="whitelist-description"
                type="text"
                name="description"
                autoComplete="off"
                value={formData.description}
                onChange={(e) =>
                  setFormData({ ...formData, description: e.target.value })
                }
                className="px-4 py-2 border-slate-200"
                placeholder={t("whitelist.form.descPlaceholder")}
              />
            </div>
            <div className="flex items-center justify-end gap-3 pt-4">
              <ContentSecondaryButton onClick={closeForm}>
                {t("whitelist.buttons.cancel")}
              </ContentSecondaryButton>
              <ContentPrimaryButton
                type="submit"
                icon={Save}
                iconSize={16}
              >
                {editingId ? t("auditLogs.actions.update") : t("auditLogs.actions.create")}
              </ContentPrimaryButton>
            </div>
          </form>
        </Modal>

        {/* 白名单列表 */}
        {loading ? (
          <ContentStateBlock
            loading
            loadingText={t("whitelist.loading")}
            className="rounded-2xl"
          />
        ) : whitelists.length === 0 ? (
          <ContentStateBlock
            icon={Mail}
            title={t("whitelist.empty.title")}
            description={t("whitelist.empty.desc")}
            action={(
              <ContentPrimaryButton
                type="button"
                onClick={handleNew}
                icon={Plus}
                iconSize={20}
              >
                {t("whitelist.buttons.add")}
              </ContentPrimaryButton>
            )}
            className="rounded-2xl"
          />
        ) : (
          <ContentTableSurface>
            <table className="w-full">
              <ContentTableHeader>
                <tr>
                  <ContentTableHeadCell>
                    {t("whitelist.table.email")}
                  </ContentTableHeadCell>
                  <ContentTableHeadCell>
                    {t("whitelist.table.desc")}
                  </ContentTableHeadCell>
                  <ContentTableHeadCell>
                    {t("whitelist.table.time")}
                  </ContentTableHeadCell>
                  <ContentTableHeadCell align="right">
                    {t("whitelist.table.actions")}
                  </ContentTableHeadCell>
                </tr>
              </ContentTableHeader>
              <tbody className="bg-white divide-y divide-gray-200">
                {whitelists.map((item) => (
                  <tr key={item.id} className="hover:bg-gray-50 transition-colors">
                    <ContentTableCell nowrap>
                      <div className="text-sm font-medium text-gray-900">
                        {item.email}
                      </div>
                    </ContentTableCell>
                    <ContentTableCell>
                      <div className="text-sm text-gray-500">
                        {item.description || "-"}
                      </div>
                    </ContentTableCell>
                    <ContentTableCell nowrap className="text-sm text-gray-500">
                      {formatDate(item.created)}
                    </ContentTableCell>
                    <ContentTableCell nowrap align="right" className="text-sm font-medium">
                      <div className="flex items-center justify-end gap-2">
                        <ContentEditDeleteActions
                          onEdit={() => handleEdit(item)}
                          onDelete={() => setDeleteConfirmId(item.id)}
                          editTitle={t("whitelist.buttons.edit")}
                          deleteTitle={t("whitelist.buttons.delete")}
                          deleting={deletingId === item.id}
                          iconSize={16}
                          size="sm"
                        />
                      </div>
                    </ContentTableCell>
                  </tr>
                ))}
              </tbody>
            </table>
          </ContentTableSurface>
        )}
      </div>

      {/* 删除确认弹窗 */}
      <Modal
        isOpen={Boolean(deleteConfirmId)}
        onClose={() => setDeleteConfirmId(null)}
        title={t("whitelist.delete.title")}
        size="sm"
      >
        <div className="space-y-5 px-6 py-5">
          <p className="text-gray-600">
            {t("whitelist.delete.desc")}
          </p>
          <div className="flex items-center justify-end gap-3">
            <ContentSecondaryButton onClick={() => setDeleteConfirmId(null)}>
              {t("whitelist.buttons.cancel")}
            </ContentSecondaryButton>
            <ContentPrimaryButton
              type="button"
              onClick={() => handleDelete(deleteConfirmId)}
              disabled={deletingId === deleteConfirmId}
              loading={deletingId === deleteConfirmId}
              className="bg-red-600 text-white hover:bg-red-700"
            >
              {t("whitelist.buttons.confirmDelete")}
            </ContentPrimaryButton>
          </div>
        </div>
      </Modal>
    </div>
  );
}
