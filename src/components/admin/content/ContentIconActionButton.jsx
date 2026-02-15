import { Loader2 } from "lucide-react";

function joinClassNames(...values) {
  return values.filter(Boolean).join(" ");
}

const TONE_CLASS = {
  edit: "text-blue-600 hover:text-blue-700 hover:bg-blue-50",
  danger: "text-red-600 hover:text-red-700 hover:bg-red-50",
  neutral: "text-slate-500 hover:text-slate-700 hover:bg-slate-100",
};

const SIZE_CLASS = {
  md: "p-2 rounded-lg",
  sm: "p-1.5 rounded-md",
};

export default function ContentIconActionButton({
  as: Component = "button",
  icon: Icon,
  tone = "neutral",
  size = "md",
  loading = false,
  disabled = false,
  iconSize = 18,
  className = "",
  ...props
}) {
  const computedClassName = joinClassNames(
    SIZE_CLASS[size] || SIZE_CLASS.md,
    TONE_CLASS[tone] || TONE_CLASS.neutral,
    "transition-colors disabled:opacity-60 disabled:cursor-not-allowed",
    className
  );

  const computedProps = {
    ...props,
    disabled: disabled || loading,
    className: computedClassName,
  };

  if (Component === "button" && !computedProps.type) {
    computedProps.type = "button";
  }

  return (
    <Component {...computedProps}>
      {loading ? (
        <Loader2 size={iconSize} className="animate-spin" />
      ) : Icon ? (
        <Icon size={iconSize} />
      ) : null}
    </Component>
  );
}
