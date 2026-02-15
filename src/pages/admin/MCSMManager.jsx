import {
  Settings,
  LayoutDashboard,
  Server,
  Terminal,
  FolderOpen,
  RefreshCw,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import useMCSMData from "../../hooks/useMCSMData";
import MCSMSettingsTab from "../../components/admin/mcsm/MCSMSettingsTab";
import MCSMDashboardTab from "../../components/admin/mcsm/MCSMDashboardTab";
import MCSMInstancesTab from "../../components/admin/mcsm/MCSMInstancesTab";
import MCSMConsoleTab from "../../components/admin/mcsm/MCSMConsoleTab";
import MCSMFilesTab from "../../components/admin/mcsm/MCSMFilesTab";
import ContentPageHeader from "../../components/admin/content/ContentPageHeader";
import ContentSecondaryButton from "../../components/admin/content/ContentSecondaryButton";
import ContentStateBlock from "../../components/admin/content/ContentStateBlock";
import ContentCardSurface from "../../components/admin/content/ContentCardSurface";
import ContentTabsNav from "../../components/admin/content/ContentTabsNav";

export default function MCSMManager() {
  const { t } = useTranslation();
  const data = useMCSMData();

  if (data.loading) {
    return (
      <ContentStateBlock
        loading
        loadingText={t("admin.mcsm.loading")}
        className="rounded-2xl"
      />
    );
  }

  const tabs = [
    { id: "dashboard", label: t("admin.mcsm.tabs.dashboard"), icon: LayoutDashboard },
    { id: "instances", label: t("admin.mcsm.tabs.instances"), icon: Server },
    { id: "console", label: t("admin.mcsm.tabs.console"), icon: Terminal },
    { id: "files", label: t("admin.mcsm.tabs.files"), icon: FolderOpen },
    { id: "settings", label: t("admin.mcsm.tabs.settings"), icon: Settings },
  ];

  return (
    <div className="space-y-6">
      <ContentPageHeader
        title={t("admin.mcsm.title")}
        subtitle={t("admin.mcsm.subtitle")}
        actions={(
          <ContentSecondaryButton
            type="button"
            onClick={data.fetchConfig}
            className="inline-flex items-center gap-2"
          >
            <RefreshCw className="w-4 h-4" />
            {t("admin.mcsm.refresh")}
          </ContentSecondaryButton>
        )}
      />

      <ContentTabsNav
        tabs={tabs}
        activeTab={data.activeTab}
        onChange={data.setActiveTab}
      />

      <ContentCardSurface className="p-6">
        {data.activeTab === "dashboard" && (
          <MCSMDashboardTab
            overview={data.overview}
            fetchOverview={data.fetchOverview}
          />
        )}
        {data.activeTab === "instances" && (
          <MCSMInstancesTab
            instances={data.instances}
            fetchAllInstances={data.fetchAllInstances}
            handleInstanceAction={data.handleInstanceAction}
            actionLoading={data.actionLoading}
            config={data.config}
            onToggleHide={data.handleToggleHide}
            onRename={data.handleRenameInstance}
          />
        )}
        {data.activeTab === "console" && (
          <MCSMConsoleTab
            instances={data.instances}
            fetchAllInstances={data.fetchAllInstances}
            selectedInstance={data.selectedInstance}
            setSelectedInstance={data.setSelectedInstance}
            consoleLog={data.consoleLog}
            commandInput={data.commandInput}
            setCommandInput={data.setCommandInput}
            sendingCommand={data.sendingCommand}
            startConsolePolling={data.startConsolePolling}
            stopConsolePolling={data.stopConsolePolling}
            handleSendCommand={data.handleSendCommand}
          />
        )}
        {data.activeTab === "files" && (
          <MCSMFilesTab
            instances={data.instances}
            fetchAllInstances={data.fetchAllInstances}
            selectedInstance={data.selectedInstance}
            setSelectedInstance={data.setSelectedInstance}
            files={data.files}
            currentPath={data.currentPath}
            filesLoading={data.filesLoading}
            fetchFiles={data.fetchFiles}
            readFile={data.readFile}
            writeFile={data.writeFile}
            createDir={data.createDir}
            createFile={data.createFile}
            deleteFiles={data.deleteFiles}
          />
        )}
        {data.activeTab === "settings" && (
          <MCSMSettingsTab
            config={data.config}
            setConfig={data.setConfig}
            saving={data.saving}
            onSave={data.handleSaveConfig}
            onTest={data.handleTestConnection}
            testingConnection={data.testingConnection}
          />
        )}
      </ContentCardSurface>
    </div>
  );
}
