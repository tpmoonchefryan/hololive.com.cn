import { Languages, Loader2 } from "lucide-react";

export default function TranslateActionButton({
  onClick,
  translating = false,
  disabled = false,
  label,
  translatingLabel,
  className = "",
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || translating}
      className={`inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1.5 text-xs md:text-sm font-semibold text-slate-900 hover:bg-slate-200 disabled:opacity-60 disabled:cursor-not-allowed transition-colors ${className}`.trim()}
    >
      {translating ? (
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
      ) : (
        <Languages className="w-3.5 h-3.5" />
      )}
      {translating ? translatingLabel : label}
    </button>
  );
}
