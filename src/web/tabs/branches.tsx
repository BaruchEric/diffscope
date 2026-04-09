import { useMemo, useState } from "react";
import type { Branch } from "@shared/types";
import { useStore } from "../store";

export function BranchesTab() {
  const branches = useStore((s) => s.branches);
  const [focused, setFocused] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const selected = branches.find((b) => b.name === focused) ?? null;

  const filtered = useMemo(() => {
    if (!query) return branches;
    const q = query.toLowerCase();
    return branches.filter(
      (b) => b.name.toLowerCase().includes(q) || b.tipSubject.toLowerCase().includes(q),
    );
  }, [branches, query]);

  const locals = filtered.filter((b) => !b.isRemote);
  const remotes = filtered.filter((b) => b.isRemote);

  return (
    <div className="grid h-full grid-cols-[320px_1fr]">
      <div className="flex flex-col border-r border-neutral-200 dark:border-neutral-800">
        <div className="border-b border-neutral-200 p-2 dark:border-neutral-800">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search branches…"
            className="w-full rounded border border-neutral-300 bg-white px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-900"
          />
        </div>
        <div className="flex-1 overflow-auto">
          <BranchGroup label="Local" branches={locals} focused={focused} onFocus={setFocused} />
          <BranchGroup label="Remotes" branches={remotes} focused={focused} onFocus={setFocused} />
        </div>
      </div>
      <div className="overflow-auto p-6">
        {!selected && <p className="text-neutral-500">Select a branch to see its tip.</p>}
        {selected && (
          <div className="space-y-3">
            <h2 className="text-xl font-semibold">{selected.name}</h2>
            <div className="text-sm text-neutral-500">
              {selected.isCurrent && "current branch · "}
              {selected.upstream && `upstream: ${selected.upstream} · `}
              {selected.ahead > 0 && `↑${selected.ahead} `}
              {selected.behind > 0 && `↓${selected.behind}`}
            </div>
            <div className="rounded border border-neutral-200 p-4 dark:border-neutral-800">
              <div className="font-mono text-xs text-neutral-500">{selected.tipSha}</div>
              <div className="mt-1">{selected.tipSubject}</div>
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
      <div className="sticky top-0 bg-neutral-100 px-3 py-1 text-xs font-medium uppercase tracking-wide text-neutral-500 dark:bg-neutral-900">
        {label} ({branches.length})
      </div>
      {branches.map((b) => (
        <button
          key={b.name}
          onClick={() => onFocus(b.name)}
          className={`block w-full truncate px-3 py-1.5 text-left text-sm ${
            focused === b.name
              ? "bg-blue-100 dark:bg-blue-900/40"
              : "hover:bg-neutral-100 dark:hover:bg-neutral-900"
          }`}
        >
          {b.isCurrent && <span className="mr-1 text-green-600">●</span>}
          {b.name}
        </button>
      ))}
    </div>
  );
}
