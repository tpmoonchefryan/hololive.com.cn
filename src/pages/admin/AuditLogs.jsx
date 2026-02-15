import { Fragment, useState, useEffect, useCallback } from "react";
import { Filter, ClipboardList } from "lucide-react";
import pb from "../../lib/pocketbase";
import { useTranslation } from "react-i18next";
import { createAppLogger } from "../../lib/appLogger";
import ContentPageHeader from "../../components/admin/content/ContentPageHeader";
import ContentSelectInput from "../../components/admin/content/ContentSelectInput";
import ContentStateBlock from "../../components/admin/content/ContentStateBlock";
import ContentTableSurface from "../../components/admin/content/ContentTableSurface";
import ContentTableHeader from "../../components/admin/content/ContentTableHeader";
import ContentTableHeadCell from "../../components/admin/content/ContentTableHeadCell";
import ContentTableCell from "../../components/admin/content/ContentTableCell";
import ContentSecondaryButton from "../../components/admin/content/ContentSecondaryButton";

/**
 * 操作日志审计页面
 * 显示管理员和 SSO 用户的操作记录
 */
const logger = createAppLogger("AuditLogs");

export default function AuditLogs() {
  const { t } = useTranslation("admin");
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [filterActionType, setFilterActionType] = useState("");
  const [expandedLogId, setExpandedLogId] = useState(null);

  const pageSize = 20;

  // 操作类型选项
  const actionTypes = [
    { value: "", label: t("auditLogs.actions.all") },
    { value: "登录", label: t("auditLogs.actions.login") },
    { value: "创建", label: t("auditLogs.actions.create") },
    { value: "更新", label: t("auditLogs.actions.update") },
    { value: "删除", label: t("auditLogs.actions.delete") },
    { value: "系统设置", label: t("auditLogs.actions.system") },
    { value: "其他", label: t("auditLogs.actions.other") },
  ];

  // 获取日志列表
  const fetchLogs = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      // 构建查询条件
      let filter = "";
      if (filterActionType) {
        filter = `action_type="${filterActionType}"`;
      }

      // 获取日志列表（按时间倒序）
      const result = await pb.collection("audit_logs").getList(page, pageSize, {
        sort: "-created",
        filter,
        expand: "user", // 展开用户信息
      });

      setLogs(result.items);
      setTotalPages(result.totalPages);
      setExpandedLogId(null);
    } catch (err) {
      logger.error("Failed to fetch audit logs:", err);
      setError(t("auditLogs.error.fetch"));
    } finally {
      setLoading(false);
    }
  }, [filterActionType, page, pageSize, t]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  // 格式化日期时间（中文习惯）
  const formatDateTime = (dateString) => {
    if (!dateString) return "-";
    const date = new Date(dateString);
    return new Intl.DateTimeFormat("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).format(date);
  };

  // 获取操作类型的颜色样式
  const getActionTypeColor = (actionType) => {
    const colors = {
      登录: "bg-blue-100 text-blue-800 border-blue-200",
      创建: "bg-emerald-100 text-emerald-800 border-emerald-200",
      更新: "bg-amber-100 text-amber-800 border-amber-200",
      删除: "bg-red-100 text-red-800 border-red-200",
      系统设置: "bg-purple-100 text-purple-800 border-purple-200",
      其他: "bg-slate-100 text-slate-800 border-slate-200",
    };
    return colors[actionType] || colors["其他"];
  };

  // 获取用户邮箱（从展开的用户信息中）
  const getUserEmail = (log) => {
    if (log.expand?.user?.email) {
      return log.expand.user.email;
    }
    return log.user || t("auditLogs.unknownUser");
  };

  return (
    <div className="space-y-4">
      <ContentPageHeader
        title={t("auditLogs.title")}
        subtitle={t("auditLogs.subtitle")}
        actions={(
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-slate-500" />
            <ContentSelectInput
              value={filterActionType}
              onChange={(e) => {
                setFilterActionType(e.target.value);
                setPage(1); // 重置到第一页
              }}
              className="w-auto min-w-[170px] rounded-full border-slate-200 px-3 py-1.5 text-xs md:text-sm"
            >
              {actionTypes.map((type) => (
                <option key={type.value} value={type.value}>
                  {type.label}
                </option>
              ))}
            </ContentSelectInput>
          </div>
        )}
      />

      {/* 错误提示 */}
      {error && (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-2.5 text-xs md:text-sm text-red-800">
          {error}
        </div>
      )}

      {/* 日志列表 */}
      {loading ? (
        <ContentStateBlock
          loading
          loadingText={t("auditLogs.loading", "Loading...")}
          className="rounded-2xl"
        />
      ) : logs.length === 0 ? (
        <ContentStateBlock
          icon={ClipboardList}
          title={filterActionType ? t("auditLogs.empty.filteredTitle") : t("auditLogs.empty.title")}
          description={filterActionType ? t("auditLogs.empty.filteredDesc") : t("auditLogs.empty.desc")}
          className="rounded-2xl"
        />
      ) : (
        <>
          {/* 日志表格 */}
          <ContentTableSurface>
            <table className="w-full">
              <ContentTableHeader className="bg-slate-50 border-slate-200">
                <tr>
                  <ContentTableHeadCell compact>
                    {t("auditLogs.table.time")}
                  </ContentTableHeadCell>
                  <ContentTableHeadCell compact>
                    {t("auditLogs.table.user")}
                  </ContentTableHeadCell>
                  <ContentTableHeadCell compact>
                    {t("auditLogs.table.type")}
                  </ContentTableHeadCell>
                  <ContentTableHeadCell compact>
                    {t("auditLogs.table.module")}
                  </ContentTableHeadCell>
                  <ContentTableHeadCell compact>
                    {t("auditLogs.table.details")}
                  </ContentTableHeadCell>
                </tr>
              </ContentTableHeader>
              <tbody className="bg-white divide-y divide-slate-200">
                {logs.map((log) => (
                  <Fragment key={log.id}>
                    <tr
                      className="hover:bg-slate-50 transition-colors cursor-pointer"
                      onClick={() =>
                        setExpandedLogId(expandedLogId === log.id ? null : log.id)
                      }
                    >
                      <ContentTableCell compact nowrap className="text-xs md:text-sm text-slate-600">
                        {formatDateTime(log.created)}
                      </ContentTableCell>
                      <ContentTableCell compact nowrap className="text-xs md:text-sm text-slate-900">
                        {getUserEmail(log)}
                      </ContentTableCell>
                      <ContentTableCell compact nowrap>
                        <span
                          className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium border ${getActionTypeColor(
                            log.action_type
                          )}`}
                        >
                          {log.action_type}
                        </span>
                      </ContentTableCell>
                      <ContentTableCell compact className="text-xs md:text-sm text-slate-700">
                        {log.target_module}
                      </ContentTableCell>
                      <ContentTableCell compact className="text-xs md:text-sm text-slate-600 max-w-xs truncate">
                        {log.details || "-"}
                      </ContentTableCell>
                    </tr>
                    {expandedLogId === log.id ? (
                      <tr className="bg-slate-50/70">
                        <ContentTableCell compact colSpan={5} className="text-xs text-slate-700">
                          <div className="space-y-1">
                            <p className="font-medium text-slate-800">
                              {t("auditLogs.table.details")}
                            </p>
                            <p className="whitespace-pre-wrap break-words">
                              {log.details || "-"}
                            </p>
                          </div>
                        </ContentTableCell>
                      </tr>
                    ) : null}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </ContentTableSurface>

          {/* 分页控件 */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2">
              <ContentSecondaryButton
                type="button"
                variant="pill"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
              >
                {t("auditLogs.pagination.prev")}
              </ContentSecondaryButton>
              <span className="px-3 py-1.5 text-xs text-slate-600">
                {t("auditLogs.pagination.info", { page, total: totalPages })}
              </span>
              <ContentSecondaryButton
                type="button"
                variant="pill"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
              >
                {t("auditLogs.pagination.next")}
              </ContentSecondaryButton>
            </div>
          )}
        </>
      )}
    </div>
  );
}
