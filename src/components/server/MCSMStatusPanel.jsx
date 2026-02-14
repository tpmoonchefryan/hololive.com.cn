import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Activity, Cpu, MemoryStick, Loader2 } from "lucide-react";
import { createAppLogger } from "../../lib/appLogger";

const logger = createAppLogger("MCSMStatusPanel");

const STATUS_COLORS = {
    3: "bg-green-500",
    2: "bg-blue-500",
    1: "bg-orange-500",
    0: "bg-red-500",
    "-1": "bg-yellow-500",
};

function normalizePercent(value) {
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
        return null;
    }
    return value;
}

function clampProgress(value) {
    return Math.max(0, Math.min(value, 100));
}

function formatPercent(value) {
    if (value === null) return "-";
    const rounded = Math.round(value * 10) / 10;
    return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)}%`;
}

export default function MCSMStatusPanel() {
    const { t } = useTranslation("docs");
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        const fetchStatus = async () => {
            try {
                const res = await fetch("/mcsm-api/public/status");
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const json = await res.json();
                setData(json);
                setError(null);
            } catch (err) {
                logger.warn("MCSM status fetch failed:", err?.message);
                setError(err?.message);
            } finally {
                setLoading(false);
            }
        };

        fetchStatus();
        const timer = setInterval(fetchStatus, 15000);
        return () => clearInterval(timer);
    }, []);

    // Don't render anything if MCSM is unavailable
    if (error && !data) return null;
    if (!loading && (!data?.instances || data.instances.length === 0)) return null;

    return (
        <div className="bg-white rounded-xl p-6 mb-6 border border-slate-200 shadow-lg">
            <div className="flex items-center gap-3 mb-4">
                <Activity className="w-6 h-6 text-blue-500" />
                <h2 className="text-xl font-bold text-slate-900">
                    {t("serverInfo.mcsm.title", { defaultValue: "服务器资源状态" })}
                </h2>
                {loading && <Loader2 className="w-4 h-4 animate-spin text-slate-400 ml-2" />}
            </div>

            {loading && !data ? (
                <div className="flex items-center gap-2 text-slate-600 py-4">
                    <Loader2 className="w-5 h-5 animate-spin" />
                    <span>{t("common.loading", { defaultValue: "加载中..." })}</span>
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {(data?.instances || []).map((inst) => {
                        const nodeCpuPercent = normalizePercent(
                            inst.nodeCpuPercent ?? inst.nodeCpu
                        );
                        const nodeMemoryPercent = normalizePercent(
                            inst.nodeMemoryPercent ?? (
                                inst.nodeMemTotal && inst.nodeMemUsed != null
                                    ? (inst.nodeMemUsed / inst.nodeMemTotal) * 100
                                    : null
                            )
                        );

                        const metrics = [
                            {
                                key: "cpu",
                                label: t("serverInfo.mcsm.cpu", { defaultValue: "CPU" }),
                                icon: Cpu,
                                barClass: "bg-blue-500",
                                value: nodeCpuPercent,
                            },
                            {
                                key: "memory",
                                label: t("serverInfo.mcsm.memory", { defaultValue: "内存" }),
                                icon: MemoryStick,
                                barClass: "bg-purple-500",
                                value: nodeMemoryPercent,
                            },
                        ];

                        return (
                            <div key={inst.instanceUuid} className="p-4 rounded-lg bg-slate-50 hover:bg-slate-100 transition-colors">
                                <div className="flex items-center justify-between mb-3">
                                    <span className="font-semibold text-slate-800 truncate">{inst.name}</span>
                                    <span className={`w-3 h-3 rounded-full ${STATUS_COLORS[inst.status] || "bg-gray-400"} ${inst.status === 3 ? "animate-pulse" : ""}`} />
                                </div>
                                <div className="space-y-3 text-sm">
                                    {metrics.map((metric) => {
                                        const MetricIcon = metric.icon;
                                        const width = metric.value === null
                                            ? 0
                                            : clampProgress(metric.value);
                                        return (
                                            <div key={metric.key} className="flex items-center gap-2">
                                                <MetricIcon className="w-4 h-4 text-slate-500 shrink-0" />
                                                <span className="text-xs text-slate-500 w-10 shrink-0">
                                                    {metric.label}
                                                </span>
                                                <div className="flex-1 bg-slate-200 rounded-full h-2">
                                                    <div
                                                        className={`${metric.barClass} h-2 rounded-full transition-all`}
                                                        style={{ width: `${width}%` }}
                                                    />
                                                </div>
                                                <span className="text-xs text-slate-500 w-14 text-right">
                                                    {formatPercent(metric.value)}
                                                </span>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
