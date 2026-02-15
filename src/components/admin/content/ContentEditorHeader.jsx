import { ArrowLeft } from "lucide-react";
import { Link } from "react-router-dom";

export default function ContentEditorHeader({
  backTo,
  title,
  actions,
  backClassName = "text-gray-600 hover:text-gray-900 transition-colors",
  titleClassName = "text-xl md:text-2xl font-bold text-slate-900",
  containerClassName = "flex items-center justify-between gap-3 flex-wrap",
}) {
  return (
    <div className={containerClassName}>
      <div className="flex items-center gap-4">
        <Link to={backTo} className={backClassName}>
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <div>
          <h1 className={titleClassName}>{title}</h1>
        </div>
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}
