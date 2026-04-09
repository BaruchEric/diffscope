import { useEffect, useState } from "react";
import type { Commit, CommitDetail } from "@shared/types";
import { api } from "../lib/api";
import { DiffView } from "../components/diff-view";

export function HistoryTab() {
  const [commits, setCommits] = useState<Commit[]>([]);
  const [focused, setFocused] = useState<string | null>(null);
  const [detail, setDetail] = useState<CommitDetail | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    void api.log(100, 0).then(setCommits);
  }, []);

  useEffect(() => {
    if (!focused) return;
    setLoading(true);
    void api
      .commit(focused)
      .then((d) => setDetail(d))
      .finally(() => setLoading(false));
  }, [focused]);

  return (
    <div className="grid h-full grid-cols-[380px_1fr]">
      <div className="overflow-auto border-r border-neutral-200 dark:border-neutral-800">
        {commits.map((c) => (
          <button
            key={c.sha}
            onClick={() => setFocused(c.sha)}
            className={`block w-full truncate px-3 py-2 text-left text-sm ${
              focused === c.sha
                ? "bg-blue-100 dark:bg-blue-900/40"
                : "hover:bg-neutral-100 dark:hover:bg-neutral-900"
            }`}
          >
            <div className="truncate font-medium">{c.subject}</div>
            <div className="truncate text-xs text-neutral-500">
              {c.shortSha} · {c.author} · {new Date(c.date).toLocaleString()}
            </div>
          </button>
        ))}
      </div>
      <div className="overflow-auto">
        {loading && <div className="p-4 text-neutral-500">Loading commit…</div>}
        {!loading && detail &&
          detail.diff.map((d, i) => <DiffView key={`${detail.sha}-${i}`} diff={d} />)}
        {!loading && !detail && (
          <div className="p-4 text-neutral-500">Select a commit to view its diff.</div>
        )}
      </div>
    </div>
  );
}
