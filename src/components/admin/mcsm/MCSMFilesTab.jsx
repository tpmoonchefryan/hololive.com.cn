import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Folder, File, ChevronRight, Trash2, Plus, Edit3, Loader2 } from "lucide-react";
import MCSMFileEditor from "./MCSMFileEditor";

export default function MCSMFilesTab({
    instances, fetchAllInstances, selectedInstance, setSelectedInstance,
    files, currentPath, filesLoading,
    fetchFiles, readFile, writeFile, createDir, createFile, deleteFiles,
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
        const inst = allInstances.find((i) => i.instanceUuid === uuid);
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
        deleteFiles(selectedInstance.instanceUuid, selectedInstance.daemonId, [target])
            .then(() => fetchFiles(selectedInstance.instanceUuid, selectedInstance.daemonId, currentPath));
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
                <label className="block text-sm font-medium text-slate-700 mb-1">
                    {t("admin.mcsm.files.selectInstance")}
                </label>
                <select
                    value={selectedInstance?.instanceUuid || ""}
                    onChange={handleSelect}
                    className="w-full md:w-80 px-3 py-2 border border-slate-300 rounded-lg"
                >
                    <option value="">{t("admin.mcsm.console.selectPlaceholder")}</option>
                    {allInstances.map((inst) => (
                        <option key={inst.instanceUuid} value={inst.instanceUuid}>
                            {inst.label}
                        </option>
                    ))}
                </select>
            </div>

            {selectedInstance && (
                <>
                    {/* Breadcrumbs */}
                    <div className="flex items-center gap-1 text-sm text-slate-600 flex-wrap">
                        <button onClick={() => navigateTo("/")} className="hover:text-blue-600 font-medium">/</button>
                        {breadcrumbs.map((part, i) => {
                            const path = "/" + breadcrumbs.slice(0, i + 1).join("/");
                            return (
                                <span key={path} className="flex items-center gap-1">
                                    <ChevronRight className="w-3 h-3" />
                                    <button onClick={() => navigateTo(path)} className="hover:text-blue-600">{part}</button>
                                </span>
                            );
                        })}
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => setShowNewInput(showNewInput === "dir" ? null : "dir")}
                            className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-slate-100 rounded-lg hover:bg-slate-200"
                        >
                            <Plus className="w-3.5 h-3.5" /> {t("admin.mcsm.files.newFolder")}
                        </button>
                        <button
                            onClick={() => setShowNewInput(showNewInput === "file" ? null : "file")}
                            className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-slate-100 rounded-lg hover:bg-slate-200"
                        >
                            <Plus className="w-3.5 h-3.5" /> {t("admin.mcsm.files.newFile")}
                        </button>
                    </div>

                    {showNewInput && (
                        <div className="flex items-center gap-2">
                            <input
                                type="text"
                                value={newItemName}
                                onChange={(e) => setNewItemName(e.target.value)}
                                placeholder={showNewInput === "dir" ? t("admin.mcsm.files.folderName") : t("admin.mcsm.files.fileName")}
                                className="flex-1 max-w-xs px-3 py-1.5 border border-slate-300 rounded-lg text-sm"
                                onKeyDown={(e) => e.key === "Enter" && handleCreate(showNewInput)}
                            />
                            <button
                                onClick={() => handleCreate(showNewInput)}
                                className="px-3 py-1.5 text-xs bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                            >
                                {t("admin.mcsm.files.create")}
                            </button>
                        </div>
                    )}

                    {/* File list */}
                    {filesLoading ? (
                        <div className="text-center py-8">
                            <Loader2 className="w-6 h-6 mx-auto animate-spin text-slate-400" />
                        </div>
                    ) : (
                        <div className="border border-slate-200 rounded-lg divide-y divide-slate-100">
                            {currentPath !== "/" && (
                                <button
                                    onClick={() => {
                                        const parent = currentPath.split("/").slice(0, -1).join("/") || "/";
                                        navigateTo(parent);
                                    }}
                                    className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50 text-sm text-slate-600"
                                >
                                    <Folder className="w-4 h-4 text-amber-500" />
                                    <span>..</span>
                                </button>
                            )}
                            {(Array.isArray(files) ? files : []).map((item) => (
                                <div key={item.name} className="flex items-center justify-between px-4 py-2.5 hover:bg-slate-50">
                                    <button
                                        onClick={() => handleOpenFile(item)}
                                        className="flex items-center gap-3 text-sm text-slate-700 flex-1 text-left"
                                    >
                                        {item.type === 0 ? (
                                            <Folder className="w-4 h-4 text-amber-500" />
                                        ) : (
                                            <File className="w-4 h-4 text-slate-400" />
                                        )}
                                        <span>{item.name}</span>
                                        {item.type !== 0 && item.size !== undefined && (
                                            <span className="text-xs text-slate-400 ml-auto">{formatSize(item.size)}</span>
                                        )}
                                    </button>
                                    <div className="flex items-center gap-1 ml-2">
                                        {item.type !== 0 && (
                                            <button onClick={() => handleOpenFile(item)} className="p-1 hover:bg-slate-200 rounded" title={t("admin.mcsm.files.edit")}>
                                                <Edit3 className="w-3.5 h-3.5 text-slate-500" />
                                            </button>
                                        )}
                                        <button onClick={() => handleDelete(item)} className="p-1 hover:bg-red-50 rounded" title={t("admin.mcsm.files.delete")}>
                                            <Trash2 className="w-3.5 h-3.5 text-red-500" />
                                        </button>
                                    </div>
                                </div>
                            ))}
                            {(!files || files.length === 0) && (
                                <p className="text-center py-6 text-sm text-slate-500">{t("admin.mcsm.files.empty")}</p>
                            )}
                        </div>
                    )}
                </>
            )}

            <MCSMFileEditor
                isOpen={editorOpen}
                fileName={editTarget?.name}
                uuid={selectedInstance?.instanceUuid}
                daemonId={selectedInstance?.daemonId}
                target={editTarget?.target}
                readFile={readFile}
                writeFile={writeFile}
                onClose={() => { setEditorOpen(false); setEditTarget(null); }}
            />
        </div>
    );
}

function formatSize(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
