import { useMemo, useState } from "react";
import type { FileChangeType, FileStatus } from "@shared/types";
import { useStore } from "../store";
import { useSettings } from "../settings";
import { fuzzyFilter } from "../lib/fuzzy";
import { FileTree } from "./file-tree";

type GroupKind = "staged" | "unstaged" | "untracked";
interface Group {
  kind: GroupKind;
  label: string;
  files: FileStatus[];
}

function group(status: FileStatus[]): Group[] {
  const staged: FileStatus[] = [];
  const unstaged: FileStatus[] = [];
  const untracked: FileStatus[] = [];
  for (const f of status) {
    if (f.isUntracked) untracked.push(f);
    else {
      if (f.staged) staged.push(f);
      if (f.unstaged) unstaged.push(f);
    }
  }
  return [
    { kind: "staged", label: "Staged", files: staged },
    { kind: "unstaged", label: "Unstaged", files: unstaged },
    { kind: "untracked", label: "Untracked", files: untracked },
  ];
}

export function FileList() {
  const status = useStore((s) => s.status);
  const focusedPath = useStore((s) => s.focusedPath);
  const focusFile = useStore((s) => s.focusFile);
  const fileListMode = useSettings((s) => s.fileListMode);
  const setSettings = useSettings((s) => s.set);
  const [filter, setFilter] = useState("");

  const groups = useMemo(
    () =>
      group(status).map((grp) => ({
        ...grp,
        files: fuzzyFilter(grp.files, filter, (f) => f.path),
      })),
    [status, filter],
  );

  return (
    <div className="flex h-full flex-col border-r border-neutral-200 dark:border-neutral-800">
      <div className="border-b border-neutral-200 p-2 dark:border-neutral-800">
        <div className="mb-2 flex items-center gap-1">
          <button
            onClick={() => setSettings({ fileListMode: "flat" })}
            title="Flat list"
            aria-pressed={fileListMode === "flat"}
            className={
              "rounded px-1 text-xs " +
              (fileListMode === "flat"
                ? "bg-neutral-200 dark:bg-neutral-700"
                : "hover:bg-neutral-100 dark:hover:bg-neutral-800")
            }
          >
            ☰
          </button>
          <button
            onClick={() => setSettings({ fileListMode: "tree" })}
            title="Tree view"
            aria-pressed={fileListMode === "tree"}
            className={
              "rounded px-1 text-xs " +
              (fileListMode === "tree"
                ? "bg-neutral-200 dark:bg-neutral-700"
                : "hover:bg-neutral-100 dark:hover:bg-neutral-800")
            }
          >
            ▾
          </button>
        </div>
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter files… (/)"
          className="w-full rounded border border-neutral-300 bg-white px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-900"
          data-filter-input
        />
      </div>
      <div className="flex-1 overflow-auto">
        {fileListMode === "tree" ? (
          <FileTree
            files={status}
            focusedPath={focusedPath}
            onFileClick={(p) => void focusFile(p)}
          />
        ) : (
          groups.map((g) =>
            g.files.length === 0 ? null : (
              <div key={g.kind}>
                <div className="sticky top-0 bg-neutral-100 px-2 py-1 text-xs font-medium uppercase tracking-wide text-neutral-500 dark:bg-neutral-900">
                  {g.label} ({g.files.length})
                </div>
                {g.files.map((f) => (
                  <button
                    key={`${g.kind}-${f.path}`}
                    onClick={() => void focusFile(f.path)}
                    className={`flex w-full items-center gap-2 truncate px-2 py-1 text-left text-sm ${
                      focusedPath === f.path
                        ? "bg-blue-100 dark:bg-blue-900/40"
                        : "hover:bg-neutral-100 dark:hover:bg-neutral-900"
                    }`}
                  >
                    <ChangeBadge file={f} groupKind={g.kind} />
                    <span className="flex-1 truncate">{f.path}</span>
                    <DiffStats file={f} />
                  </button>
                ))}
              </div>
            ),
          )
        )}
      </div>
    </div>
  );
}

function DiffStats({ file }: { file: FileStatus }) {
  if (file.added === undefined && file.deleted === undefined) return null;
  if ((file.added ?? 0) === 0 && (file.deleted ?? 0) === 0) return null;
  return (
    <span className="shrink-0 font-mono text-[11px] tabular-nums">
      {file.added !== undefined && file.added > 0 && (
        <span className="text-green-600 dark:text-green-400">+{file.added}</span>
      )}
      {file.added !== undefined && file.added > 0 && file.deleted !== undefined && file.deleted > 0 && " "}
      {file.deleted !== undefined && file.deleted > 0 && (
        <span className="text-red-600 dark:text-red-400">−{file.deleted}</span>
      )}
    </span>
  );
}

function ChangeBadge({
  file,
  groupKind,
}: {
  file: FileStatus;
  groupKind: GroupKind;
}) {
  const change: FileChangeType | null =
    groupKind === "staged" ? file.staged : groupKind === "unstaged" ? file.unstaged : "added";
  const letter =
    change === "added"
      ? "A"
      : change === "deleted"
        ? "D"
        : change === "renamed"
          ? "R"
          : "M";
  const color =
    change === "added"
      ? "text-green-600"
      : change === "deleted"
        ? "text-red-600"
        : change === "renamed"
          ? "text-purple-600"
          : "text-amber-600";
  return <span className={`font-mono text-xs ${color}`}>{letter}</span>;
}
