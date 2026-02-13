import { useState, useEffect, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import pb from "../lib/pocketbase";
import { useUIFeedback } from "./useUIFeedback";
import { createAppLogger } from "../lib/appLogger";

const logger = createAppLogger("useMCSMData");
const MCSM_API = "/mcsm-api";

function authHeaders() {
    return { Authorization: pb.authStore.token };
}

async function mcsmGet(path, params = {}) {
    const url = new URL(`${MCSM_API}${path}`, window.location.origin);
    for (const [k, v] of Object.entries(params)) {
        if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
    const res = await fetch(url.toString(), { headers: authHeaders() });
    return res.json();
}

async function mcsmPost(path, body = {}, params = {}) {
    const url = new URL(`${MCSM_API}${path}`, window.location.origin);
    for (const [k, v] of Object.entries(params)) {
        if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
    const res = await fetch(url.toString(), {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
    return res.json();
}

async function mcsmPut(path, body = {}, params = {}) {
    const url = new URL(`${MCSM_API}${path}`, window.location.origin);
    for (const [k, v] of Object.entries(params)) {
        if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
    const res = await fetch(url.toString(), {
        method: "PUT",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
    return res.json();
}

async function mcsmDelete(path, body = {}) {
    const url = new URL(`${MCSM_API}${path}`, window.location.origin);
    const res = await fetch(url.toString(), {
        method: "DELETE",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
    return res.json();
}

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
            logger.error("Failed to fetch MCSM config:", err);
            notify(t("admin.mcsm.error.loadFailed"), "error");
        } finally {
            setLoading(false);
        }
    }, [t, notify]);

    useEffect(() => { fetchConfig(); }, [fetchConfig]);

    const handleSaveConfig = useCallback(async () => {
        if (!configId) return;
        setSaving(true);
        try {
            await pb.collection("mcsm_config").update(configId, config);
            notify(t("admin.mcsm.settings.saveSuccess"), "success");
        } catch (err) {
            logger.error("Failed to save config:", err);
            notify(t("admin.mcsm.settings.saveError"), "error");
        } finally {
            setSaving(false);
        }
    }, [configId, config, t, notify]);

    const handleTestConnection = useCallback(async () => {
        setTestingConnection(true);
        try {
            const data = await mcsmGet("/admin/overview");
            if (data?.data) {
                notify(t("admin.mcsm.settings.testSuccess"), "success");
            } else {
                notify(t("admin.mcsm.settings.testFailed"), "error");
            }
        } catch (err) {
            logger.error("Test connection failed:", err);
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
            logger.error("Failed to fetch overview:", err);
        }
    }, []);

    const fetchInstances = useCallback(async () => {
        try {
            const data = await mcsmGet("/admin/instances");
            const nodes = Array.isArray(data?.data) ? data.data : [];
            const all = [];
            for (const node of nodes) {
                for (const inst of node.instances || []) {
                    all.push({ ...inst, daemonId: node.uuid, nodeName: node.remarks || node.uuid });
                }
            }
            setInstances(all);
        } catch (err) {
            logger.error("Failed to fetch instances:", err);
        }
    }, []);

    const fetchAllInstances = useCallback(async () => {
        try {
            // /admin/instances now returns all nodes with their instances via remote_services
            const data = await mcsmGet("/admin/instances");
            const nodes = Array.isArray(data?.data) ? data.data : [];

            const all = [];
            for (const node of nodes) {
                for (const inst of node.instances || []) {
                    all.push({ ...inst, daemonId: node.uuid, nodeName: node.remarks || node.uuid });
                }
            }
            setInstances(all);
        } catch (err) {
            logger.error("Failed to fetch all instances:", err);
        }
    }, []);

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
            logger.error(`Instance ${action} failed:`, err);
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
            logger.error("Failed to fetch output log:", err);
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
            logger.error("Failed to send command:", err);
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
            logger.error("Failed to list files:", err);
            notify(t("admin.mcsm.files.listError"), "error");
        } finally {
            setFilesLoading(false);
        }
    }, [t, notify]);

    const readFile = useCallback(async (uuid, daemonId, target) => {
        const data = await mcsmPut("/admin/files/read", { uuid, daemonId, target });
        return data?.data ?? "";
    }, []);

    const writeFile = useCallback(async (uuid, daemonId, target, content) => {
        await mcsmPut("/admin/files/write", { uuid, daemonId, target, content });
        notify(t("admin.mcsm.files.saveSuccess"), "success");
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
    };
}
