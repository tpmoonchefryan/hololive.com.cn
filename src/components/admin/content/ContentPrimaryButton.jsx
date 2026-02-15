import { Loader2 } from "lucide-react";

function joinClassNames(...values) {
  return values.filter(Boolean).join(" ");
}

const VARIANT_CLASS = {
  solid: [
    "inline-flex items-center gap-2 px-4 py-2 rounded-lg font-medium",
    "bg-[var(--color-brand-blue)] text-slate-950 hover:bg-[var(--color-brand-blue)]/90",
    "transition-colors disabled:opacity-60 disabled:cursor-not-allowed",
  ].join(" "),
  pill: [
    "inline-flex items-center justify-center gap-1.5 rounded-full px-4 py-1.5",
    "text-xs md:text-sm font-semibold",
    "bg-[var(--color-brand-blue)] text-slate-950 shadow-[0_0_18px_rgba(142,209,252,0.8)]",
    "hover:scale-[1.02] active:scale-[0.98]",
    "transition-transform disabled:opacity-60 disabled:cursor-not-allowed",
  ].join(" "),
};

export default function ContentPrimaryButton({
  as: Component = "button",
  variant = "solid",
  icon: Icon,
  loading = false,
  loadingLabel = "",
  iconSize = 16,
  className = "",
  children,
  ...props
}) {
  const computedClassName = joinClassNames(VARIANT_CLASS[variant] || VARIANT_CLASS.solid, className);
  const computedProps = { ...props, className: computedClassName };

  if (Component === "button" && !computedProps.type) {
    computedProps.type = "button";
  }

  return (
    <Component {...computedProps}>
      {loading ? (
        <Loader2 className="w-4 h-4 animate-spin" />
      ) : Icon ? (
        <Icon size={iconSize} />
      ) : null}
      {loading && loadingLabel ? loadingLabel : children}
    </Component>
  );
}
