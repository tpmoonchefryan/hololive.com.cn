function joinClassNames(...values) {
  return values.filter(Boolean).join(" ");
}

export default function ContentOptionalLink({
  href,
  text,
  placeholder = "-",
  linkClassName = "",
  emptyClassName = "",
}) {
  if (href) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className={joinClassNames(
          "text-sm text-blue-600 hover:underline truncate max-w-xs block",
          linkClassName
        )}
      >
        {text || href}
      </a>
    );
  }

  return (
    <span className={joinClassNames("text-sm text-gray-400", emptyClassName)}>
      {placeholder}
    </span>
  );
}
