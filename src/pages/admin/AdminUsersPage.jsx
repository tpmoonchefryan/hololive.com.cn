import { useState, useEffect } from "react";
import {
  Plus,
  Trash2,
  Loader2,
  User,
  UserX,
  Save,
  AlertTriangle,
} from "lucide-react";
import pb from "../../lib/pocketbase";
import { useTranslation } from "react-i18next";
import { useUIFeedback } from "../../hooks/useUIFeedback";
import { createAppLogger } from "../../lib/appLogger";
import Modal from "../../components/admin/ui/Modal";
import { formatLocalizedDate } from "../../utils/localeFormat";
import ContentPageHeader from "../../components/admin/content/ContentPageHeader";
import ContentPrimaryButton from "../../components/admin/content/ContentPrimaryButton";
import ContentSecondaryButton from "../../components/admin/content/ContentSecondaryButton";
import ContentFieldLabel from "../../components/admin/content/ContentFieldLabel";
import ContentTextInput from "../../components/admin/content/ContentTextInput";
import ContentCheckboxInput from "../../components/admin/content/ContentCheckboxInput";
import ContentStateBlock from "../../components/admin/content/ContentStateBlock";
import ContentTableSurface from "../../components/admin/content/ContentTableSurface";
import ContentTableHeader from "../../components/admin/content/ContentTableHeader";
import ContentTableHeadCell from "../../components/admin/content/ContentTableHeadCell";
import ContentTableCell from "../../components/admin/content/ContentTableCell";
import ContentStatusPill from "../../components/admin/content/ContentStatusPill";
import ContentIconActionButton from "../../components/admin/content/ContentIconActionButton";
import ContentCardSurface from "../../components/admin/content/ContentCardSurface";

/**
 * 本地管理员账号管理页面
 * 管理 users 集合中的管理员账号
 */
const logger = createAppLogger("AdminUsersPage");

export default function AdminUsersPage() {
  const { t, i18n } = useTranslation();
  const { notify } = useUIFeedback();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState(null);
  const [disablingId, setDisablingId] = useState(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({
    email: "",
    password: "",
    passwordConfirm: "",
  });
  const [enableLocalLogin, setEnableLocalLogin] = useState(true);
  const [updatingLoginSetting, setUpdatingLoginSetting] = useState(false);

  const closeForm = () => {
    setShowForm(false);
    setFormData({ email: "", password: "", passwordConfirm: "" });
  };

  // 获取用户列表
  const fetchUsers = async () => {
    try {
      setLoading(true);
      const result = await pb.collection("users").getList(1, 100, {
        sort: "-created",
      });
      setUsers(result.items);
    } catch (error) {
      logger.error("Failed to fetch users:", error);
      const detail =
        error?.response?.data ||
        error?.data ||
        error?.response ||
        error?.message ||
        error;
      notify(`${t("admin.users.error.fetchUsers")} ${JSON.stringify(detail)}`, "error");
    } finally {
      setLoading(false);
    }
  };

  // 获取本地登录开关状态
  const fetchLoginSetting = async () => {
    try {
      const settings = await pb.collection("system_settings").getOne("1");
      setEnableLocalLogin(settings?.enable_local_login ?? true);
    } catch (error) {
      logger.error("Failed to fetch login setting:", error);
      // 如果读取失败，默认开启（安全回退）
      setEnableLocalLogin(true);
    }
  };

  // 更新本地登录开关
  const handleToggleLocalLogin = async (newValue) => {
    try {
      setUpdatingLoginSetting(true);
      await pb.collection("system_settings").update("1", {
        enable_local_login: newValue,
      });
      setEnableLocalLogin(newValue);
    } catch (error) {
      logger.error("Failed to update login setting:", error);
      const detail =
        error?.response?.data ||
        error?.data ||
        error?.response ||
        error?.message ||
        error;
      notify(`${t("admin.users.error.updateLoginSetting")} ${JSON.stringify(detail)}`, "error");
    } finally {
      setUpdatingLoginSetting(false);
    }
  };

  useEffect(() => {
    fetchUsers();
    fetchLoginSetting();
  }, []);

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
    setFormData({ email: "", password: "", passwordConfirm: "" });
    setShowForm(true);
  };

  // 创建新管理员
  const handleCreate = async (e) => {
    e.preventDefault();

    // 验证密码
    if (formData.password !== formData.passwordConfirm) {
      notify(t("admin.users.modal.passwordMismatch"), "warning");
      return;
    }

    if (formData.password.length < 8) {
      notify(t("admin.users.modal.passwordTooShort"), "warning");
      return;
    }

    try {
      const payload = {
        email: formData.email,
        password: formData.password,
        passwordConfirm: formData.passwordConfirm,
        emailVisibility: true,
      };
      await pb.collection("users").create(payload);
      notify(t("admin.users.modal.success"), "success");
      closeForm();
      await fetchUsers();
    } catch (error) {
      logger.error("Failed to create user:", error);
      const detail =
        error?.response?.data ||
        error?.data ||
        error?.response ||
        error?.message ||
        error;
      notify(`${t("admin.users.error.createUser")} ${JSON.stringify(detail)}`, "error");
    }
  };

  // 禁用账号（将 verified 设为 false）
  const handleDisable = async (userId) => {
    try {
      setDisablingId(userId);
      await pb.collection("users").update(userId, {
        verified: false,
      });
      notify(t("admin.users.actions.deleted"), "success");
      await fetchUsers();
    } catch (error) {
      logger.error("Failed to disable user:", error);
      const detail =
        error?.response?.data ||
        error?.data ||
        error?.response ||
        error?.message ||
        error;
      notify(`${t("admin.users.error.disableUser")} ${JSON.stringify(detail)}`, "error");
    } finally {
      setDisablingId(null);
    }
  };

  // 删除账号
  const handleDelete = async (id) => {
    try {
      setDeletingId(id);
      await pb.collection("users").delete(id);
      await fetchUsers();
      setDeleteConfirmId(null);
    } catch (error) {
      logger.error("Failed to delete user:", error);
      const detail =
        error?.response?.data ||
        error?.data ||
        error?.response ||
        error?.message ||
        error;
      notify(`${t("admin.users.error.deleteUser")} ${JSON.stringify(detail)}`, "error");
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="space-y-4">
        <ContentPageHeader
          title={t("admin.users.title")}
          subtitle={t("admin.users.subtitle")}
          actions={(
            <ContentPrimaryButton
              type="button"
              onClick={handleNew}
              variant="pill"
              icon={Plus}
              iconSize={20}
            >
              {t("admin.users.add")}
            </ContentPrimaryButton>
          )}
        />

        {/* 本地登录开关设置区域 */}
        <ContentCardSurface className="border-2 border-amber-200 bg-amber-50/50 p-5">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-2">
                <AlertTriangle className="w-5 h-5 text-amber-600" />
                <h3 className="text-lg font-semibold text-amber-900">
                  {t("admin.users.toggle.title")}
                </h3>
              </div>
              <p className="text-sm text-amber-800 mb-3">
                {t("admin.users.toggle.desc")}
              </p>
              <p className="text-xs text-amber-700">
                {t("admin.users.toggle.sub")}
              </p>
            </div>
            <label className="flex items-center gap-3 cursor-pointer flex-shrink-0">
              <ContentCheckboxInput
                checked={enableLocalLogin}
                onChange={(e) => handleToggleLocalLogin(e.target.checked)}
                disabled={updatingLoginSetting}
                className="disabled:opacity-50 disabled:cursor-not-allowed"
              />
              <span className="text-sm font-medium text-amber-900">
                {enableLocalLogin ? t("admin.users.toggle.on") : t("admin.users.toggle.off")}
              </span>
              {updatingLoginSetting && (
                <Loader2 className="w-4 h-4 animate-spin text-amber-600" />
              )}
            </label>
          </div>
        </ContentCardSurface>

        {/* 新建表单弹窗 */}
        <Modal
          isOpen={showForm}
          onClose={closeForm}
          title={t("admin.users.modal.addTitle")}
          size="sm"
        >
          <form onSubmit={handleCreate} className="space-y-4 px-6 py-5">
            <div>
              <ContentFieldLabel htmlFor="admin-user-email">
                {t("admin.users.modal.email")}
              </ContentFieldLabel>
              <ContentTextInput
                id="admin-user-email"
                type="email"
                name="email"
                autoComplete="off"
                spellCheck={false}
                value={formData.email}
                onChange={(e) =>
                  setFormData({ ...formData, email: e.target.value })
                }
                className="px-4 py-2"
                placeholder={t("admin.users.modal.emailPlaceholder")}
                required
              />
            </div>
            <div>
              <ContentFieldLabel htmlFor="admin-user-password">
                {t("admin.users.modal.password")}
              </ContentFieldLabel>
              <ContentTextInput
                id="admin-user-password"
                type="password"
                name="password"
                autoComplete="new-password"
                value={formData.password}
                onChange={(e) =>
                  setFormData({ ...formData, password: e.target.value })
                }
                className="px-4 py-2"
                placeholder={t("admin.users.modal.passwordHint")}
                required
                minLength={8}
              />
            </div>
            <div>
              <ContentFieldLabel htmlFor="admin-user-password-confirm">
                {t("admin.users.modal.confirmPassword")}
              </ContentFieldLabel>
              <ContentTextInput
                id="admin-user-password-confirm"
                type="password"
                name="passwordConfirm"
                autoComplete="new-password"
                value={formData.passwordConfirm}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    passwordConfirm: e.target.value,
                  })
                }
                className="px-4 py-2"
                placeholder={t("admin.users.modal.confirmPasswordHint")}
                required
                minLength={8}
              />
            </div>
            <div className="flex items-center justify-end gap-3 pt-4">
              <ContentSecondaryButton onClick={closeForm}>
                {t("admin.users.modal.cancel")}
              </ContentSecondaryButton>
              <ContentPrimaryButton
                type="submit"
                icon={Save}
                iconSize={16}
              >
                {t("admin.users.modal.create")}
              </ContentPrimaryButton>
            </div>
          </form>
        </Modal>

        {/* 用户列表 */}
        {loading ? (
          <ContentStateBlock
            loading
            loadingText={t("admin.users.loading")}
            className="rounded-2xl"
          />
        ) : users.length === 0 ? (
          <ContentStateBlock
            icon={User}
            title={t("admin.users.table.empty")}
            description={t("admin.users.table.emptyDesc")}
            action={(
              <ContentPrimaryButton
                type="button"
                onClick={handleNew}
                icon={Plus}
                iconSize={20}
              >
                {t("admin.users.add")}
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
                    {t("admin.users.table.avatar")}
                  </ContentTableHeadCell>
                  <ContentTableHeadCell>
                    {t("admin.users.table.email")}
                  </ContentTableHeadCell>
                  <ContentTableHeadCell>
                    {t("admin.users.table.status")}
                  </ContentTableHeadCell>
                  <ContentTableHeadCell>
                    {t("admin.users.table.created")}
                  </ContentTableHeadCell>
                  <ContentTableHeadCell align="right">
                    {t("admin.users.table.actions")}
                  </ContentTableHeadCell>
                </tr>
              </ContentTableHeader>
              <tbody className="bg-white divide-y divide-gray-200">
                {users.map((user) => (
                  <tr key={user.id} className="hover:bg-gray-50 transition-colors">
                    <ContentTableCell nowrap>
                      <div className="w-10 h-10 rounded-full bg-blue-600 flex items-center justify-center">
                        <User className="w-5 h-5 text-white" />
                      </div>
                    </ContentTableCell>
                    <ContentTableCell nowrap>
                      <div className="text-sm font-medium text-gray-900">
                        {user.email}
                      </div>
                    </ContentTableCell>
                    <ContentTableCell nowrap>
                      <ContentStatusPill
                        active={Boolean(user.verified)}
                        activeLabel={t("admin.users.table.active")}
                        inactiveLabel={t("admin.users.table.disabled")}
                      />
                    </ContentTableCell>
                    <ContentTableCell nowrap className="text-sm text-gray-500">
                      {formatDate(user.created)}
                    </ContentTableCell>
                    <ContentTableCell nowrap align="right" className="text-sm font-medium">
                      <div className="flex items-center justify-end gap-2">
                        {user.verified && (
                          <ContentIconActionButton
                            onClick={() => handleDisable(user.id)}
                            tone="neutral"
                            icon={UserX}
                            size="sm"
                            iconSize={16}
                            loading={disablingId === user.id}
                            title={t("admin.users.actions.disable")}
                            aria-label={t("admin.users.actions.disable")}
                          />
                        )}
                        <ContentIconActionButton
                          onClick={() => setDeleteConfirmId(user.id)}
                          tone="danger"
                          icon={Trash2}
                          size="sm"
                          iconSize={16}
                          loading={deletingId === user.id}
                          title={t("admin.users.actions.delete")}
                          aria-label={t("admin.users.actions.delete")}
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
        title={t("admin.users.delete.title")}
        size="sm"
      >
        <div className="space-y-5 px-6 py-5">
          <p className="text-gray-600">
            {t("admin.users.delete.desc")}
          </p>
          <div className="flex items-center justify-end gap-3">
            <ContentSecondaryButton onClick={() => setDeleteConfirmId(null)}>
              {t("admin.users.delete.cancel")}
            </ContentSecondaryButton>
            <ContentPrimaryButton
              type="button"
              onClick={() => handleDelete(deleteConfirmId)}
              disabled={deletingId === deleteConfirmId}
              loading={deletingId === deleteConfirmId}
              className="bg-red-600 text-white hover:bg-red-700"
            >
              {t("admin.users.delete.confirm")}
            </ContentPrimaryButton>
          </div>
        </div>
      </Modal>
    </div>
  );
}
