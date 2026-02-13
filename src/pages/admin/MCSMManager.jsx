import {
    Settings,
    LayoutDashboard,
    Server,
    Terminal,
    FolderOpen,
    Activity,
    RefreshCw,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import useMCSMData from "../../hooks/useMCSMData";
import MCSMSettingsTab from "../../components/admin/mcsm/MCSMSettingsTab";
import MCSMDashboardTab from "../../components/admin/mcsm/MCSMDashboardTab";
import MCSMInstancesTab from "../../components/admin/mcsm/MCSMInstancesTab";
import MCSMConsoleTab from "../../components/admin/mcsm/MCSMConsoleTab";
import MCSMFilesTab from "../../components/admin/mcsm/MCSMFilesTab";

export default function MCSMManager() {
    const { t } = useTranslation();
    const data = useMCSMData();

    if (data.loading) {
        return (
            <div className="p-8 text-center text-slate-500">
                <Activity className="w-8 h-8 mx-auto mb-4 animate-spin" />
                <p>{t("admin.mcsm.loading")}</p>
            </div>
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
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h2 className="text-2xl font-bold text-slate-800">{t("admin.mcsm.title")}</h2>
                    <p className="text-slate-500">{t("admin.mcsm.subtitle")}</p>
                </div>
                <button
                    onClick={data.fetchConfig}
                    className="flex items-center gap-2 px-4 py-2 bg-white text-slate-700 border border-slate-200 rounded-lg hover:bg-slate-50"
                >
                    <RefreshCw className="w-4 h-4" />
                    {t("admin.mcsm.refresh")}
                </button>
            </div>

            <div className="border-b border-slate-200">
                <nav className="flex space-x-8">
                    {tabs.map((tab) => {
                        const Icon = tab.icon;
                        return (
                            <button
                                key={tab.id}
                                onClick={() => data.setActiveTab(tab.id)}
                                className={`flex items-center gap-2 py-4 px-1 border-b-2 font-medium text-sm transition-colors ${
                                    data.activeTab === tab.id
                                        ? "border-[var(--color-brand-blue)] text-[var(--color-brand-blue)]"
                                        : "border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300"
                                }`}
                            >
                                <Icon className="w-4 h-4" />
                                {tab.label}
                            </button>
                        );
                    })}
                </nav>
            </div>

            <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
                {data.activeTab === "dashboard" && (
                    <MCSMDashboardTab overview={data.overview} fetchOverview={data.fetchOverview} />
                )}
                {data.activeTab === "instances" && (
                    <MCSMInstancesTab
                        instances={data.instances}
                        fetchAllInstances={data.fetchAllInstances}
                        handleInstanceAction={data.handleInstanceAction}
                        actionLoading={data.actionLoading}
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
            </div>
        </div>
    );
}