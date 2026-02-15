import { Edit, Trash2 } from "lucide-react";
import ContentIconActionButton from "./ContentIconActionButton";

export default function ContentEditDeleteActions({
  onEdit,
  onDelete,
  editTitle,
  deleteTitle,
  deleting = false,
  disabled = false,
  size = "md",
  iconSize = 18,
  className = "",
}) {
  return (
    <div className={`flex items-center gap-2 ${className}`.trim()}>
      <ContentIconActionButton
        onClick={onEdit}
        tone="edit"
        icon={Edit}
        size={size}
        iconSize={iconSize}
        title={editTitle}
        aria-label={editTitle}
        disabled={disabled}
      />
      <ContentIconActionButton
        onClick={onDelete}
        tone="danger"
        icon={Trash2}
        size={size}
        iconSize={iconSize}
        loading={deleting}
        title={deleteTitle}
        aria-label={deleteTitle}
        disabled={disabled}
      />
    </div>
  );
}
