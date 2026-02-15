import { Loader2 } from "lucide-react";

export default function ContentStateBlock({
  loading = false,
  loadingText = "Loading...",
  icon: Icon,
  title,
  description,
  action,
  className = "",
}) {
  if (loading) {
    return (
      <div className={`flex flex-col items-center justify-center py-20 bg-white rounded-xl border border-slate-200 ${className}`.trim()}>
        <Loader2 className="w-8 h-8 animate-spin text-slate-400 mb-4" />
        <p className="text-sm text-slate-500">{loadingText}</p>
      </div>
    );
  }

  return (
    <div className={`bg-white rounded-xl border border-dashed border-slate-300 p-10 text-center ${className}`.trim()}>
      {Icon ? <Icon className="w-12 h-12 text-slate-300 mx-auto mb-4" /> : null}
      {title ? <p className="text-sm font-medium text-slate-700">{title}</p> : null}
      {description ? <p className="text-xs text-slate-500 mt-1">{description}</p> : null}
      {action ? <div className="mt-6">{action}</div> : null}
    </div>
  );
}
