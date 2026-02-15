function joinClassNames(...values) {
  return values.filter(Boolean).join(" ");
}

export default function ContentTableSurface({
  className = "",
  scrollClassName = "",
  children,
}) {
  return (
    <div
      className={joinClassNames(
        "bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden",
        className
      )}
    >
      <div className={joinClassNames("overflow-x-auto", scrollClassName)}>
        {children}
      </div>
    </div>
  );
}
