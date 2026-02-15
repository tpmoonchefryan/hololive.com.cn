function joinClassNames(...values) {
  return values.filter(Boolean).join(" ");
}

const BASE_CLASS =
  "w-5 h-5 text-[var(--color-brand-blue)] border-gray-300 rounded focus:ring-2 focus:ring-[var(--color-brand-blue)]/40";

export default function ContentCheckboxInput({ className = "", ...props }) {
  return <input type="checkbox" {...props} className={joinClassNames(BASE_CLASS, className)} />;
}
