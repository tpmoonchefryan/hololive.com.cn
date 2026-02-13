import { Suspense, lazy } from "react";
import { createBrowserRouter, Navigate } from "react-router-dom";
import { useTranslation } from "react-i18next";

const Home = lazy(() => import("./pages/Home"));
const Docs = lazy(() => import("./pages/Docs"));
const WebsiteAnnouncements = lazy(() => import("./pages/WebsiteAnnouncements"));
const ServerInfo = lazy(() => import("./pages/ServerInfo"));
const OtherDocuments = lazy(() => import("./pages/OtherDocuments"));
const MainLayout = lazy(() => import("./components/layout/MainLayout"));
const ErrorPage = lazy(() => import("./pages/ErrorPage"));
const AdminGuard = lazy(() => import("./components/auth/AdminGuard"));
const RequireAdminAuth = lazy(() => import("./components/auth/RequireAdminAuth"));
const AdminLayout = lazy(() => import("./components/admin/AdminLayout"));
const AdminLogin = lazy(() => import("./pages/admin/AdminLogin"));
const AdminDashboard = lazy(() => import("./pages/admin/Dashboard"));
const Posts = lazy(() => import("./pages/admin/Posts"));
const PostEditor = lazy(() => import("./pages/admin/PostEditor"));
const WhitelistPage = lazy(() => import("./pages/admin/WhitelistPage"));
const AdminUsersPage = lazy(() => import("./pages/admin/AdminUsersPage"));
const SettingsPage = lazy(() => import("./pages/admin/SettingsPage"));
const AnnouncementPage = lazy(() => import("./pages/admin/AnnouncementPage"));
const MediaPage = lazy(() => import("./pages/admin/MediaPage"));
const HomeManager = lazy(() => import("./pages/admin/HomeManager"));
const SectionEditor = lazy(() => import("./pages/admin/SectionEditor"));
const ServerMapManager = lazy(() => import("./pages/admin/ServerMapManager"));
const ServerInfoFields = lazy(() => import("./pages/admin/ServerInfoFields"));
const AuditLogs = lazy(() => import("./pages/admin/AuditLogs"));
const ArticleDetail = lazy(() => import("./pages/ArticleDetail"));
const VelocityManager = lazy(() => import("./pages/admin/VelocityManager"));
const MCSMManager = lazy(() => import("./pages/admin/MCSMManager"));

function RouteFallback() {
  const { t } = useTranslation("common");
  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-slate-50 text-slate-500">
      {t("routeLoading")}
    </div>
  );
}

function withSuspense(element) {
  return <Suspense fallback={<RouteFallback />}>{element}</Suspense>;
}

const router = createBrowserRouter([
  {
    path: "/",
    element: withSuspense(<MainLayout />),
    children: [
      {
        index: true,
        element: withSuspense(<Home />),
      },
      {
        path: "docs",
        element: withSuspense(<Docs />),
      },
      {
        path: "docs/announcements",
        element: withSuspense(<WebsiteAnnouncements />),
      },
      {
        path: "docs/server-info",
        element: withSuspense(<ServerInfo />),
      },
      {
        path: "docs/documents",
        element: withSuspense(<OtherDocuments />),
      },
      {
        path: "docs/article/:id",
        element: withSuspense(<ArticleDetail />),
      },
    ],
  },
  {
    path: "/403",
    element: withSuspense(<ErrorPage code="E403" />),
  },
  {
    path: "/404",
    element: withSuspense(<ErrorPage code="E404" />),
  },
  {
    path: "/418",
    element: withSuspense(<ErrorPage code="E418" />),
  },
  {
    path: "/500",
    element: withSuspense(<ErrorPage code="E500" />),
  },
  {
    path: "/503",
    element: withSuspense(<ErrorPage code="E503" />),
  },
  {
    path: "/:adminKey/webadmin",
    element: withSuspense(<AdminGuard />), // 第一道防线：隐蔽路径验证
    children: [
      {
        index: true, // 访问根路径时默认跳转到 login
        element: <Navigate to="login" replace />,
      },
      {
        path: "login",
        element: withSuspense(<AdminLogin />),
      },
      {
        // 受保护的区域：需要登录验证
        element: withSuspense(<RequireAdminAuth />), // 第二道防线：身份验证
        children: [
          {
            // 使用 AdminLayout 包裹所有后台管理页面
            element: withSuspense(<AdminLayout />),
            children: [
              {
                index: true, // 默认跳转到 dashboard
                element: <Navigate to="dashboard" replace />,
              },
              {
                path: "dashboard",
                element: withSuspense(<AdminDashboard />),
              },
              {
                path: "posts",
                element: withSuspense(<Posts />),
              },
              {
                path: "posts/new",
                element: withSuspense(<PostEditor />),
              },
              {
                path: "posts/:id",
                element: withSuspense(<PostEditor />),
              },
              {
                path: "accounts/whitelist",
                element: withSuspense(<WhitelistPage />),
              },
              {
                path: "accounts/local",
                element: withSuspense(<AdminUsersPage />),
              },
              {
                path: "settings",
                element: withSuspense(<SettingsPage />),
              },
              {
                path: "announcements",
                element: withSuspense(<AnnouncementPage />),
              },
              {
                path: "media",
                element: withSuspense(<MediaPage />),
              },
              {
                path: "home",
                element: withSuspense(<HomeManager />),
              },
              {
                path: "home/new",
                element: withSuspense(<SectionEditor />),
              },
              {
                path: "home/:id",
                element: withSuspense(<SectionEditor />),
              },
              {
                path: "server-maps",
                element: withSuspense(<ServerMapManager />),
              },
              {
                path: "server-info-fields",
                element: withSuspense(<ServerInfoFields />),
              },
              {
                path: "logs",
                element: withSuspense(<AuditLogs />),
              },
              {
                path: "velocity",
                element: withSuspense(<VelocityManager />),
              },
              {
                path: "mcsm",
                element: withSuspense(<MCSMManager />),
              },
            ],
          },
        ],
      },
    ],
  },
  {
    path: "*",
    element: withSuspense(<ErrorPage code="E404" />),
  },
]);

export default router;
