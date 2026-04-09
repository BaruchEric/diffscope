import { useMemo, useState } from "react";
import type { FileStatus } from "@shared/types";
import { useStore } from "../store";
import { useSettings } from "../settings";
import { FileTree } from "./file-tree";

interface Group {
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
    { label: "Staged", files: staged },
    { label: "Unstaged", files: unstaged },
    { label: "Untracked", files: untracked },
  ];
}

/**
 * Tiny fuzzy matcher: returns a score (higher = better) if every character of
 * `needle` appears in order in `haystack`, otherwise null. Adjacent matches
 * and matches after a path separator score higher to bias toward filename
 * hits over deep-path noise.
 */
function fuzzyScore(haystack: string, needle: string): number | null {
  if (!needle) return 0;
  const h = haystack.toLowerCase();
  const n = needle.toLowerCase();
  let hi = 0;
  let score = 0;
  let lastMatch = -2;
  for (let i = 0; i < n.length; i++) {
    const c = n[i]!;
    const found = h.indexOf(c, hi);
    if (found < 0) return null;
    // Adjacency bonus
    if (found === lastMatch + 1) score += 5;
    // Boundary bonus (after / or - or _ or .)
    const prev = found > 0 ? h[found - 1] : "/";
    if (prev === "/" || prev === "-" || prev === "_" || prev === ".") score += 3;
    score += 1;
    lastMatch = found;
    hi = found + 1;
  }
  // Slight bonus for shorter haystacks
  return score - haystack.length * 0.05;
}

function filterAndRank(files: FileStatus[], query: string): FileStatus[] {
  if (!query) return files;
  const scored: { file: FileStatus; score: number }[] = [];
  for (const f of files) {
    const score = fuzzyScore(f.path, query);
    if (score !== null) scored.push({ file: f, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.map((s) => s.file);
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
        files: filterAndRank(grp.files, filter),
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
              <div key={g.label}>
                <div className="sticky top-0 bg-neutral-100 px-2 py-1 text-xs font-medium uppercase tracking-wide text-neutral-500 dark:bg-neutral-900">
                  {g.label} ({g.files.length})
                </div>
                {g.files.map((f) => (
                  <button
                    key={`${g.label}-${f.path}`}
                    onClick={() => void focusFile(f.path)}
                    className={`flex w-full items-center gap-2 truncate px-2 py-1 text-left text-sm ${
                      focusedPath === f.path
                        ? "bg-blue-100 dark:bg-blue-900/40"
                        : "hover:bg-neutral-100 dark:hover:bg-neutral-900"
                    }`}
                  >
                    <ChangeBadge file={f} group={g.label} />
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

function ChangeBadge({ file, group }: { file: FileStatus; group: string }) {
  const change =
    group === "Staged"
      ? file.staged
      : group === "Unstaged"
        ? file.unstaged
        : "added";
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
