import { createMCSMClient } from "../lib/mcsmClient";
import { useState, useEffect, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import pb from "../lib/pocketbase";
import { useUIFeedback } from "./useUIFeedback";
import { createAppLogger } from "../lib/appLogger";

const logger = createAppLogger("useMCSMData");
const mcsm = createMCSMClient({ token: () => pb.authStore.token });
const mcsmGet = (path, params) => mcsm(path, { params });
const mcsmPost = (path, body, params) => mcsm(path, { method: "POST", body, params });
const mcsmPut = (path, body, params) => mcsm(path, { method: "PUT", body, params });
const mcsmDelete = (path, body) => mcsm(path, { method: "DELETE", body });

export default function useMCSMData() {
    const { t } = useTranslation();
    const { notify, confirm } = useUIFeedback();
    const [activeTab, setActiveTab] = useState("dashboard");
    const [config, setConfig] = useState(null);
    const [configId, setConfigId] = useState(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [overview, setOverview] = useState(null);
    const [instances, setInstances] = useState([]);
    const [selectedInstance, setSelectedInstance] = useState(null);
    const [consoleLog, setConsoleLog] = useState("");
    const [commandInput, setCommandInput] = useState("");
    const [sendingCommand, setSendingCommand] = useState(false);
    const [actionLoading, setActionLoading] = useState({});
    const [files, setFiles] = useState([]);
    const [currentPath, setCurrentPath] = useState("/");
    const [filesLoading, setFilesLoading] = useState(false);
    const [testingConnection, setTestingConnection] = useState(false);
    const consoleTimerRef = useRef(null);

    const fetchConfig = useCallback(async () => {
        setLoading(true);
        try {
            const list = await pb.collection("mcsm_config").getList(1, 1);
            if (list.items.length > 0) {
                setConfig(list.items[0]);
                setConfigId(list.items[0].id);
            }
        } catch (err) {
            logger.error(err);
            notify(t("admin.mcsm.error.loadFailed"), "error");
        } finally {
            setLoading(false);
        }
    }, [t, notify]);

    useEffect(() => { fetchConfig(); }, [fetchConfig]);

    const saveDisplayConfig = useCallback(async (updated) => {
        try {
            await pb.collection("mcsm_config").update(configId, updated);
            setConfig(updated);
            notify(t("admin.mcsm.settings.saveSuccess"), "success");
        } catch (err) {
            logger.error(err);
            notify(t("admin.mcsm.settings.saveError"), "error");
        }
    }, [configId, t, notify]);

    const handleSaveConfig = useCallback(async () => {
        if (!configId) return;
        setSaving(true);
        await saveDisplayConfig(config);
        setSaving(false);
    }, [configId, config, saveDisplayConfig]);

    const handleTestConnection = useCallback(async () => {
        setTestingConnection(true);
        try {
            const data = await mcsmGet("/admin/overview");
            if (!data.data || typeof data.data !== "object") throw new Error("Invalid overview");
            notify(t("admin.mcsm.settings.testSuccess"), "success");
        } catch (err) {
            logger.error(err);
            notify(t("admin.mcsm.settings.testFailed"), "error");
        } finally {
            setTestingConnection(false);
        }
    }, [t, notify]);

    const fetchOverview = useCallback(async () => {
        try {
            const data = await mcsmGet("/admin/overview");
            if (data?.data) setOverview(data.data);
        } catch (err) {
            logger.error(err);
        }
    }, []);

    const fetchAllInstances = useCallback(async () => {
        try {
            // /admin/instances now returns all nodes with their instances via remote_services
            const data = await mcsmGet("/admin/instances");
            setInstances((data.data || []).flatMap(node => (node.instances || []).map(inst => ({
                ...inst, daemonId: node.uuid, nodeName: node.remarks || node.uuid,
            }))));
        } catch (err) {
            logger.error(err);
        }
    }, []);

    const fetchInstances = fetchAllInstances;

    const handleInstanceAction = useCallback(async (action, uuid, daemonId) => {
        if (action === "kill") {
            const ok = await confirm({ message: t("admin.mcsm.instances.confirmKill"), danger: true });
            if (!ok) return;
        }
        setActionLoading((prev) => ({ ...prev, [`${uuid}_${action}`]: true }));
        try {
            await mcsmPost(`/admin/instance/${action}`, {}, { uuid, daemonId });
            notify(t("admin.mcsm.instances.actionSuccess", { action }), "success");
        } catch (err) {
            logger.error(err);
            notify(t("admin.mcsm.instances.actionError", { action }), "error");
        } finally {
            setActionLoading((prev) => ({ ...prev, [`${uuid}_${action}`]: false }));
        }
    }, [t, notify, confirm]);

    const fetchOutputLog = useCallback(async (uuid, daemonId) => {
        try {
            const data = await mcsmGet("/admin/instance/outputlog", { uuid, daemonId });
            if (data?.data) setConsoleLog(data.data);
        } catch (err) {
            logger.error(err);
        }
    }, []);

    const startConsolePolling = useCallback((uuid, daemonId) => {
        if (consoleTimerRef.current) clearInterval(consoleTimerRef.current);
        fetchOutputLog(uuid, daemonId);
        consoleTimerRef.current = setInterval(() => fetchOutputLog(uuid, daemonId), 3000);
    }, [fetchOutputLog]);

    const stopConsolePolling = useCallback(() => {
        if (consoleTimerRef.current) {
            clearInterval(consoleTimerRef.current);
            consoleTimerRef.current = null;
        }
    }, []);

    useEffect(() => () => stopConsolePolling(), [stopConsolePolling]);

    const handleSendCommand = useCallback(async (uuid, daemonId) => {
        if (!commandInput.trim()) return;
        setSendingCommand(true);
        try {
            await mcsmPost("/admin/instance/command", { command: commandInput }, { uuid, daemonId });
            setCommandInput("");
        } catch (err) {
            logger.error(err);
            notify(t("admin.mcsm.console.sendError"), "error");
        } finally {
            setSendingCommand(false);
        }
    }, [commandInput, t, notify]);

    const fetchFiles = useCallback(async (uuid, daemonId, target = "/") => {
        setFilesLoading(true);
        try {
            const data = await mcsmGet("/admin/files/list", { uuid, daemonId, target });
            if (data?.data) {
                setFiles(data.data.items || data.data || []);
                setCurrentPath(target);
            }
        } catch (err) {
            logger.error(err);
            notify(t("admin.mcsm.files.listError"), "error");
        } finally {
            setFilesLoading(false);
        }
    }, [t, notify]);

    const readFile = useCallback(async (uuid, daemonId, target) => {
        const data = await mcsmPut("/admin/files/read", { uuid, daemonId, target });
        if (typeof data?.data !== "string") throw new Error("Invalid file response");
        return data.data;
    }, []);

    const writeFile = useCallback(async (uuid, daemonId, target, content) => {
        try {
            await mcsmPut("/admin/files/write", { uuid, daemonId, target, content });
            notify(t("admin.mcsm.files.saveSuccess"), "success");
        } catch (error) {
            notify(t("admin.mcsm.settings.saveError"), "error");
            throw error;
        }
    }, [t, notify]);

    const createDir = useCallback(async (uuid, daemonId, target) => {
        await mcsmPost("/admin/files/mkdir", { uuid, daemonId, target });
    }, []);

    const createFile = useCallback(async (uuid, daemonId, target) => {
        await mcsmPost("/admin/files/touch", { uuid, daemonId, target });
    }, []);

    const deleteFiles = useCallback(async (uuid, daemonId, targets) => {
        const ok = await confirm({ message: t("admin.mcsm.files.confirmDelete"), danger: true });
        if (!ok) return;
        await mcsmDelete("/admin/files", { uuid, daemonId, targets });
    }, [t, confirm]);

    const moveFile = useCallback(async (uuid, daemonId, targets) => {
        await mcsmPut("/admin/files/move", { uuid, daemonId, targets });
    }, []);

    const handleToggleHide = useCallback(async (instanceUuid) => {
        if (!configId || !config) return;
        const hidden = Array.isArray(config.hidden_instances) ? [...config.hidden_instances] : [];
        const idx = hidden.indexOf(instanceUuid);
        if (idx >= 0) hidden.splice(idx, 1);
        else hidden.push(instanceUuid);
        await saveDisplayConfig({ ...config, hidden_instances: hidden });
    }, [configId, config, saveDisplayConfig]);

    const handleRenameInstance = useCallback(async (instanceUuid, newName) => {
        if (!configId || !config) return;
        const labels = { ...(config.instance_labels || {}) };
        if (newName) labels[instanceUuid] = newName;
        else delete labels[instanceUuid];
        await saveDisplayConfig({ ...config, instance_labels: labels });
    }, [configId, config, saveDisplayConfig]);

    return {
        activeTab, setActiveTab,
        config, setConfig, configId,
        loading, saving, overview, instances,
        selectedInstance, setSelectedInstance,
        consoleLog, commandInput, setCommandInput, sendingCommand,
        actionLoading, files, currentPath, filesLoading, testingConnection,
        fetchConfig, handleSaveConfig, handleTestConnection,
        fetchOverview, fetchInstances, fetchAllInstances, handleInstanceAction,
        startConsolePolling, stopConsolePolling, handleSendCommand,
        fetchFiles, readFile, writeFile, createDir, createFile, deleteFiles, moveFile,
        handleToggleHide, handleRenameInstance,
    };
}
