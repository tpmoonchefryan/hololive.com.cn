function joinClassNames(...values) {
  return values.filter(Boolean).join(" ");
}

const ALIGN_CLASS = {
  left: "text-left",
  right: "text-right",
  center: "text-center",
};

const SPACING_CLASS = {
  default: "px-6 py-4",
  compact: "px-4 py-3",
};

export default function ContentTableCell({
  align = "left",
  nowrap = false,
  compact = false,
  className = "",
  children,
  ...props
}) {
  return (
    <td
      {...props}
      className={joinClassNames(
        compact ? SPACING_CLASS.compact : SPACING_CLASS.default,
        ALIGN_CLASS[align] || ALIGN_CLASS.left,
        nowrap ? "whitespace-nowrap" : "",
        className
      )}
    >
      {children}
    </td>
  );
}
