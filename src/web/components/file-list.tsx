import { useEffect, useMemo, useState } from "react";
import type { FileChangeType, FileStatus, FsEntry } from "@shared/types";
import { useStore } from "../store";
import { useSettings } from "../settings";
import { fuzzyFilter } from "../lib/fuzzy";
import { FileTree } from "./file-tree";
import { FileExplorer } from "./file-explorer";

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
  const exploreEntries = useStore((s) => s.exploreEntries);
  const exploreFocusedPath = useStore((s) => s.exploreFocusedPath);
  const focusExploreFile = useStore((s) => s.focusExploreFile);
  const loadExploreEntries = useStore((s) => s.loadExploreEntries);
  const fileListMode = useSettings((s) => s.fileListMode);
  const workingTreeMode = useSettings((s) => s.workingTreeMode);
  const hideIgnored = useSettings((s) => s.hideIgnored);
  const setSettings = useSettings((s) => s.set);
  const [filter, setFilter] = useState("");

  useEffect(() => {
    if (workingTreeMode === "explore") {
      void loadExploreEntries(hideIgnored);
    }
  }, [workingTreeMode, hideIgnored, loadExploreEntries]);

  // Filter the full flat list once, then group. Previously we ran
  // fuzzyFilter three times (one per group), which scored every file three
  // times per keystroke.
  const groups = useMemo(() => {
    const filtered = filter
      ? fuzzyFilter(status, filter, (f) => f.path)
      : status;
    return group(filtered);
  }, [status, filter]);

  const filteredExploreEntries = useMemo<FsEntry[]>(() => {
    if (!filter) return exploreEntries;
    const files = exploreEntries.filter((e) => !e.isDir);
    const matched = fuzzyFilter(files, filter, (f) => f.path);
    const keep = new Set(matched.map((m) => m.path));
    for (const m of matched) {
      const parts = m.path.split("/");
      for (let i = 1; i < parts.length; i++) keep.add(parts.slice(0, i).join("/"));
    }
    return exploreEntries.filter((e) => keep.has(e.path));
  }, [exploreEntries, filter]);

  return (
    <div className="flex h-full flex-col border-r border-border">
      <div className="border-b border-border p-2">
        <div className="mb-2 flex items-center gap-1">
          <div role="tablist" className="flex rounded bg-surface-hover p-0.5">
            <button
              role="tab"
              aria-selected={workingTreeMode === "changes"}
              onClick={() => setSettings({ workingTreeMode: "changes" })}
              title="Changes"
              className={
                "rounded px-2 text-xs " +
                (workingTreeMode === "changes"
                  ? "bg-bg text-fg shadow-sm"
                  : "text-fg-muted hover:text-fg")
              }
            >
              Changes
            </button>
            <button
              role="tab"
              aria-selected={workingTreeMode === "explore"}
              onClick={() => setSettings({ workingTreeMode: "explore" })}
              title="Explore (full repo)"
              className={
                "rounded px-2 text-xs " +
                (workingTreeMode === "explore"
                  ? "bg-bg text-fg shadow-sm"
                  : "text-fg-muted hover:text-fg")
              }
            >
              Explore
            </button>
          </div>
          {workingTreeMode === "changes" && (
            <>
              <button
                onClick={() => setSettings({ fileListMode: "flat" })}
                title="Flat list"
                aria-pressed={fileListMode === "flat"}
                className={
                  "ml-2 rounded px-1 text-xs " +
                  (fileListMode === "flat"
                    ? "bg-surface-hover text-fg"
                    : "text-fg-muted hover:bg-surface-hover hover:text-fg")
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
                    ? "bg-surface-hover text-fg"
                    : "text-fg-muted hover:bg-surface-hover hover:text-fg")
                }
              >
                ▾
              </button>
            </>
          )}
          {workingTreeMode === "explore" && (
            <button
              onClick={() => setSettings({ hideIgnored: !hideIgnored })}
              title={hideIgnored ? "Show ignored files" : "Hide ignored files"}
              aria-pressed={hideIgnored}
              className={
                "ml-2 rounded px-1 text-xs " +
                (hideIgnored
                  ? "bg-surface-hover text-fg"
                  : "text-fg-muted hover:bg-surface-hover hover:text-fg")
              }
            >
              {hideIgnored ? "◐" : "◑"}
            </button>
          )}
        </div>
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter files… (/)"
          className="w-full rounded border border-border bg-surface px-2 py-1 text-sm text-fg focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent-soft"
          data-filter-input
        />
      </div>
      <div className="flex-1 overflow-auto">
        {workingTreeMode === "explore" ? (
          <FileExplorer
            entries={filteredExploreEntries}
            focusedPath={exploreFocusedPath}
            onFileClick={(p) => void focusExploreFile(p)}
          />
        ) : fileListMode === "tree" ? (
          <FileTree
            files={status}
            focusedPath={focusedPath}
            onFileClick={(p) => void focusFile(p)}
          />
        ) : (
          groups.map((g) =>
            g.files.length === 0 ? null : (
              <div key={g.kind}>
                <div className="sticky top-0 bg-bg-elevated px-2 py-1 text-xs font-medium uppercase tracking-wide text-fg-muted">
                  {g.label} ({g.files.length})
                </div>
                {g.files.map((f) => (
                  <button
                    key={`${g.kind}-${f.path}`}
                    onClick={() => void focusFile(f.path)}
                    className={
                      "flex w-full items-center gap-2 truncate px-2 py-1 text-left text-sm border-l-2 " +
                      (focusedPath === f.path
                        ? "bg-surface-hover text-fg border-accent"
                        : "text-fg-muted hover:bg-surface-hover hover:text-fg border-transparent")
                    }
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
        <span className="text-diff-add-sign">+{file.added}</span>
      )}
      {file.added !== undefined && file.added > 0 && file.deleted !== undefined && file.deleted > 0 && " "}
      {file.deleted !== undefined && file.deleted > 0 && (
        <span className="text-diff-del-sign">−{file.deleted}</span>
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
  // Staged rows render in neutral fg (matches the status-bar staged convention).
  // Otherwise: add/del use diff-sign colors, rename and modify share the accent.
  const color =
    groupKind === "staged"
      ? "text-fg"
      : change === "added"
        ? "text-diff-add-sign"
        : change === "deleted"
          ? "text-diff-del-sign"
          : "text-accent";
  return <span className={`font-mono text-xs ${color}`}>{letter}</span>;
}
