import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Send } from "lucide-react";
import ContentFieldLabel from "../content/ContentFieldLabel";
import ContentSelectInput from "../content/ContentSelectInput";
import ContentTextInput from "../content/ContentTextInput";
import ContentPrimaryButton from "../content/ContentPrimaryButton";

export default function MCSMConsoleTab({
  instances,
  fetchAllInstances,
  selectedInstance,
  setSelectedInstance,
  consoleLog,
  commandInput,
  setCommandInput,
  sendingCommand,
  startConsolePolling,
  stopConsolePolling,
  handleSendCommand,
}) {
  const { t } = useTranslation();
  const logEndRef = useRef(null);

  useEffect(() => {
    fetchAllInstances();
  }, [fetchAllInstances]);

  const allInstances = (instances || []).map((inst) => ({
    ...inst,
    label: `${inst.nodeName || inst.daemonId} / ${inst.config?.nickname || inst.instanceUuid}`,
  }));

  useEffect(() => {
    if (selectedInstance) {
      startConsolePolling(selectedInstance.instanceUuid, selectedInstance.daemonId);
    }
    return () => stopConsolePolling();
  }, [selectedInstance, startConsolePolling, stopConsolePolling]);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [consoleLog]);

  const handleSelect = (e) => {
    const uuid = e.target.value;
    const inst = allInstances.find((item) => item.instanceUuid === uuid);
    setSelectedInstance(inst || null);
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey && selectedInstance) {
      e.preventDefault();
      handleSendCommand(selectedInstance.instanceUuid, selectedInstance.daemonId);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <ContentFieldLabel className="mb-1">
          {t("admin.mcsm.console.selectInstance")}
        </ContentFieldLabel>
        <ContentSelectInput
          value={selectedInstance?.instanceUuid || ""}
          onChange={handleSelect}
          className="w-full md:w-80"
        >
          <option value="">{t("admin.mcsm.console.selectPlaceholder")}</option>
          {allInstances.map((inst) => (
            <option key={inst.instanceUuid} value={inst.instanceUuid}>
              {inst.label}
            </option>
          ))}
        </ContentSelectInput>
      </div>

      {selectedInstance ? (
        <>
          <div className="bg-slate-900 rounded-lg p-4 h-96 overflow-y-auto font-mono text-xs text-green-400 whitespace-pre-wrap">
            {consoleLog || t("admin.mcsm.console.noOutput")}
            <div ref={logEndRef} />
          </div>
          <div className="flex gap-2">
            <ContentTextInput
              type="text"
              value={commandInput}
              onChange={(e) => setCommandInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={t("admin.mcsm.console.commandPlaceholder")}
              disabled={sendingCommand}
              className="flex-1 font-mono text-sm"
            />
            <ContentPrimaryButton
              type="button"
              onClick={() =>
                handleSendCommand(selectedInstance.instanceUuid, selectedInstance.daemonId)
              }
              disabled={sendingCommand || !commandInput.trim()}
              loading={sendingCommand}
              icon={Send}
              iconSize={16}
              className="text-white bg-blue-600 hover:bg-blue-700"
              aria-label={t("admin.mcsm.console.commandPlaceholder")}
            >
              <span className="sr-only">{t("admin.mcsm.console.commandPlaceholder")}</span>
            </ContentPrimaryButton>
          </div>
        </>
      ) : null}
    </div>
  );
}
