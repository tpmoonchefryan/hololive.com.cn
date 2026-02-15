import {
  Server,
  Settings,
  Upload,
  RefreshCw,
  LayoutDashboard,
  Globe,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import useVelocityData from "../../hooks/useVelocityData";
import DashboardTab from "../../components/admin/velocity/DashboardTab";
import ServersTab from "../../components/admin/velocity/ServersTab";
import ForcedHostsTab from "../../components/admin/velocity/ForcedHostsTab";
import SettingsTab from "../../components/admin/velocity/SettingsTab";
import UpdateTab from "../../components/admin/velocity/UpdateTab";
import ServerModal from "../../components/admin/velocity/ServerModal";
import ContentPageHeader from "../../components/admin/content/ContentPageHeader";
import ContentPrimaryButton from "../../components/admin/content/ContentPrimaryButton";
import ContentSecondaryButton from "../../components/admin/content/ContentSecondaryButton";
import ContentStateBlock from "../../components/admin/content/ContentStateBlock";
import ContentCardSurface from "../../components/admin/content/ContentCardSurface";
import ContentTabsNav from "../../components/admin/content/ContentTabsNav";

export default function VelocityManager() {
  const { t } = useTranslation();
  const {
    activeTab,
    setActiveTab,
    settings,
    setSettings,
    servers,
    forcedHosts,
    loading,
    saving,
    uploading,
    restarting,
    testingMap,
    newServer,
    setNewServer,
    editingServer,
    isServerModalOpen,
    setIsServerModalOpen,
    newForcedHost,
    setNewForcedHost,
    fetchData,
    handleAddServer,
    handleEditServer,
    handleDeleteServer,
    handleSaveServer,
    handleSaveSettings,
    handleRestartProxy,
    handleTestConnection,
    handleAddForcedHost,
    handleDeleteForcedHost,
    handleFileUpload,
  } = useVelocityData();

  if (loading) {
    return (
      <ContentStateBlock
        loading
        loadingText={t("admin.velocity.loading")}
        className="rounded-2xl"
      />
    );
  }

  const tabs = [
    { id: "dashboard", label: t("admin.velocity.tabs.dashboard"), icon: LayoutDashboard },
    { id: "servers", label: t("admin.velocity.tabs.servers"), icon: Server },
    { id: "forced-hosts", label: t("admin.velocity.tabs.forcedHosts"), icon: Globe },
    { id: "settings", label: t("admin.velocity.tabs.settings"), icon: Settings },
    { id: "update", label: t("admin.velocity.tabs.update"), icon: Upload },
  ];

  return (
    <div className="space-y-6">
      <ContentPageHeader
        title={t("admin.velocity.title")}
        subtitle={t("admin.velocity.subtitle")}
        actions={(
          <>
            <ContentPrimaryButton
              type="button"
              onClick={handleRestartProxy}
              loading={restarting}
              icon={RefreshCw}
              iconSize={16}
              className="bg-red-600 text-white hover:bg-red-700"
              loadingLabel={t("admin.velocity.restarting")}
            >
              {t("admin.velocity.restart")}
            </ContentPrimaryButton>
            <ContentSecondaryButton
              type="button"
              onClick={fetchData}
              className="inline-flex items-center gap-2"
            >
              <RefreshCw className="w-4 h-4" />
              {t("admin.velocity.refresh")}
            </ContentSecondaryButton>
          </>
        )}
      />

      <ContentTabsNav
        tabs={tabs}
        activeTab={activeTab}
        onChange={setActiveTab}
      />

      <ContentCardSurface className="p-6">
        {activeTab === "dashboard" && <DashboardTab settings={settings} servers={servers} />}
        {activeTab === "servers" && (
          <ServersTab
            servers={servers}
            testingMap={testingMap}
            onTest={handleTestConnection}
            onAdd={handleAddServer}
            onEdit={handleEditServer}
            onDelete={handleDeleteServer}
          />
        )}
        {activeTab === "forced-hosts" && (
          <ForcedHostsTab
            forcedHosts={forcedHosts}
            servers={servers}
            newForcedHost={newForcedHost}
            setNewForcedHost={setNewForcedHost}
            onAdd={handleAddForcedHost}
            onDelete={handleDeleteForcedHost}
          />
        )}
        {activeTab === "settings" && (
          <SettingsTab
            settings={settings}
            setSettings={setSettings}
            saving={saving}
            onSave={handleSaveSettings}
          />
        )}
        {activeTab === "update" && (
          <UpdateTab
            settings={settings}
            uploading={uploading}
            onUpload={handleFileUpload}
          />
        )}
      </ContentCardSurface>

      <ServerModal
        isOpen={isServerModalOpen}
        editingServer={editingServer}
        newServer={newServer}
        setNewServer={setNewServer}
        saving={saving}
        onSave={handleSaveServer}
        onClose={() => setIsServerModalOpen(false)}
      />
    </div>
  );
}
