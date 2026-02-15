function joinClassNames(...values) {
  return values.filter(Boolean).join(" ");
}

const BASE_CLASS =
  "transition-colors disabled:opacity-60 disabled:cursor-not-allowed";

export default function ContentTextButton({
  as: Component = "button",
  className = "",
  children,
  ...props
}) {
  const computedProps = {
    ...props,
    className: joinClassNames(BASE_CLASS, className),
  };

  if (Component === "button" && !computedProps.type) {
    computedProps.type = "button";
  }

  return <Component {...computedProps}>{children}</Component>;
}
