const DEFAULT_LANGUAGES = [
  { code: "zh", label: "中文" },
  { code: "en", label: "English" },
  { code: "ja", label: "日本語" },
];

export default function MultilangTabs({
  languages = DEFAULT_LANGUAGES,
  activeLang = "zh",
  onChange,
  className = "",
  compact = false,
  stretch = false,
  buttonBaseClassName = "",
  activeButtonClassName = "",
  inactiveButtonClassName = "",
}) {
  return (
    <div className={`flex gap-2 ${className}`.trim()}>
      {languages.map((lang) => {
        const active = activeLang === lang.code;
        const baseClass = compact
          ? "px-2 py-0.5 text-xs rounded"
          : "px-3 py-1 text-xs rounded-lg transition-colors";
        const activeClass =
          activeButtonClassName ||
          "bg-[var(--color-brand-blue)] text-slate-950";
        const inactiveClass =
          inactiveButtonClassName ||
          "bg-slate-100 text-slate-600 hover:bg-slate-200";

        return (
          <button
            key={lang.code}
            type="button"
            onClick={() => onChange?.(lang.code)}
            className={`${stretch ? "flex-1" : ""} ${baseClass} ${active ? activeClass : inactiveClass} ${buttonBaseClassName}`.trim()}
          >
            {lang.label}
          </button>
        );
      })}
    </div>
  );
}
