import { useMemo, useState } from "react";
import type { Branch } from "@shared/types";
import { useStore } from "../store";
import { fuzzyFilter } from "../lib/fuzzy";

export function BranchesTab() {
  const branches = useStore((s) => s.branches);
  const focused = useStore((s) => s.focusedBranch);
  const focusBranch = useStore((s) => s.focusBranch);
  const [query, setQuery] = useState("");
  const selected = branches.find((b) => b.name === focused) ?? null;

  const filtered = useMemo(
    () => fuzzyFilter(branches, query, (b) => `${b.name} ${b.tipSubject}`),
    [branches, query],
  );

  const locals = filtered.filter((b) => !b.isRemote);
  const remotes = filtered.filter((b) => b.isRemote);

  return (
    <div className="grid h-full grid-cols-[320px_1fr]">
      <div className="flex flex-col border-r border-border">
        <div className="border-b border-border p-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search branches…"
            className="w-full rounded border border-border bg-surface px-2 py-1 text-sm text-fg focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent-soft"
          />
        </div>
        <div className="flex-1 overflow-auto">
          <BranchGroup label="Local" branches={locals} focused={focused} onFocus={focusBranch} />
          <BranchGroup label="Remotes" branches={remotes} focused={focused} onFocus={focusBranch} />
        </div>
      </div>
      <div className="overflow-auto p-6">
        {!selected && <p className="text-fg-muted">Select a branch to see its tip.</p>}
        {selected && (
          <div className="space-y-3">
            <h2 className="text-xl font-semibold text-fg">{selected.name}</h2>
            <div className="text-sm text-fg-muted">
              {selected.isCurrent && "current branch · "}
              {selected.upstream && `upstream: ${selected.upstream} · `}
              {selected.ahead > 0 && `↑${selected.ahead} `}
              {selected.behind > 0 && `↓${selected.behind}`}
            </div>
            <div className="rounded border border-border bg-surface p-4">
              <div className="font-mono text-xs text-fg-subtle">{selected.tipSha}</div>
              <div className="mt-1 text-fg">{selected.tipSubject}</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function BranchGroup({
  label,
  branches,
  focused,
  onFocus,
}: {
  label: string;
  branches: Branch[];
  focused: string | null;
  onFocus: (name: string) => void;
}) {
  if (branches.length === 0) return null;
  return (
    <div>
      <div className="sticky top-0 bg-bg-elevated px-3 py-1 text-xs font-medium uppercase tracking-wide text-fg-muted">
        {label} ({branches.length})
      </div>
      {branches.map((b) => (
        <button
          key={b.name}
          onClick={() => onFocus(b.name)}
          className={
            "block w-full truncate px-3 py-1.5 text-left text-sm border-l-2 " +
            (focused === b.name
              ? "bg-surface-hover text-fg border-accent"
              : "text-fg-muted hover:bg-surface-hover hover:text-fg border-transparent")
          }
        >
          {b.isCurrent && <span className="mr-1 text-diff-add-sign">●</span>}
          {b.name}
        </button>
      ))}
    </div>
  );
}
