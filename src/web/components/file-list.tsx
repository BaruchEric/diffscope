import { useMemo, useState } from "react";
import type { FileStatus } from "@shared/types";
import { useStore } from "../store";

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

export function FileList() {
  const status = useStore((s) => s.status);
  const focusedPath = useStore((s) => s.focusedPath);
  const focusFile = useStore((s) => s.focusFile);
  const [filter, setFilter] = useState("");

  const groups = useMemo(() => {
    const g = group(status);
    if (!filter) return g;
    return g.map((grp) => ({
      ...grp,
      files: grp.files.filter((f) =>
        f.path.toLowerCase().includes(filter.toLowerCase()),
      ),
    }));
  }, [status, filter]);

  return (
    <div className="flex h-full flex-col border-r border-neutral-200 dark:border-neutral-800">
      <div className="border-b border-neutral-200 p-2 dark:border-neutral-800">
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter files… (/)"
          className="w-full rounded border border-neutral-300 bg-white px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-900"
          data-filter-input
        />
      </div>
      <div className="flex-1 overflow-auto">
        {groups.map((g) =>
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
                  <span className="truncate">{f.path}</span>
                </button>
              ))}
            </div>
          ),
        )}
      </div>
    </div>
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
