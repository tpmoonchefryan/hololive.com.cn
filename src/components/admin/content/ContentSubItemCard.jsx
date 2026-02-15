function joinClassNames(...values) {
  return values.filter(Boolean).join(" ");
}

export default function ContentSubItemCard({
  className = "",
  children,
}) {
  return (
    <div className={joinClassNames("p-4 border border-slate-200 rounded-lg space-y-3", className)}>
      {children}
    </div>
  );
}
