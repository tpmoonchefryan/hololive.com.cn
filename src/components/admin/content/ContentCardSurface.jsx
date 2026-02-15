function joinClassNames(...values) {
  return values.filter(Boolean).join(" ");
}

export default function ContentCardSurface({
  as: Component = "div",
  className = "",
  children,
  ...props
}) {
  return (
    <Component
      {...props}
      className={joinClassNames(
        "rounded-2xl border border-slate-200 bg-white shadow-sm",
        className
      )}
    >
      {children}
    </Component>
  );
}
