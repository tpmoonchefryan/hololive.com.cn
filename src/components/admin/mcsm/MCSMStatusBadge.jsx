import { useTranslation } from "react-i18next";

const STATUS_MAP = {
    "-1": { label: "busy", color: "bg-yellow-500", textColor: "text-yellow-700", bgColor: "bg-yellow-50" },
    "0": { label: "stopped", color: "bg-red-500", textColor: "text-red-700", bgColor: "bg-red-50" },
    "1": { label: "stopping", color: "bg-orange-500", textColor: "text-orange-700", bgColor: "bg-orange-50" },
    "2": { label: "starting", color: "bg-blue-500", textColor: "text-blue-700", bgColor: "bg-blue-50" },
    "3": { label: "running", color: "bg-green-500", textColor: "text-green-700", bgColor: "bg-green-50" },
};

export default function MCSMStatusBadge({ status }) {
    const { t } = useTranslation();
    const info = STATUS_MAP[String(status)] || STATUS_MAP["-1"];
    const label = t(`admin.mcsm.status.${info.label}`);

    return (
        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${info.textColor} ${info.bgColor}`}>
            <span className={`w-2 h-2 rounded-full ${info.color}`} />
            {label}
        </span>
    );
}
