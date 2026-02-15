function joinClassNames(...values) {
  return values.filter(Boolean).join(" ");
}

export default function ContentDraggableRow({
  dragged = false,
  className = "",
  children,
  ...props
}) {
  return (
    <div
      {...props}
      draggable
      className={joinClassNames(
        "p-4 hover:bg-slate-50 transition-colors",
        dragged ? "opacity-50" : "",
        className
      )}
    >
      {children}
    </div>
  );
}
