function joinClassNames(...values) {
  return values.filter(Boolean).join(" ");
}

const BASE_CLASS =
  "w-full px-3 py-2 border border-slate-300 rounded-lg bg-white focus:ring-2 focus:ring-[var(--color-brand-blue)]/40 focus:border-[var(--color-brand-blue)]";

export default function ContentSelectInput({ className = "", children, ...props }) {
  return (
    <select {...props} className={joinClassNames(BASE_CLASS, className)}>
      {children}
    </select>
  );
}
