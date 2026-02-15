function joinClassNames(...values) {
  return values.filter(Boolean).join(" ");
}

export default function ContentTableHeader({
  className = "",
  children,
}) {
  return (
    <thead className={joinClassNames("bg-gray-50 border-b border-gray-200", className)}>
      {children}
    </thead>
  );
}
