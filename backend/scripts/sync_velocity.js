import { createVelocityPocketBase } from './lib/velocity-pocketbase.js';
import { runVelocitySync, createVelocityFiles } from "./lib/velocity-sync.js";
import PocketBase from 'pocketbase';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { exec, execFile } from 'child_process';
import { promisify } from 'util';
import net from 'net';
import { createLogger, maskEmail } from './logger.js';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

// Configuration
const PB_URL = process.env.PB_URL || "http://127.0.0.1:8090";
const PB_ADMIN_EMAIL = process.env.PB_EMAIL?.trim();
const PB_ADMIN_PASS = process.env.PB_PASS?.trim();
const VELOCITY_DIR = process.env.VELOCITY_DIR || "/opt/velocity";
const VELOCITY_SERVICE = "velocity";
const VELOCITY_OWNER = process.env.VELOCITY_OWNER || "ubuntu:ubuntu";
const JAR_REF_MARKER = ".velocity_jar_ref";
const DEPLOYMENT_GUARD = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../.velocity-maintenance');

// EventSource required for Realtime in Node environment
import { EventSource } from 'eventsource';
global.EventSource = EventSource;

const pb = new PocketBase(PB_URL);
pb.autoCancellation(false); // Disable auto-cancellation for long running process

const data = createVelocityPocketBase({ pb, email: PB_ADMIN_EMAIL, password: PB_ADMIN_PASS });

const logger = createLogger("VelocitySync", { levelEnv: "VELOCITY_SYNC_LOG_LEVEL" });
const logInfo = (...args) => logger.info(...args);
const logError = (...args) => logger.error(...args);

// State
let currentSettings = null;
let syncQueue = Promise.resolve({ configChanged: false, jarChanged: false, appliedHash: "" });
let lastReportedProxyStatus = null;
let pendingJarVersion = null;

async function main() {
    logInfo(`[Sync] Starting Velocity Sync Daemon...`);
    logInfo(`[Sync] Connecting to ${PB_URL}...`);
    logInfo(`[Sync] Log level: ${logger.level}`);

    if (!PB_ADMIN_EMAIL || !PB_ADMIN_PASS) {
        logError("[Sync] Missing required env: PB_EMAIL and PB_PASS must be provided.");
        process.exit(1);
    }

    try {
        await data.authorize();
        logInfo(`[Sync] Authenticated as ${maskEmail(PB_ADMIN_EMAIL)}`);
    } catch (err) {
        logError("Failed to authenticate:", err.message);
        process.exit(1);
    }

    // Initial fetch + sync + optional restart
    await queueSync({ reason: "initial startup", restartIfChanged: true });

    // Subscribe to Settings Changes (Restart Trigger & Config Updates)
    await data.subscribe({ onError: error => logError('[Realtime] Authorization/action failed:', error.message), velocity_settings: async (e) => {
        // logInfo(`[Realtime] Settings update detected (${e.action})`);

        if (e.action === 'update') {
            const newSettings = e.record;

            // Settings never loaded (guarded start or failed initial read): the previous
            // restart_trigger is unknown, so run a normal sync that restarts only on a change.
            if (!currentSettings) {
                logInfo(`[Realtime] Config change detected before settings were loaded. Syncing without forced restart...`);
                await queueSync({ reason: "settings update", restartIfChanged: true, forceRestart: false });
                return;
            }

            const oldSettings = currentSettings;

            // Fields that affect configuration or require action
            const configFields = [
                'bind_port', 'motd', 'max_players', 'online_mode',
                'force_key_authentication', 'prevent_client_proxy_connections',
                'player_info_forwarding_mode', 'forwarding_secret', 'sample_players_in_ping',
                'enable_player_address_logging',
                'kick_existing_players', 'ping_passthrough', 'velocity_jar',
                'announce_forge', 'accepts_transfers', 'haproxy_protocol',
                'show_ping_requests', 'connection_timeout', 'read_timeout',
                'compression_threshold', 'compression_level', 'login_ratelimit',
                'bungee_plugin_message_channel', 'tcp_fast_open', 'expose_proxy_commands',
                'query_enabled', 'query_port', 'query_map', 'query_show_plugins',
                'failover_on_unexpected_server_disconnect', 'log_command_executions',
                'log_player_connections', 'enable_reuse_port', 'command_rate_limit',
                'forward_commands_if_rate_limited', 'kick_after_rate_limited_commands',
                'tab_complete_rate_limit', 'kick_after_rate_limited_tab_completes'
            ];

            const hasConfigChanged = configFields.some(field => oldSettings[field] !== newSettings[field]);
            const restartTriggered = newSettings.restart_trigger && newSettings.restart_trigger !== oldSettings.restart_trigger;

            // Only sync if config actually changed or restart requested
            // This prevents infinite loop caused by monitorProxyStatus updating 'proxy_status'
            if (hasConfigChanged || restartTriggered) {
                logInfo(`[Realtime] Config change detected. Syncing...`);
                await queueSync({
                    reason: "settings update",
                    restartIfChanged: true,
                    forceRestart: Boolean(restartTriggered)
                });
            } else {
                // Just update local state silently if it was just a status update
                currentSettings = newSettings;
            }
        }
    },

    // Subscribe to Server Changes (Connectivity Check)
    velocity_servers: async (e) => {
        if (e.action === 'update' || e.action === 'create') {
            const server = e.record;
            if (server.status === 'pending') {
                logInfo(`[Ping] Check requested for ${server.name} (${server.address})...`);
                await checkServerStatus(server);
            }
        }
        if (e.action === 'update' || e.action === 'create' || e.action === 'delete') {
            await queueSync({ reason: `server ${e.action}`, restartIfChanged: true });
        }
    },

    // Subscribe to Forced Hosts Changes
    velocity_forced_hosts: async (e) => {
        if (e.action === 'create' || e.action === 'update' || e.action === 'delete') {
            logInfo(`[Realtime] Forced Host change detected (${e.action}). Syncing...`);
            await queueSync({ reason: `forced-host ${e.action}`, restartIfChanged: true });
        }
    } });

    // Start Monitoring
    monitorProxyStatus();

    logInfo("[Sync] Watching for changes...");

    // Keep process alive
    process.stdin.resume();
}

const runtimeFiles = createVelocityFiles({ fs, directory: VELOCITY_DIR, join: path.join, ownership: ensureOwnership });

async function queueSync({ reason = "manual", restartIfChanged = false, forceRestart = false } = {}) {
    syncQueue = syncQueue.catch(() => {}).then(() => runVelocitySync({
        isProtected: () => pathExists(DEPLOYMENT_GUARD),
        read: async () => {
            pendingJarVersion = null;
            const input = await data.read();
            currentSettings = input.settings;
            return input;
        },
        snapshot: runtimeFiles.snapshot,
        restore: runtimeFiles.restore,
        discard: runtimeFiles.discard,
        applyConfig: runtimeFiles.applyConfig,
        applyJar: async settings => {
            const changed = await syncJarIfNeeded(settings);
            const jarPath = path.join(VELOCITY_DIR, 'velocity.jar');
            if (await pathExists(jarPath)) {
                const { stdout } = await execFileAsync('unzip', ['-p', jarPath, 'META-INF/MANIFEST.MF']);
                pendingJarVersion = stdout.match(/^Implementation-Version:\s*(.+)$/m)?.[1]?.trim() || null;
            }
            return changed;
        },
        applySecret: runtimeFiles.applySecret,
        restart: restartService,
        report: updateSyncMeta,
    }, { restartIfChanged, forceRestart }));
    try {
        const result = await syncQueue;
        if (result?.snapshotRetained) logError(`[Sync] Synced (${reason}), but .bak snapshots were retained:`, result.snapshotRetained);
        return result;
    }
    catch (error) { logError(`[Sync] Failed (${reason}):`, error.message); return { status: "failed", stage: error.stage, error: error.message }; }
}

async function monitorProxyStatus() {
    logInfo("[Monitor] Starting proxy status monitoring...");
    await updateProxyStatusOnce();

    // Check status every 15 seconds
    setInterval(async () => {
        await updateProxyStatusOnce();
    }, 15000);
}

async function updateProxyStatusOnce() {
    if (!currentSettings) {
        logInfo("[Monitor] Waiting for settings to be loaded...");
        return;
    }

    try { await data.authorize(); } catch (error) { logError('[Monitor] Authorization failed:', error.message); return; }
    let status;
    try {
        const { stdout } = await execAsync(`systemctl is-active ${VELOCITY_SERVICE}`);
        status = stdout.trim();
    } catch (err) {
        if (err.stdout) status = err.stdout.trim();
        else status = "error";
    }

    try {
        const payload = {
            proxy_status: status,
            last_heartbeat: new Date().toISOString()
        };
        await data.update('velocity_settings', currentSettings.id, payload);
        currentSettings = { ...currentSettings, ...payload };
        if (status !== lastReportedProxyStatus) {
            logInfo(`[Monitor] Proxy status => ${status}`);
            lastReportedProxyStatus = status;
        }
    } catch (e) {
        logError("[Monitor] Failed to update status:", e.message);
    }
}

async function restartService() {
    logInfo("[Sync] Restarting Velocity service...");
    try {
        await execAsync(`systemctl restart ${VELOCITY_SERVICE}`);
        logInfo("[Sync] Service restarted successfully.");
    } catch (err) {
        logError("Failed to restart service:", err.message);
        throw err;
    }
}

async function syncJarIfNeeded(settings) {
    const jarField = Array.isArray(settings.velocity_jar) ? settings.velocity_jar[0] : settings.velocity_jar;
    if (!jarField) return false;

    const jarPath = path.join(VELOCITY_DIR, 'velocity.jar');
    const markerPath = path.join(VELOCITY_DIR, JAR_REF_MARKER);
    const jarRef = `${settings.id}:${jarField}`;

    let markerRef;
    try {
        markerRef = (await fs.readFile(markerPath, "utf8")).trim();
    } catch (e) {
        if (e.code !== "ENOENT") throw e;
        markerRef = "";
    }

    if (markerRef === jarRef && await pathExists(jarPath)) {
        return false;
    }

    const jarUrl = pb.files.getURL(settings, jarField);
    const headers = pb.authStore.token ? { Authorization: `Bearer ${pb.authStore.token}` } : {};
    const res = await fetch(jarUrl, { headers, signal: AbortSignal.timeout(30000) });
    if (!res.ok) {
        throw new Error(`download failed with status ${res.status}`);
    }

    const fileBuffer = Buffer.from(await res.arrayBuffer());
    if (fileBuffer.length < 4 || fileBuffer[0] !== 0x50 || fileBuffer[1] !== 0x4b) {
        throw new Error("downloaded file is not a valid JAR/ZIP payload");
    }

    const tmpPath = `${jarPath}.tmp`;
    await fs.writeFile(tmpPath, fileBuffer);
    await ensureOwnership(tmpPath);
    await fs.rename(tmpPath, jarPath);
    await fs.writeFile(`${markerPath}.tmp`, `${jarRef}\n`);
    await ensureOwnership(`${markerPath}.tmp`);
    await fs.rename(`${markerPath}.tmp`, markerPath);

    logInfo("[Sync] velocity.jar updated from PocketBase file.");
    return true;
}

async function ensureOwnership(filePath) {
    try {
        await execAsync(`chown ${VELOCITY_OWNER} "${filePath}"`);
    } catch (e) {
        throw new Error(`Failed to chown ${filePath}: ${e.message}`, { cause: e });
    }
}

async function updateSyncMeta(status, errorMessage = "", appliedHash) {
    if (!currentSettings?.id) return;

    const payload = {
        last_sync_status: status,
        last_sync_error: (errorMessage || "").slice(0, 1000),
        last_sync_at: new Date().toISOString(),
        ...(status === "ok" ? { last_applied_hash: appliedHash, ...(pendingJarVersion ? { jar_version: pendingJarVersion } : {}) } : {}),
    };

    try {
        await data.update('velocity_settings', currentSettings.id, payload);
        currentSettings = { ...currentSettings, ...payload };
    } catch (e) {
        throw new Error(`Failed to update sync metadata: ${e.message}`, { cause: e });
    }
}

async function pathExists(filePath) {
    try {
        await fs.access(filePath);
        return true;
    } catch (e) {
        if (e.code !== "ENOENT") throw e;
        return false;
    }
}

async function checkServerStatus(server) {
    await data.authorize();
    const [host, portStr] = server.address.split(':');
    const port = parseInt(portStr) || 25565;

    const start = Date.now();
    try {
        await tcpPing(host, port);
        const latency = Date.now() - start;

        await data.update('velocity_servers', server.id, {
            status: 'online',
            ping: latency,
            last_check: new Date().toISOString()
        });
        logInfo(`[Ping] ${server.name} is ONLINE (${latency}ms)`);
    } catch (err) {
        await data.update('velocity_servers', server.id, {
            status: 'offline',
            ping: 0,
            last_check: new Date().toISOString()
        });
        logInfo(`[Ping] ${server.name} is OFFLINE (${err.message})`);
    }
}

function tcpPing(host, port) {
    return new Promise((resolve, reject) => {
        const socket = new net.Socket();
        const timeout = 2000;

        socket.setTimeout(timeout);

        socket.on('connect', () => {
            socket.destroy();
            resolve();
        });

        socket.on('timeout', () => {
            socket.destroy();
            reject(new Error('Timeout'));
        });

        socket.on('error', (err) => {
            socket.destroy();
            reject(err);
        });

        socket.connect(port, host);
    });
}



main().catch((err) => {
    logError("[Sync] Fatal error:", err?.stack || err?.message || err);
    process.exit(1);
});
