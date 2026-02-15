function joinClassNames(...values) {
  return values.filter(Boolean).join(" ");
}

const ALIGN_CLASS = {
  left: "text-left",
  right: "text-right",
  center: "text-center",
};

const SPACING_CLASS = {
  default: "px-6 py-3",
  compact: "px-4 py-3",
};

export default function ContentTableHeadCell({
  align = "left",
  compact = false,
  className = "",
  children,
}) {
  return (
    <th
      className={joinClassNames(
        compact ? SPACING_CLASS.compact : SPACING_CLASS.default,
        "text-xs font-medium text-gray-500 uppercase tracking-wider",
        ALIGN_CLASS[align] || ALIGN_CLASS.left,
        className
      )}
    >
      {children}
    </th>
  );
}
