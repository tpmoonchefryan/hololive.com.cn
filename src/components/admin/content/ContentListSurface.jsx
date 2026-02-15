function joinClassNames(...values) {
  return values.filter(Boolean).join(" ");
}

export default function ContentListSurface({
  className = "",
  listClassName = "",
  children,
}) {
  return (
    <div
      className={joinClassNames(
        "bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden",
        className
      )}
    >
      <div className={joinClassNames("divide-y divide-slate-200", listClassName)}>
        {children}
      </div>
    </div>
  );
}
