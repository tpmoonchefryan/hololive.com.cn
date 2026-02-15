function joinClassNames(...values) {
  return values.filter(Boolean).join(" ");
}

const VARIANT_CLASS = {
  solid: [
    "px-4 py-2 bg-slate-100 text-slate-700 rounded-lg font-medium",
    "hover:bg-slate-200 transition-colors",
    "disabled:opacity-60 disabled:cursor-not-allowed",
  ].join(" "),
  pill: [
    "inline-flex items-center justify-center gap-1.5 rounded-full px-4 py-1.5",
    "text-xs md:text-sm font-semibold",
    "bg-slate-100 text-slate-700 hover:bg-slate-200 transition-colors",
    "disabled:opacity-60 disabled:cursor-not-allowed",
  ].join(" "),
};

export default function ContentSecondaryButton({
  as: Component = "button",
  variant = "solid",
  className = "",
  children,
  ...props
}) {
  const computedProps = {
    ...props,
    className: joinClassNames(VARIANT_CLASS[variant] || VARIANT_CLASS.solid, className),
  };

  if (Component === "button" && !computedProps.type) {
    computedProps.type = "button";
  }

  return <Component {...computedProps}>{children}</Component>;
}
