function joinClassNames(...values) {
  return values.filter(Boolean).join(" ");
}

export default function ContentStatusPill({
  active = false,
  activeLabel,
  inactiveLabel,
  onClick,
  disabled = false,
  className = "",
}) {
  const Component = onClick ? "button" : "span";
  const interactiveProps = onClick
    ? {
        type: "button",
        onClick,
        disabled,
      }
    : {};

  return (
    <Component
      {...interactiveProps}
      className={joinClassNames(
        "inline-flex px-2 py-1 text-xs font-semibold rounded-full transition-colors",
        active
          ? "bg-green-100 text-green-800 hover:bg-green-200"
          : "bg-gray-100 text-gray-800 hover:bg-gray-200",
        onClick ? "disabled:opacity-60 disabled:cursor-not-allowed" : "",
        className
      )}
    >
      {active ? activeLabel : inactiveLabel}
    </Component>
  );
}
