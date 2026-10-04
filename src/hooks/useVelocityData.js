import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import pb from "../lib/pocketbase";
import { useUIFeedback } from "./useUIFeedback";
import { createAppLogger } from "../lib/appLogger";

const logger = createAppLogger("useVelocityData");
const freshServerDraft = () => ({ name: "", address: "", try_order: 1, is_try_server: false });

export default function useVelocityData() {
    const { t } = useTranslation();
    const { notify, confirm } = useUIFeedback();
    const [activeTab, setActiveTab] = useState("dashboard");
    const [settings, setSettings] = useState(null);
    const [servers, setServers] = useState([]);
    const [forcedHosts, setForcedHosts] = useState([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [restarting, setRestarting] = useState(false);
    const [testingMap, setTestingMap] = useState({});
    const [newServer, setNewServer] = useState(freshServerDraft);
    const [editingServer, setEditingServer] = useState(null);
    const [isServerModalOpen, setIsServerModalOpen] = useState(false);
    const [newForcedHost, setNewForcedHost] = useState({ hostname: "", server: [] });
    const [settingsId, setSettingsId] = useState(null);

    const isMissingCollectionError = useCallback((err, collectionName) => {
        const status = err?.status;
        const message = `${err?.message || ""}`.toLowerCase();
        return status === 404 && message.includes("missing collection context") && message.includes(collectionName);
    }, []);

    const fetchData = useCallback(async () => {
        setLoading(true);
        try {
            const settingsList = await pb.collection("velocity_settings").getList(1, 1);
            if (settingsList.items.length > 0) {
                setSettings(settingsList.items[0]);
                setSettingsId(settingsList.items[0].id);
            }
            const serversList = await pb.collection("velocity_servers").getFullList({ sort: "try_order" });
            setServers(serversList || []);
            try {
                const forcedHostsList = await pb.collection("velocity_forced_hosts").getFullList({ sort: "hostname" });
                setForcedHosts(forcedHostsList || []);
            } catch (err) {
                if (isMissingCollectionError(err, "velocity_forced_hosts")) {
                    logger.warn("Collection velocity_forced_hosts is missing. Falling back to empty list.");
                    setForcedHosts([]);
                } else {
                    throw err;
                }
            }
        } catch (err) {
            logger.error("Failed to fetch Velocity data:", err);
            notify(t("admin.dashboard.error.loadFailed"), "error");
        } finally {
            setLoading(false);
        }
    }, [t, isMissingCollectionError, notify]);

    useEffect(() => {
        fetchData();

        pb.collection('velocity_settings').subscribe('*', (e) => {
            if (e.action === "update") {
                setSettings(e.record);
                if (!e.record.restart_trigger) {
                    setRestarting(false);
                }
            }
        });

        pb.collection('velocity_servers').subscribe('*', (e) => {
            if (e.action === "update") {
                setServers(prev => prev.map(s => s.id === e.record.id ? e.record : s));
                if (e.record.status !== 'pending') {
                    setTestingMap(prev => ({ ...prev, [e.record.id]: false }));
                }
            } else {
                pb.collection("velocity_servers").getFullList({ sort: "try_order" }).then(res => setServers(res));
            }
        });

        return () => {
            pb.collection("velocity_settings").unsubscribe();
            pb.collection("velocity_servers").unsubscribe();
        };
    }, [fetchData]);

    useEffect(() => {
        if (!settingsId) return;

        const refreshRuntimeStatus = async () => {
            try {
                const latest = await pb.collection("velocity_settings").getOne(settingsId);

                setSettings((prev) => {
                    if (!prev || prev.id !== latest.id) return prev;
                    return {
                        ...prev,
                        proxy_status: latest.proxy_status,
                        last_heartbeat: latest.last_heartbeat,
                        last_sync_status: latest.last_sync_status,
                        last_sync_error: latest.last_sync_error,
                        last_sync_at: latest.last_sync_at,
                        last_applied_hash: latest.last_applied_hash,
                    };
                });
            } catch (err) {
                logger.warn("Failed to refresh runtime status:", err?.message || err);
            }
        };

        refreshRuntimeStatus();
        const timer = setInterval(refreshRuntimeStatus, 10000);
        return () => clearInterval(timer);
    }, [settingsId]);

    const handleAddServer = () => {
        setEditingServer(null);
        setNewServer(freshServerDraft());
        setIsServerModalOpen(true);
    };

    const handleEditServer = (server) => {
        setEditingServer(server);
        setNewServer({
            name: server.name,
            address: server.address,
            try_order: server.try_order,
            is_try_server: server.is_try_server,
        });
        setIsServerModalOpen(true);
    };

    const handleDeleteServer = async (id) => {
        if (!(await confirm({ message: t("admin.velocity.modal.deleteConfirm"), danger: true }))) return;
        try {
            await pb.collection('velocity_servers').delete(id);
        } catch (err) {
            logger.error(err);
            notify(t("admin.velocity.actions.deleteServerError"), "error");
        }
    };

    const handleSaveServer = async () => {
        if (saving || !newServer.name.trim() || !newServer.address.trim() || !Number.isInteger(Number(newServer.try_order)) || Number(newServer.try_order) < 1) return;
        setSaving(true);
        try {
            const payload = { ...newServer, try_order: Number(newServer.try_order) };
            if (editingServer) {
                await pb.collection('velocity_servers').update(editingServer.id, payload);
            } else {
                await pb.collection('velocity_servers').create(payload);
            }
            setIsServerModalOpen(false);
            setEditingServer(null);
            setNewServer(freshServerDraft());
        } catch (err) {
            logger.error(err);
            notify(t("admin.velocity.actions.addServerError"), "error");
        } finally {
            setSaving(false);
        }
    };

    const handleSaveSettings = async () => {
        if (!settingsId) return;
        setSaving(true);
        try {
            await pb.collection("velocity_settings").update(settingsId, settings);
            notify(t("admin.velocity.settings.success"), "success");
        } catch (err) {
            logger.error("Failed to save settings:", err);
            notify(t("admin.velocity.settings.error"), "error");
        } finally {
            setSaving(false);
        }
    };

    const handleRestartProxy = async () => {
        if (!settingsId) return;
        if (!(await confirm({ message: t("admin.velocity.actions.confirmRestart"), danger: true }))) return;
        setRestarting(true);
        try {
            await pb.collection("velocity_settings").update(settingsId, {
                restart_trigger: new Date().toISOString(),
            });
        } catch (err) {
            logger.error("Failed to restart:", err);
            setRestarting(false);
            notify(t("admin.velocity.actions.restartError"), "error");
        }
    };

    const handleTestConnection = async (serverId) => {
        setTestingMap(prev => ({ ...prev, [serverId]: true }));
        try {
            await pb.collection("velocity_servers").update(serverId, { status: "pending" });
        } catch (err) {
            logger.error("Failed to trigger test:", err);
            setTestingMap(prev => ({ ...prev, [serverId]: false }));
        }
    };

    const handleAddForcedHost = async () => {
        if (!newForcedHost.hostname || !Array.isArray(newForcedHost.server) || newForcedHost.server.length === 0) return;
        try {
            const serverValue = newForcedHost.server.length === 1 ? newForcedHost.server[0] : newForcedHost.server;
            await pb.collection("velocity_forced_hosts").create({
                hostname: newForcedHost.hostname.trim(),
                server: serverValue,
            });
            setNewForcedHost({ hostname: "", server: [] });
            const list = await pb.collection("velocity_forced_hosts").getFullList({ sort: "hostname" });
            setForcedHosts(list);
        } catch (err) {
            logger.error(err);
            notify(t("admin.velocity.actions.addError"), "error");
        }
    };

    const handleDeleteForcedHost = async (id) => {
        if (!(await confirm({ message: t("admin.velocity.actions.confirmDelete"), danger: true }))) return;
        try {
            await pb.collection("velocity_forced_hosts").delete(id);
            setForcedHosts(prev => prev.filter(h => h.id !== id));
        } catch (err) {
            logger.error(err);
            notify(t("admin.velocity.actions.deleteError"), "error");
        }
    };

    const handleFileUpload = async (e) => {
        const file = e.target.files[0];
        if (!file || !settingsId) return;
        setUploading(true);
        try {
            const formData = new FormData();
            formData.append("velocity_jar", file);
            formData.append("jar_version", file.name);
            await pb.collection("velocity_settings").update(settingsId, formData);
            notify(t("admin.velocity.update.success"), "success");
            fetchData();
        } catch (err) {
            logger.error("Upload failed:", err);
            notify(t("admin.velocity.update.error"), "error");
        } finally {
            setUploading(false);
        }
    };

    return {
        activeTab, setActiveTab,
        settings, setSettings,
        servers, forcedHosts,
        loading, saving, uploading, restarting,
        testingMap,
        newServer, setNewServer,
        editingServer,
        isServerModalOpen, setIsServerModalOpen,
        newForcedHost, setNewForcedHost,
        fetchData,
        handleAddServer, handleEditServer, handleDeleteServer, handleSaveServer,
        handleSaveSettings, handleRestartProxy, handleTestConnection,
        handleAddForcedHost, handleDeleteForcedHost, handleFileUpload,
    };
}
