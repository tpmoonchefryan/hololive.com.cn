import MultilangTabs from "./MultilangTabs";

const DEFAULT_LANGUAGES = [
  { code: "zh", label: "中文" },
  { code: "en", label: "English" },
  { code: "ja", label: "日本語" },
];

function renderControl({
  type,
  value,
  onChange,
  placeholder,
  className,
  rows,
  required,
  name,
  autoComplete,
  inputMode,
  spellCheck,
  maxLength,
}) {
  if (type === "textarea") {
    return (
      <textarea
        name={name}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={className}
        rows={rows}
        placeholder={placeholder}
        required={required}
        spellCheck={spellCheck}
        maxLength={maxLength}
      />
    );
  }

  return (
    <input
      type={type}
      name={name}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className={className}
      placeholder={placeholder}
      required={required}
      autoComplete={autoComplete}
      inputMode={inputMode}
      spellCheck={spellCheck}
      maxLength={maxLength}
    />
  );
}

export default function MultilangField({
  label,
  type = "text",
  value = {},
  onChange,
  languages = DEFAULT_LANGUAGES,
  activeLang = "zh",
  onActiveLangChange,
  showAllLanguages = false,
  required = false,
  requiredLangs = ["zh"],
  rows = 3,
  placeholder,
  placeholders = {},
  className = "",
  controlClassName = "w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-[var(--color-brand-blue)]/40 focus:border-transparent",
  labelClassName = "block text-sm font-medium text-slate-700",
  perLangLabelClassName = "block text-xs font-medium text-slate-600 mb-1",
  namePrefix = "",
  autoComplete = "off",
  inputMode,
  spellCheck,
  maxLength,
  tabsCompact = false,
  showTabs = true,
  afterControl = null,
}) {
  if (!showAllLanguages) {
    const currentValue = value?.[activeLang] || "";
    const computedPlaceholder =
      typeof placeholder === "function"
        ? placeholder(activeLang)
        : placeholder || "";

    return (
      <div className={className}>
        <div className="flex items-center justify-between mb-2">
          <label className={labelClassName}>{label}</label>
          {showTabs ? (
            <MultilangTabs
              languages={languages}
              activeLang={activeLang}
              onChange={onActiveLangChange}
              compact={tabsCompact}
            />
          ) : null}
        </div>
        {renderControl({
          type,
          value: currentValue,
          onChange: (nextValue) => onChange?.(activeLang, nextValue),
          placeholder: computedPlaceholder,
          className: controlClassName,
          rows,
          required,
          name: namePrefix ? `${namePrefix}_${activeLang}` : undefined,
          autoComplete,
          inputMode,
          spellCheck,
          maxLength,
        })}
        {afterControl}
      </div>
    );
  }

  return (
    <div className={className}>
      {label ? <label className={`${labelClassName} mb-2`}>{label}</label> : null}
      <div className="space-y-3">
        {languages.map((lang) => {
          const langCode = lang.code;
          const langValue = value?.[langCode] || "";
          const langRequired = requiredLangs.includes(langCode);
          const langPlaceholder = placeholders?.[langCode] || "";
          return (
            <div key={langCode}>
              <label className={perLangLabelClassName}>{lang.label}</label>
              {renderControl({
                type,
                value: langValue,
                onChange: (nextValue) => onChange?.(langCode, nextValue),
                placeholder: langPlaceholder,
                className: controlClassName,
                rows,
                required: langRequired,
                name: namePrefix ? `${namePrefix}_${langCode}` : undefined,
                autoComplete,
                inputMode,
                spellCheck,
                maxLength,
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
