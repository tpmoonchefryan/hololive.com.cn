import { useState } from "react";
import {
  Outlet,
  useParams,
  useNavigate,
  useLocation,
  Link,
} from "react-router-dom";
import {
  LayoutDashboard,
  Activity,
  FileText,
  LogOut,
  User,
  Users,
  ChevronDown,
  ChevronRight,
  Shield,
  UserCircle,
  Settings,
  Bell,
  Image,
  Home,
  Map,
  Server,
  ClipboardList,
  Monitor,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import pb from "../../lib/pocketbase";
import GlobalBanner from "../announcement/GlobalBanner";
import LanguageSwitcher from "./LanguageSwitcher";

/**
 * 后台管理系统主布局组件
 * 采用 Sidebar + Topbar + Content 的现代化布局
 */
export default function AdminLayout() {
  const { t } = useTranslation();
  const { adminKey } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const user = pb.authStore.model;
  const [expandedMenus, setExpandedMenus] = useState({});
  const [loggingOut, setLoggingOut] = useState(false);

  // 处理登出
  const handleLogout = async () => {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      pb.authStore.clear();
      navigate(`/${adminKey}/webadmin/login`);
    } finally {
      setLoggingOut(false);
    }
  };

  // 导航菜单项
  const navItems = [
    {
      label: t("admin.sidebar.dashboard"),
      key: "dashboard",
      icon: LayoutDashboard,
      path: `/${adminKey}/webadmin/dashboard`,
    },
    {
      label: t("admin.sidebar.velocity"),
      key: "velocity",
      icon: Activity,
      path: `/${adminKey}/webadmin/velocity`,
    },
    {
      label: t("admin.sidebar.mcsm"),
      key: "mcsm",
      icon: Monitor,
      path: `/${adminKey}/webadmin/mcsm`,
    },
    {
      label: t("admin.sidebar.posts"),
      key: "posts",
      icon: FileText,
      path: `/${adminKey}/webadmin/posts`,
    },
    {
      label: t("admin.sidebar.media"),
      key: "media",
      icon: Image,
      path: `/${adminKey}/webadmin/media`,
    },
    {
      label: t("admin.sidebar.home"),
      key: "home",
      icon: Home,
      path: `/${adminKey}/webadmin/home`,
    },
    {
      label: t("admin.sidebar.accounts"),
      key: "accounts",
      icon: Users,
      children: [
        {
          label: t("admin.sidebar.whitelist"),
          key: "whitelist",
          icon: Shield,
          path: `/${adminKey}/webadmin/accounts/whitelist`,
        },
        {
          label: t("admin.sidebar.localAccounts"),
          key: "local-accounts",
          icon: UserCircle,
          path: `/${adminKey}/webadmin/accounts/local`,
        },
      ],
    },
    {
      label: t("admin.sidebar.logs"),
      key: "logs",
      icon: ClipboardList,
      path: `/${adminKey}/webadmin/logs`,
    },
    {
      label: t("admin.sidebar.settings"),
      key: "settings",
      icon: Settings,
      path: `/${adminKey}/webadmin/settings`,
    },
    {
      label: t("admin.sidebar.announcements"),
      key: "announcements",
      icon: Bell,
      path: `/${adminKey}/webadmin/announcements`,
    },
    {
      label: t("admin.sidebar.serverMaps"),
      key: "server-maps",
      icon: Map,
      path: `/${adminKey}/webadmin/server-maps`,
    },
    {
      label: t("admin.sidebar.serverInfoFields"),
      key: "server-info-fields",
      icon: Server,
      path: `/${adminKey}/webadmin/server-info-fields`,
    },
  ];

  // 检查当前路径是否激活
  const isActive = (path) => location.pathname === path;

  // 检查菜单项或其子项是否激活
  const isMenuActive = (item) => {
    if (item.path) return isActive(item.path);
    if (item.children) {
      return item.children.some((child) => isActive(child.path));
    }
    return false;
  };

  // 当前页面标题
  const currentTitle =
    navItems
      .flatMap((item) =>
        item.children && item.children.length
          ? [item, ...item.children]
          : [item],
      )
      .find((item) => item.path && isActive(item.path))?.label || t("admin.backend");

  // 切换菜单展开/折叠
  const toggleMenu = (label) => {
    setExpandedMenus((prev) => ({
      ...prev,
      [label]: !prev[label],
    }));
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-50">
      {/* 顶部全站公告 */}
      <GlobalBanner />

      <div className="flex flex-1">
        {/* 侧边栏 */}
        <aside className="hidden md:flex md:w-64 lg:w-72 bg-slate-950 text-white flex-col border-r border-slate-800/80">
          {/* Logo / 标题区域 */}
          <div className="px-6 py-5 border-b border-slate-800 flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-[var(--color-brand-blue)] flex items-center justify-center shadow-[0_0_15px_rgba(142,209,252,0.6)]">
              <User className="w-5 h-5 text-slate-950" />
            </div>
            <div className="flex flex-col">
              <span className="text-sm font-semibold tracking-wide text-slate-100 uppercase">
                {t("admin.console")}
              </span>
              <span className="text-xs text-slate-400">{t("admin.sidebar.subtitle")}</span>
            </div>
          </div>

          {/* 导航菜单 */}
          <nav className="flex-1 px-3 py-4 space-y-2 overflow-y-auto">
            {navItems.map((item) => {
              const Icon = item.icon;
              const hasChildren = item.children && item.children.length > 0;
              const menuActive = isMenuActive(item);
              const isExpanded =
                expandedMenus[item.label] ?? (menuActive && hasChildren);

              if (hasChildren) {
                return (
                  <div key={item.key} className="space-y-1">
                    <button
                      type="button"
                      onClick={() => toggleMenu(item.label)}
                      className={`w-full flex items-center justify-between gap-3 px-3.5 py-2.5 rounded-xl text-sm transition-colors ${menuActive
                        ? "bg-[var(--color-brand-blue)]/15 text-white border border-[var(--color-brand-blue)]/60"
                        : "text-slate-300 hover:bg-slate-800/80 hover:text-white"
                        }`}
                    >
                      <div className="flex items-center gap-3">
                        <Icon className="w-4.5 h-4.5" />
                        <span className="font-medium">{item.label}</span>
                      </div>
                      {isExpanded ? (
                        <ChevronDown className="w-4 h-4" />
                      ) : (
                        <ChevronRight className="w-4 h-4" />
                      )}
                    </button>
                    {isExpanded && (
                      <div className="ml-3 mt-1 space-y-0.5 border-l border-slate-800/60 pl-3">
                        {item.children.map((child) => {
                          const ChildIcon = child.icon;
                          const childActive = isActive(child.path);
                          return (
                            <Link
                              key={child.key}
                              to={child.path}
                              className={`flex items-center gap-2.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${childActive
                                ? "bg-[var(--color-brand-blue)]/20 text-white border border-[var(--color-brand-blue)]/60"
                                : "text-slate-300/80 hover:bg-slate-800 hover:text-white"
                                }`}
                            >
                              <ChildIcon className="w-4 h-4" />
                              <span>{child.label}</span>
                            </Link>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              }

              const active = isActive(item.path);
              return (
                <Link
                  key={item.key}
                  to={item.path}
                  className={`flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-medium transition-colors border ${active
                    ? "bg-[var(--color-brand-blue)]/20 text-white border-[var(--color-brand-blue)]/60 shadow-[0_0_20px_rgba(142,209,252,0.45)]"
                    : "border-transparent text-slate-300 hover:bg-slate-800/80 hover:text-white"
                    }`}
                >
                  <span
                    className={`inline-block w-1 h-6 rounded-full ${active
                      ? "bg-[var(--color-brand-blue)]"
                      : "bg-transparent"
                      }`}
                  />
                  <Icon className="w-4.5 h-4.5" />
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </nav>

          {/* 底部用户信息和登出按钮 */}
          <div className="px-4 py-4 border-t border-slate-800/80 space-y-3 bg-slate-950/95">
            <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-slate-800/80">
              <div className="w-9 h-9 rounded-full bg-[var(--color-brand-blue)] flex items-center justify-center text-slate-950 font-semibold shadow-[0_0_15px_rgba(142,209,252,0.6)]">
                <User className="w-4.5 h-4.5" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-slate-100 truncate">
                  {user?.email || "Admin"}
                </p>
                <p className="text-[11px] text-slate-400 truncate">{t("admin.sidebar.role")}</p>
              </div>
            </div>

            <Link
              to="/"
              className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl text-sm font-medium text-slate-200 bg-slate-900/80 hover:bg-slate-800 transition-colors"
            >
              <Home className="w-4.5 h-4.5" />
              <span>{t("admin.sidebar.backHome")}</span>
            </Link>

            <button
              type="button"
              onClick={handleLogout}
              disabled={loggingOut}
              className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl text-sm font-medium text-slate-200 bg-slate-900/80 hover:bg-slate-800 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
            >
              <LogOut className="w-4.5 h-4.5" />
              <span>{loggingOut ? t("admin.sidebar.loggingOut") : t("admin.sidebar.logout")}</span>
            </button>
          </div>
        </aside>

        {/* 主内容区域 */}
        <main className="flex-1 flex flex-col min-w-0">
          {/* 顶部栏（桌面端） */}
          <header className="hidden md:flex items-center justify-between px-6 py-3 border-b border-slate-200/80 bg-white/80 backdrop-blur-md">
            <div className="flex flex-col gap-0.5">
              <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">
                {t("admin.backend")}
              </p>
              <h1 className="text-lg font-semibold text-slate-900">
                {currentTitle}
              </h1>
            </div>
            <div className="flex items-center gap-3 text-xs text-slate-500">
              <LanguageSwitcher />
              <span className="hidden sm:inline">{t("admin.header.currentAdmin")}:</span>
              <span className="px-2.5 py-1 rounded-full bg-slate-100 text-slate-700 font-medium truncate max-w-[200px]">
                {user?.email || t("admin.header.notLoggedIn")}
              </span>
            </div>
          </header>

          {/* 移动端简单顶部栏，仅展示标题 */}
          <header className="md:hidden px-4 py-2 border-b border-slate-200 bg-white/90 backdrop-blur-md flex items-center justify-between">
            <h1 className="text-base font-semibold text-slate-900">
              {currentTitle}
            </h1>
            <div className="flex items-center gap-2">
              <LanguageSwitcher />
              <span className="text-[11px] text-slate-500">
                {user?.email || t("admin.header.notLoggedIn")}
              </span>
            </div>
          </header>

          {/* 内容容器 */}
          <div className="flex-1 overflow-auto px-4 py-4 md:px-6 md:py-6">
            <div className="mx-auto w-full max-w-6xl">
              <Outlet />
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
