import { useEffect, useState } from "react";
import type { CommitDetail, Stash } from "@shared/types";
import { api } from "../lib/api";
import { DiffView } from "../components/diff-view";
import { useStore } from "../store";

export function StashesTab() {
  const stashes = useStore((s) => s.stashes);
  const [focused, setFocused] = useState<Stash | null>(null);
  const [detail, setDetail] = useState<CommitDetail | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!focused) {
      setDetail(null);
      return;
    }
    setLoading(true);
    void api
      .commit(focused.sha)
      .then(setDetail)
      .finally(() => setLoading(false));
  }, [focused]);

  return (
    <div className="grid h-full grid-cols-[360px_1fr]">
      <div className="overflow-auto border-r border-neutral-200 dark:border-neutral-800">
        {stashes.length === 0 && (
          <p className="p-4 text-sm text-neutral-500">No stashes.</p>
        )}
        {stashes.map((s) => (
          <button
            key={s.index}
            onClick={() => setFocused(s)}
            className={`block w-full truncate px-3 py-2 text-left text-sm ${
              focused?.index === s.index
                ? "bg-blue-100 dark:bg-blue-900/40"
                : "hover:bg-neutral-100 dark:hover:bg-neutral-900"
            }`}
          >
            <div className="truncate font-medium">stash@{"{"}{s.index}{"}"}</div>
            <div className="truncate text-xs text-neutral-500">{s.message}</div>
          </button>
        ))}
      </div>
      <div className="overflow-auto">
        {loading && <div className="p-4 text-neutral-500">Loading stash…</div>}
        {!loading && detail &&
          detail.diff.map((d, i) => <DiffView key={`${detail.sha}-${i}`} diff={d} />)}
        {!loading && !detail && !focused && (
          <div className="p-4 text-neutral-500">Select a stash to view its diff.</div>
        )}
      </div>
    </div>
  );
}
