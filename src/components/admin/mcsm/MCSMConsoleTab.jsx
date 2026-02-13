import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Send, Loader2 } from "lucide-react";

export default function MCSMConsoleTab({
    instances, fetchAllInstances, selectedInstance, setSelectedInstance,
    consoleLog, commandInput, setCommandInput, sendingCommand,
    startConsolePolling, stopConsolePolling, handleSendCommand,
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
        const inst = allInstances.find((i) => i.instanceUuid === uuid);
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
                <label className="block text-sm font-medium text-slate-700 mb-1">
                    {t("admin.mcsm.console.selectInstance")}
                </label>
                <select
                    value={selectedInstance?.instanceUuid || ""}
                    onChange={handleSelect}
                    className="w-full md:w-80 px-3 py-2 border border-slate-300 rounded-lg"
                >
                    <option value="">{t("admin.mcsm.console.selectPlaceholder")}</option>
                    {allInstances.map((inst) => (
                        <option key={inst.instanceUuid} value={inst.instanceUuid}>
                            {inst.label}
                        </option>
                    ))}
                </select>
            </div>

            {selectedInstance && (
                <>
                    <div className="bg-slate-900 rounded-lg p-4 h-96 overflow-y-auto font-mono text-xs text-green-400 whitespace-pre-wrap">
                        {consoleLog || t("admin.mcsm.console.noOutput")}
                        <div ref={logEndRef} />
                    </div>
                    <div className="flex gap-2">
                        <input
                            type="text"
                            value={commandInput}
                            onChange={(e) => setCommandInput(e.target.value)}
                            onKeyDown={handleKeyDown}
                            placeholder={t("admin.mcsm.console.commandPlaceholder")}
                            disabled={sendingCommand}
                            className="flex-1 px-3 py-2 border border-slate-300 rounded-lg font-mono text-sm"
                        />
                        <button
                            onClick={() => handleSendCommand(selectedInstance.instanceUuid, selectedInstance.daemonId)}
                            disabled={sendingCommand || !commandInput.trim()}
                            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                        >
                            {sendingCommand ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                        </button>
                    </div>
                </>
            )}
        </div>
    );
}
