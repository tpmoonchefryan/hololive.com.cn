import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Folder,
  File,
  ChevronRight,
  Trash2,
  Plus,
  Edit3,
} from "lucide-react";
import MCSMFileEditor from "./MCSMFileEditor";
import ContentFieldLabel from "../content/ContentFieldLabel";
import ContentSelectInput from "../content/ContentSelectInput";
import ContentTextInput from "../content/ContentTextInput";
import ContentInlineActionButton from "../content/ContentInlineActionButton";
import ContentPrimaryButton from "../content/ContentPrimaryButton";
import ContentIconActionButton from "../content/ContentIconActionButton";
import ContentStateBlock from "../content/ContentStateBlock";
import ContentTextButton from "../content/ContentTextButton";

export default function MCSMFilesTab({
  instances,
  fetchAllInstances,
  selectedInstance,
  setSelectedInstance,
  files,
  currentPath,
  filesLoading,
  fetchFiles,
  readFile,
  writeFile,
  createDir,
  createFile,
  deleteFiles,
}) {
  const { t } = useTranslation();
  const [editorOpen, setEditorOpen] = useState(false);
  const [editTarget, setEditTarget] = useState(null);
  const [newItemName, setNewItemName] = useState("");
  const [showNewInput, setShowNewInput] = useState(null);

  useEffect(() => {
    fetchAllInstances();
  }, [fetchAllInstances]);

  const allInstances = (instances || []).map((inst) => ({
    ...inst,
    label: `${inst.nodeName || inst.daemonId} / ${inst.config?.nickname || inst.instanceUuid}`,
  }));

  const handleSelect = (e) => {
    const uuid = e.target.value;
    const inst = allInstances.find((item) => item.instanceUuid === uuid);
    setSelectedInstance(inst || null);
  };

  useEffect(() => {
    if (selectedInstance) {
      fetchFiles(selectedInstance.instanceUuid, selectedInstance.daemonId, "/");
    }
  }, [selectedInstance, fetchFiles]);

  const navigateTo = (path) => {
    if (!selectedInstance) return;
    fetchFiles(selectedInstance.instanceUuid, selectedInstance.daemonId, path);
  };

  const breadcrumbs = currentPath.split("/").filter(Boolean);

  const handleOpenFile = (item) => {
    if (item.type === 0) {
      // directory
      const next = currentPath === "/" ? `/${item.name}` : `${currentPath}/${item.name}`;
      navigateTo(next);
    } else {
      // file - open editor
      const target = currentPath === "/" ? `/${item.name}` : `${currentPath}/${item.name}`;
      setEditTarget({ name: item.name, target });
      setEditorOpen(true);
    }
  };

  const handleDelete = (item) => {
    if (!selectedInstance) return;
    const target = currentPath === "/" ? `/${item.name}` : `${currentPath}/${item.name}`;
    deleteFiles(selectedInstance.instanceUuid, selectedInstance.daemonId, [target]).then(() =>
      fetchFiles(selectedInstance.instanceUuid, selectedInstance.daemonId, currentPath)
    );
  };

  const handleCreate = async (type) => {
    if (!selectedInstance || !newItemName.trim()) return;
    const target = currentPath === "/" ? `/${newItemName}` : `${currentPath}/${newItemName}`;
    try {
      if (type === "dir") {
        await createDir(selectedInstance.instanceUuid, selectedInstance.daemonId, target);
      } else {
        await createFile(selectedInstance.instanceUuid, selectedInstance.daemonId, target);
      }
      setNewItemName("");
      setShowNewInput(null);
      fetchFiles(selectedInstance.instanceUuid, selectedInstance.daemonId, currentPath);
    } catch {
      // error handled in hook
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <ContentFieldLabel className="mb-1">
          {t("admin.mcsm.files.selectInstance")}
        </ContentFieldLabel>
        <ContentSelectInput
          value={selectedInstance?.instanceUuid || ""}
          onChange={handleSelect}
          className="w-full md:w-80"
        >
          <option value="">{t("admin.mcsm.console.selectPlaceholder")}</option>
          {allInstances.map((inst) => (
            <option key={inst.instanceUuid} value={inst.instanceUuid}>
              {inst.label}
            </option>
          ))}
        </ContentSelectInput>
      </div>

      {selectedInstance ? (
        <>
          {/* Breadcrumbs */}
          <div className="flex items-center gap-1 text-sm text-slate-600 flex-wrap">
            <ContentTextButton
              onClick={() => navigateTo("/")}
              className="font-medium hover:text-[var(--color-brand-blue)]"
            >
              /
            </ContentTextButton>
            {breadcrumbs.map((part, i) => {
              const path = `/${breadcrumbs.slice(0, i + 1).join("/")}`;
              return (
                <span key={path} className="flex items-center gap-1">
                  <ChevronRight className="w-3 h-3" />
                  <ContentTextButton
                    onClick={() => navigateTo(path)}
                    className="hover:text-[var(--color-brand-blue)]"
                  >
                    {part}
                  </ContentTextButton>
                </span>
              );
            })}
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2 flex-wrap">
            <ContentInlineActionButton
              type="button"
              onClick={() => setShowNewInput(showNewInput === "dir" ? null : "dir")}
              tone="neutral"
              icon={Plus}
              iconSize={14}
            >
              {t("admin.mcsm.files.newFolder")}
            </ContentInlineActionButton>
            <ContentInlineActionButton
              type="button"
              onClick={() => setShowNewInput(showNewInput === "file" ? null : "file")}
              tone="neutral"
              icon={Plus}
              iconSize={14}
            >
              {t("admin.mcsm.files.newFile")}
            </ContentInlineActionButton>
          </div>

          {showNewInput ? (
            <div className="flex items-center gap-2 flex-wrap">
              <ContentTextInput
                type="text"
                value={newItemName}
                onChange={(e) => setNewItemName(e.target.value)}
                placeholder={
                  showNewInput === "dir"
                    ? t("admin.mcsm.files.folderName")
                    : t("admin.mcsm.files.fileName")
                }
                className="flex-1 min-w-[220px] max-w-xs px-3 py-1.5 text-sm"
                onKeyDown={(e) => e.key === "Enter" && handleCreate(showNewInput)}
              />
              <ContentPrimaryButton
                type="button"
                onClick={() => handleCreate(showNewInput)}
                className="px-3 py-1.5 text-xs"
              >
                {t("admin.mcsm.files.create")}
              </ContentPrimaryButton>
            </div>
          ) : null}

          {/* File list */}
          {filesLoading ? (
            <ContentStateBlock loading className="rounded-xl" />
          ) : (
            <div className="border border-slate-200 rounded-lg divide-y divide-slate-100">
              {currentPath !== "/" ? (
                <ContentTextButton
                  onClick={() => {
                    const parent = currentPath.split("/").slice(0, -1).join("/") || "/";
                    navigateTo(parent);
                  }}
                  className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50 text-sm text-slate-600"
                >
                  <Folder className="w-4 h-4 text-amber-500" />
                  <span>..</span>
                </ContentTextButton>
              ) : null}
              {(Array.isArray(files) ? files : []).map((item) => (
                <div
                  key={item.name}
                  className="flex items-center justify-between px-4 py-2.5 hover:bg-slate-50"
                >
                  <ContentTextButton
                    onClick={() => handleOpenFile(item)}
                    className="flex items-center gap-3 text-sm text-slate-700 flex-1 text-left min-w-0"
                  >
                    {item.type === 0 ? (
                      <Folder className="w-4 h-4 text-amber-500 flex-shrink-0" />
                    ) : (
                      <File className="w-4 h-4 text-slate-400 flex-shrink-0" />
                    )}
                    <span className="truncate">{item.name}</span>
                    {item.type !== 0 && item.size !== undefined ? (
                      <span className="text-xs text-slate-400 ml-auto">
                        {formatSize(item.size)}
                      </span>
                    ) : null}
                  </ContentTextButton>
                  <div className="flex items-center gap-1 ml-2">
                    {item.type !== 0 ? (
                      <ContentIconActionButton
                        onClick={() => handleOpenFile(item)}
                        tone="neutral"
                        icon={Edit3}
                        size="sm"
                        iconSize={14}
                        title={t("admin.mcsm.files.edit")}
                        aria-label={t("admin.mcsm.files.edit")}
                      />
                    ) : null}
                    <ContentIconActionButton
                      onClick={() => handleDelete(item)}
                      tone="danger"
                      icon={Trash2}
                      size="sm"
                      iconSize={14}
                      title={t("admin.mcsm.files.delete")}
                      aria-label={t("admin.mcsm.files.delete")}
                    />
                  </div>
                </div>
              ))}
              {!files || files.length === 0 ? (
                <p className="text-center py-6 text-sm text-slate-500">
                  {t("admin.mcsm.files.empty")}
                </p>
              ) : null}
            </div>
          )}
        </>
      ) : null}

      <MCSMFileEditor
        isOpen={editorOpen}
        fileName={editTarget?.name}
        uuid={selectedInstance?.instanceUuid}
        daemonId={selectedInstance?.daemonId}
        target={editTarget?.target}
        readFile={readFile}
        writeFile={writeFile}
        onClose={() => {
          setEditorOpen(false);
          setEditTarget(null);
        }}
      />
    </div>
  );
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
