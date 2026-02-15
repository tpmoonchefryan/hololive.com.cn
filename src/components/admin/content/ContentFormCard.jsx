export default function ContentFormCard({
  title,
  description,
  headerRight = null,
  className = "",
  children,
}) {
  return (
    <section className={`rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm ${className}`.trim()}>
      {(title || description || headerRight) ? (
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 pb-2">
          <div>
            {title ? <h2 className="text-sm font-semibold text-slate-900">{title}</h2> : null}
            {description ? <p className="mt-1 text-xs text-slate-500">{description}</p> : null}
          </div>
          {headerRight}
        </div>
      ) : null}
      <div className={title || description || headerRight ? "mt-4" : ""}>
        {children}
      </div>
    </section>
  );
}
