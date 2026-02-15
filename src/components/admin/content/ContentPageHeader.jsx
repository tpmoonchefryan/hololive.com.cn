export default function ContentPageHeader({ title, subtitle, actions = null }) {
  return (
    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
      <div className="space-y-1">
        <h1 className="text-xl md:text-2xl font-bold text-slate-900">{title}</h1>
        {subtitle ? <p className="text-xs md:text-sm text-slate-500">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-col sm:flex-row gap-2 sm:items-center">{actions}</div> : null}
    </div>
  );
}
