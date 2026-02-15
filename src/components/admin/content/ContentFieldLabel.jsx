function joinClassNames(...values) {
  return values.filter(Boolean).join(" ");
}

export default function ContentFieldLabel({
  htmlFor,
  className = "",
  children,
}) {
  return (
    <label htmlFor={htmlFor} className={joinClassNames("block text-sm font-medium text-slate-700 mb-2", className)}>
      {children}
    </label>
  );
}
