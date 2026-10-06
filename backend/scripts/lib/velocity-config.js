import TOML from "@iarna/toml";
const FORWARDING_SECRET_FILENAME = "forwarding.secret";

export function generateToml(settings, servers, forcedHosts = []) {
    const toTomlString = (value) => JSON.stringify(`${value ?? ""}`).slice(1, -1).replace(/\u007f/g, "\\u007f");
    const asNumber = (value, fallback) => {
        const parsed = value === "" || value == null ? fallback : Number(value);
        return Number.isFinite(parsed) ? parsed : fallback;
    };
    const asBool = (value, fallback) => (typeof value === "boolean" ? value : fallback);

    let serversBlock = "";
    servers.forEach(srv => {
        serversBlock += `"${toTomlString(srv.name)}" = "${toTomlString(srv.address)}"\n`;
    });

    let tryServers = servers
        .filter(s => s.is_try_server)
        .sort((a, b) => a.try_order - b.try_order)
        .map(s => `"${toTomlString(s.name)}"`)
        .join(", ");

    if (!tryServers) {
        if (servers.length > 0) tryServers = `"${toTomlString(servers[0].name)}"`;
        else tryServers = "";
    }

    let forcedHostsBlock = "";
    forcedHosts.forEach(host => {
        const hostServers = Array.isArray(host.server)
            ? host.server
            : (host.server ? [host.server] : []);
        const targetServerNames = hostServers
            .map((id) => servers.find((s) => s.id === id))
            .filter(Boolean)
            .map((s) => `"${toTomlString(s.name)}"`);

        if (targetServerNames.length > 0) {
            forcedHostsBlock += `"${toTomlString(host.hostname)}" = [${targetServerNames.join(", ")}]\n`;
        }
    });

    // Modern Velocity 3.x TOML Structure (Flat)
    return `
# Velocity Configuration - Managed by PocketBase
# DO NOT EDIT MANUALLY
config-version = "2.7"
bind = "0.0.0.0:${toTomlString(settings.bind_port || 25577)}"
motd = "${toTomlString(settings.motd)}"
show-max-players = ${asNumber(settings.max_players, 500)}
online-mode = ${asBool(settings.online_mode, false)}
sample-players-in-ping = ${asBool(settings.sample_players_in_ping, true)}
enable-player-address-logging = ${asBool(settings.enable_player_address_logging, true)}
force-key-authentication = ${asBool(settings.force_key_authentication, false)}
prevent-client-proxy-connections = ${asBool(settings.prevent_client_proxy_connections, false)}
player-info-forwarding-mode = "${toTomlString(settings.player_info_forwarding_mode || 'modern')}"
forwarding-secret-file = "${FORWARDING_SECRET_FILENAME}"
announce-forge = ${asBool(settings.announce_forge, false)}
kick-existing-players = ${asBool(settings.kick_existing_players, false)}
ping-passthrough = "${toTomlString(settings.ping_passthrough || 'DISABLED')}"
accepts-transfers = ${asBool(settings.accepts_transfers, false)}

[servers]
${serversBlock}
try = [${tryServers}]

[forced-hosts]
${forcedHostsBlock}

[advanced]
compression-threshold = ${asNumber(settings.compression_threshold, 256)}
compression-level = ${asNumber(settings.compression_level, -1)}
login-ratelimit = ${asNumber(settings.login_ratelimit, 3000)}
connection-timeout = ${asNumber(settings.connection_timeout, 5000)}
read-timeout = ${asNumber(settings.read_timeout, 30000)}
failover-on-unexpected-server-disconnect = ${asBool(settings.failover_on_unexpected_server_disconnect, true)}
haproxy-protocol = ${asBool(settings.haproxy_protocol, false)}
tcp-fast-open = ${asBool(settings.tcp_fast_open, false)}
bungee-plugin-message-channel = ${asBool(settings.bungee_plugin_message_channel, true)}
show-ping-requests = ${asBool(settings.show_ping_requests, false)}
log-command-executions = ${asBool(settings.log_command_executions, false)}
log-player-connections = ${asBool(settings.log_player_connections, true)}
enable-reuse-port = ${asBool(settings.enable_reuse_port, false)}
announce-proxy-commands = ${asBool(settings.expose_proxy_commands, false)}
command-rate-limit = ${asNumber(settings.command_rate_limit, 0)}
forward-commands-if-rate-limited = ${asBool(settings.forward_commands_if_rate_limited, true)}
kick-after-rate-limited-commands = ${asNumber(settings.kick_after_rate_limited_commands, 5)}
tab-complete-rate-limit = ${asNumber(settings.tab_complete_rate_limit, 0)}
kick-after-rate-limited-tab-completes = ${asNumber(settings.kick_after_rate_limited_tab_completes, 5)}

[query]
enabled = ${asBool(settings.query_enabled, false)}
port = ${asNumber(settings.query_port, 25577)}
map = "${toTomlString(settings.query_map || 'Velocity')}"
show-plugins = ${asBool(settings.query_show_plugins, false)}
`;
}

export function prepareVelocityConfig(settings, servers, forcedHosts = []) {
  if (!settings || !Array.isArray(servers) || !Array.isArray(forcedHosts)) throw new Error("Invalid Velocity input");
  const names = new Set();
  for (const server of servers) {
    if (!server.name || server.name === "try" || names.has(server.name) || !/^.+:\d+$/.test(server.address || "")) throw new Error("Invalid or duplicate Velocity server");
    const port = Number(server.address.match(/:(\d+)$/)?.[1]);
    if (port < 1 || port > 65535) throw new Error("Invalid server port");
    names.add(server.name);
  }
  for (const host of forcedHosts) {
    const targets = Array.isArray(host.server) ? host.server : [host.server];
    if (!host.hostname || !targets.length || targets.some(id => !servers.some(server => server.id === id))) throw new Error("Invalid forced host target");
  }
  for (const [field, min, max] of [["bind_port", 1, 65535], ["query_port", 1, 65535], ["max_players", 0, 2147483647], ["compression_level", -1, 9], ["compression_threshold", -1, 2147483647], ["login_ratelimit", 0, 2147483647], ["connection_timeout", 0, 2147483647], ["read_timeout", 0, 2147483647], ["command_rate_limit", 0, 2147483647], ["kick_after_rate_limited_commands", 0, 2147483647], ["tab_complete_rate_limit", 0, 2147483647], ["kick_after_rate_limited_tab_completes", 0, 2147483647]]) {
    if (settings[field] != null && settings[field] !== "" && (!Number.isInteger(Number(settings[field])) || Number(settings[field]) < min || Number(settings[field]) > max)) throw new Error(`Invalid ${field}`);
  }
  if (!["none", "legacy", "bungeeguard", "modern"].includes(settings.player_info_forwarding_mode || "modern")) throw new Error("Invalid forwarding mode");
  if (!["DISABLED", "MODS", "DESCRIPTION", "ALL"].includes(settings.ping_passthrough || "DISABLED")) throw new Error("Invalid ping passthrough");
  const secret = String(settings.forwarding_secret || "").trim();
  if (!secret || Array.from(secret).some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) throw new Error("Invalid forwarding secret");
  const content = generateToml(settings, servers, forcedHosts);
  const parsed = TOML.parse(content);
  if (parsed.motd !== String(settings.motd ?? "")) throw new Error("MOTD roundtrip failed");
  return { content, secret, parsed };
}
