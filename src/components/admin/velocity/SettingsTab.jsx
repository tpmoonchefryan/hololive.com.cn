import { RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import ContentFieldLabel from "../content/ContentFieldLabel";
import ContentTextInput from "../content/ContentTextInput";
import ContentTextareaInput from "../content/ContentTextareaInput";
import ContentSelectInput from "../content/ContentSelectInput";
import ContentCheckboxInput from "../content/ContentCheckboxInput";
import ContentPrimaryButton from "../content/ContentPrimaryButton";

function CheckboxField({ id, checked, onChange, label, hint }) {
  return (
    <div className="flex items-start gap-3">
      <ContentCheckboxInput
        id={id}
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-1 w-4 h-4"
      />
      <div>
        <label htmlFor={id} className="block text-sm font-medium text-slate-700">
          {label}
        </label>
        {hint ? <p className="text-xs text-slate-400">{hint}</p> : null}
      </div>
    </div>
  );
}

function NumberField({ label, value, onChange, hint, min, className = "" }) {
  return (
    <div>
      <ContentFieldLabel className="mb-1">{label}</ContentFieldLabel>
      <ContentTextInput
        type="number"
        value={value}
        onChange={onChange}
        min={min}
        className={`text-sm ${className}`.trim()}
      />
      {hint ? <p className="mt-1 text-xs text-slate-400">{hint}</p> : null}
    </div>
  );
}

function TextField({ label, value, onChange, hint, placeholder, className = "", type = "text" }) {
  return (
    <div>
      <ContentFieldLabel className="mb-1">{label}</ContentFieldLabel>
      <ContentTextInput
        type={type}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        className={className}
      />
      {hint ? <p className="mt-1 text-xs text-slate-400">{hint}</p> : null}
    </div>
  );
}

function AdvancedSettings({ settings, setSettings, t }) {
  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
        <NumberField
          label={t("admin.velocity.settings.connectionTimeout")}
          value={settings.connection_timeout || 5000}
          onChange={(e) =>
            setSettings({
              ...settings,
              connection_timeout: parseInt(e.target.value, 10) || 5000,
            })
          }
          hint={t("admin.velocity.settings.connectionTimeoutHint")}
        />
        <NumberField
          label={t("admin.velocity.settings.readTimeout")}
          value={settings.read_timeout || 30000}
          onChange={(e) =>
            setSettings({
              ...settings,
              read_timeout: parseInt(e.target.value, 10) || 30000,
            })
          }
          hint={t("admin.velocity.settings.readTimeoutHint")}
        />
      </div>

      <h4 className="font-medium text-slate-800 mt-6 mb-3">
        {t("admin.velocity.settings.performanceSecurity")}
      </h4>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <NumberField
          label={t("admin.velocity.settings.compressionThreshold")}
          value={settings.compression_threshold !== undefined ? settings.compression_threshold : 256}
          onChange={(e) =>
            setSettings({
              ...settings,
              compression_threshold: parseInt(e.target.value, 10),
            })
          }
          hint={t("admin.velocity.settings.compressionThresholdHint")}
        />
        <NumberField
          label={t("admin.velocity.settings.compressionLevel")}
          value={settings.compression_level !== undefined ? settings.compression_level : -1}
          onChange={(e) =>
            setSettings({
              ...settings,
              compression_level: parseInt(e.target.value, 10),
            })
          }
          hint={t("admin.velocity.settings.compressionLevelHint")}
        />
        <NumberField
          label={t("admin.velocity.settings.loginRatelimit")}
          value={settings.login_ratelimit || 3000}
          onChange={(e) =>
            setSettings({
              ...settings,
              login_ratelimit: parseInt(e.target.value, 10) || 3000,
            })
          }
          hint={t("admin.velocity.settings.loginRatelimitHint")}
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-2">
        <CheckboxField
          id="tcp_fast_open"
          checked={settings.tcp_fast_open || false}
          onChange={(v) => setSettings({ ...settings, tcp_fast_open: v })}
          label={t("admin.velocity.settings.tcpFastOpen")}
          hint={t("admin.velocity.settings.tcpFastOpenHint")}
        />
        <CheckboxField
          id="bungee_plugin"
          checked={settings.bungee_plugin_message_channel !== undefined ? settings.bungee_plugin_message_channel : true}
          onChange={(v) => setSettings({ ...settings, bungee_plugin_message_channel: v })}
          label={t("admin.velocity.settings.bungeePluginChannel")}
          hint={t("admin.velocity.settings.bungeePluginChannelHint")}
        />
      </div>

      <CheckboxField
        id="force_key"
        checked={settings.force_key_authentication}
        onChange={(v) => setSettings({ ...settings, force_key_authentication: v })}
        label={t("admin.velocity.settings.forceKey")}
        hint={t("admin.velocity.settings.forceKeyHint")}
      />
      <CheckboxField
        id="prevent_proxy"
        checked={settings.prevent_client_proxy_connections}
        onChange={(v) => setSettings({ ...settings, prevent_client_proxy_connections: v })}
        label={t("admin.velocity.settings.preventProxy")}
        hint={t("admin.velocity.settings.preventProxyHint")}
      />
      <CheckboxField
        id="kick_existing"
        checked={settings.kick_existing_players}
        onChange={(v) => setSettings({ ...settings, kick_existing_players: v })}
        label={t("admin.velocity.settings.kickExisting")}
        hint={t("admin.velocity.settings.kickExistingHint")}
      />
      <CheckboxField
        id="expose_proxy_commands"
        checked={settings.expose_proxy_commands || false}
        onChange={(v) => setSettings({ ...settings, expose_proxy_commands: v })}
        label={t("admin.velocity.settings.exposeProxyCommands")}
        hint={t("admin.velocity.settings.exposeProxyCommandsHint")}
      />

      <h4 className="font-medium text-slate-800 mt-6 mb-3">
        {t("admin.velocity.settings.query")}
      </h4>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="md:col-span-2">
          <CheckboxField
            id="query_enabled"
            checked={settings.query_enabled || false}
            onChange={(v) => setSettings({ ...settings, query_enabled: v })}
            label={t("admin.velocity.settings.queryEnabled")}
            hint={t("admin.velocity.settings.queryEnabledHint")}
          />
        </div>
        <NumberField
          label={t("admin.velocity.settings.queryPort")}
          value={settings.query_port || 25577}
          onChange={(e) =>
            setSettings({ ...settings, query_port: parseInt(e.target.value, 10) || 25577 })
          }
        />
        <TextField
          label={t("admin.velocity.settings.queryMap")}
          value={settings.query_map || "Velocity"}
          onChange={(e) => setSettings({ ...settings, query_map: e.target.value })}
        />
        <div className="md:col-span-2">
          <CheckboxField
            id="query_show_plugins"
            checked={settings.query_show_plugins || false}
            onChange={(v) => setSettings({ ...settings, query_show_plugins: v })}
            label={t("admin.velocity.settings.queryShowPlugins")}
          />
        </div>
      </div>
    </>
  );
}

export default function SettingsTab({ settings, setSettings, saving, onSave }) {
  const { t } = useTranslation();

  return (
    <div className="max-w-2xl space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <TextField
          label={t("admin.velocity.settings.bindPort")}
          value={settings.bind_port}
          onChange={(e) => setSettings({ ...settings, bind_port: e.target.value })}
          placeholder="25577"
          hint={t("admin.velocity.settings.defaultPort")}
        />
        <NumberField
          label={t("admin.velocity.settings.maxPlayers")}
          value={settings.max_players}
          onChange={(e) =>
            setSettings({ ...settings, max_players: parseInt(e.target.value, 10) || 0 })
          }
        />
      </div>

      <div>
        <ContentFieldLabel className="mb-1">
          {t("admin.velocity.settings.motd")}
        </ContentFieldLabel>
        <ContentTextareaInput
          value={settings.motd}
          onChange={(e) => setSettings({ ...settings, motd: e.target.value })}
          className="font-mono text-sm"
          rows={2}
        />
        <p className="mt-1 text-xs text-slate-400">
          {t("admin.velocity.settings.motdHint")}
        </p>
      </div>

      <TextField
        label={t("admin.velocity.settings.secret")}
        value={settings.forwarding_secret}
        onChange={(e) => setSettings({ ...settings, forwarding_secret: e.target.value })}
        hint={t("admin.velocity.settings.secretHint")}
        className="font-mono text-sm bg-slate-50"
      />

      <div className="pt-4 border-t border-slate-200">
        <h3 className="font-medium text-slate-800 mb-4">
          {t("admin.velocity.settings.advanced")}
        </h3>
        <div className="space-y-4">
          <CheckboxField
            id="online_mode"
            checked={settings.online_mode}
            onChange={(v) => setSettings({ ...settings, online_mode: v })}
            label={t("admin.velocity.settings.onlineMode")}
            hint={t("admin.velocity.settings.onlineModeHint")}
          />

          <div>
            <ContentFieldLabel className="mb-1">
              {t("admin.velocity.settings.forwardingMode")}
            </ContentFieldLabel>
            <ContentSelectInput
              value={settings.player_info_forwarding_mode}
              onChange={(e) =>
                setSettings({ ...settings, player_info_forwarding_mode: e.target.value })
              }
              className="text-sm"
            >
              <option value="modern">{t("admin.velocity.settings.forwardingModeOptions.modern")}</option>
              <option value="legacy">{t("admin.velocity.settings.forwardingModeOptions.legacy")}</option>
              <option value="bungeeguard">{t("admin.velocity.settings.forwardingModeOptions.bungeeguard")}</option>
              <option value="none">{t("admin.velocity.settings.forwardingModeOptions.none")}</option>
            </ContentSelectInput>
          </div>

          <div>
            <ContentFieldLabel className="mb-1">
              {t("admin.velocity.settings.pingPassthrough")}
            </ContentFieldLabel>
            <ContentSelectInput
              value={settings.ping_passthrough || "DISABLED"}
              onChange={(e) => setSettings({ ...settings, ping_passthrough: e.target.value })}
              className="text-sm"
            >
              <option value="DISABLED">DISABLED</option>
              <option value="MODS">MODS</option>
              <option value="DESCRIPTION">DESCRIPTION</option>
              <option value="ALL">ALL</option>
            </ContentSelectInput>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <CheckboxField
              id="sample_players_in_ping"
              checked={settings.sample_players_in_ping !== undefined ? settings.sample_players_in_ping : true}
              onChange={(v) => setSettings({ ...settings, sample_players_in_ping: v })}
              label={t("admin.velocity.settings.samplePlayersInPing")}
            />
            <CheckboxField
              id="enable_player_address_logging"
              checked={settings.enable_player_address_logging !== undefined ? settings.enable_player_address_logging : true}
              onChange={(v) => setSettings({ ...settings, enable_player_address_logging: v })}
              label={t("admin.velocity.settings.enablePlayerAddressLogging")}
            />
            <CheckboxField
              id="haproxy_protocol"
              checked={settings.haproxy_protocol || false}
              onChange={(v) => setSettings({ ...settings, haproxy_protocol: v })}
              label={t("admin.velocity.settings.haproxyProtocol")}
              hint={t("admin.velocity.settings.haproxyProtocolHint")}
            />
            <CheckboxField
              id="accepts_transfers"
              checked={settings.accepts_transfers || false}
              onChange={(v) => setSettings({ ...settings, accepts_transfers: v })}
              label={t("admin.velocity.settings.acceptsTransfers")}
              hint={t("admin.velocity.settings.acceptsTransfersHint")}
            />
            <CheckboxField
              id="announce_forge"
              checked={settings.announce_forge || false}
              onChange={(v) => setSettings({ ...settings, announce_forge: v })}
              label={t("admin.velocity.settings.announceForge")}
              hint={t("admin.velocity.settings.announceForgeHint")}
            />
            <CheckboxField
              id="show_ping_requests"
              checked={settings.show_ping_requests || false}
              onChange={(v) => setSettings({ ...settings, show_ping_requests: v })}
              label={t("admin.velocity.settings.showPingRequests")}
              hint={t("admin.velocity.settings.showPingRequestsHint")}
            />
            <CheckboxField
              id="failover_on_unexpected_server_disconnect"
              checked={settings.failover_on_unexpected_server_disconnect !== undefined ? settings.failover_on_unexpected_server_disconnect : true}
              onChange={(v) => setSettings({ ...settings, failover_on_unexpected_server_disconnect: v })}
              label={t("admin.velocity.settings.failoverOnUnexpectedDisconnect")}
            />
            <CheckboxField
              id="log_command_executions"
              checked={settings.log_command_executions || false}
              onChange={(v) => setSettings({ ...settings, log_command_executions: v })}
              label={t("admin.velocity.settings.logCommandExecutions")}
            />
            <CheckboxField
              id="log_player_connections"
              checked={settings.log_player_connections !== undefined ? settings.log_player_connections : true}
              onChange={(v) => setSettings({ ...settings, log_player_connections: v })}
              label={t("admin.velocity.settings.logPlayerConnections")}
            />
            <CheckboxField
              id="enable_reuse_port"
              checked={settings.enable_reuse_port || false}
              onChange={(v) => setSettings({ ...settings, enable_reuse_port: v })}
              label={t("admin.velocity.settings.enableReusePort")}
            />
          </div>
        </div>
      </div>

      <AdvancedSettings settings={settings} setSettings={setSettings} t={t} />

      <div className="pt-4 border-t border-slate-200">
        <h3 className="font-medium text-slate-800 mb-4">
          {t("admin.velocity.settings.rateLimit")}
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <NumberField
            label={t("admin.velocity.settings.commandRateLimit")}
            value={settings.command_rate_limit || 0}
            onChange={(e) =>
              setSettings({
                ...settings,
                command_rate_limit: parseInt(e.target.value, 10) || 0,
              })
            }
          />
          <NumberField
            label={t("admin.velocity.settings.kickAfterRateLimitedCommands")}
            value={settings.kick_after_rate_limited_commands || 5}
            onChange={(e) =>
              setSettings({
                ...settings,
                kick_after_rate_limited_commands: parseInt(e.target.value, 10) || 0,
              })
            }
          />
          <NumberField
            label={t("admin.velocity.settings.tabCompleteRateLimit")}
            value={settings.tab_complete_rate_limit || 0}
            onChange={(e) =>
              setSettings({
                ...settings,
                tab_complete_rate_limit: parseInt(e.target.value, 10) || 0,
              })
            }
          />
          <NumberField
            label={t("admin.velocity.settings.kickAfterRateLimitedTabCompletes")}
            value={settings.kick_after_rate_limited_tab_completes || 5}
            onChange={(e) =>
              setSettings({
                ...settings,
                kick_after_rate_limited_tab_completes: parseInt(e.target.value, 10) || 0,
              })
            }
          />
          <div className="md:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-4">
            <CheckboxField
              id="forward_commands_if_rate_limited"
              checked={settings.forward_commands_if_rate_limited !== undefined ? settings.forward_commands_if_rate_limited : true}
              onChange={(v) => setSettings({ ...settings, forward_commands_if_rate_limited: v })}
              label={t("admin.velocity.settings.forwardCommandsIfRateLimited")}
            />
          </div>
        </div>
      </div>

      <div className="pt-4 flex justify-end">
        <ContentPrimaryButton
          type="button"
          onClick={onSave}
          disabled={saving}
          loading={saving}
          loadingLabel={t("admin.velocity.settings.saving")}
          icon={RefreshCw}
          iconSize={16}
        >
          {t("admin.velocity.settings.save")}
        </ContentPrimaryButton>
      </div>
    </div>
  );
}
