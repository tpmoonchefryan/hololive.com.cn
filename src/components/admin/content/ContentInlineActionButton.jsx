function joinClassNames(...values) {
  return values.filter(Boolean).join(" ");
}

const TONE_CLASS = {
  success: "bg-emerald-600 text-white hover:bg-emerald-700",
  neutral: "bg-slate-100 text-slate-700 hover:bg-slate-200",
};

export default function ContentInlineActionButton({
  as: Component = "button",
  tone = "success",
  icon: Icon,
  iconSize = 16,
  className = "",
  children,
  ...props
}) {
  const computedProps = {
    ...props,
    className: joinClassNames(
      "inline-flex items-center gap-1 px-3 py-1 text-sm rounded-lg transition-colors disabled:opacity-60 disabled:cursor-not-allowed",
      TONE_CLASS[tone] || TONE_CLASS.neutral,
      className
    ),
  };

  if (Component === "button" && !computedProps.type) {
    computedProps.type = "button";
  }

  return (
    <Component {...computedProps}>
      {Icon ? <Icon size={iconSize} /> : null}
      {children}
    </Component>
  );
}
