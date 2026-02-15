function joinClassNames(...values) {
  return values.filter(Boolean).join(" ");
}

const DEFAULT_ACTIVE_CLASS = "border-[var(--color-brand-blue)] text-[var(--color-brand-blue)]";
const DEFAULT_INACTIVE_CLASS =
  "border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300";

export default function ContentTabsNav({
  tabs = [],
  activeTab,
  onChange,
  className = "",
  navClassName = "",
  activeClassName = DEFAULT_ACTIVE_CLASS,
  inactiveClassName = DEFAULT_INACTIVE_CLASS,
}) {
  return (
    <div className={joinClassNames("border-b border-slate-200", className)}>
      <nav className={joinClassNames("flex space-x-8 overflow-x-auto", navClassName)}>
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;

          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onChange?.(tab.id)}
              className={joinClassNames(
                "flex items-center gap-2 py-4 px-1 border-b-2 font-medium text-sm transition-colors whitespace-nowrap",
                isActive ? activeClassName : inactiveClassName
              )}
            >
              {Icon ? <Icon className="w-4 h-4" /> : null}
              {tab.label}
            </button>
          );
        })}
      </nav>
    </div>
  );
}
