import { useEffect, useMemo, useState } from "react";
import { fuzzyFilter } from "../lib/fuzzy";
import { useCommitDetail } from "../lib/use-commit-detail";
import { DiffView } from "../components/diff-view";
import { useStore } from "../store";

export function HistoryTab() {
  const log = useStore((s) => s.log);
  const loadLog = useStore((s) => s.loadLog);
  const focused = useStore((s) => s.focusedCommitSha);
  const focusCommit = useStore((s) => s.focusCommit);
  const [query, setQuery] = useState("");
  const [detailCollapsed, setDetailCollapsed] = useState(false);

  useEffect(() => {
    void loadLog();
  }, [loadLog]);

  const filtered = useMemo(
    () =>
      fuzzyFilter(
        log,
        query,
        (c) => `${c.shortSha} ${c.subject} ${c.author} ${c.body}`,
      ),
    [log, query],
  );

  const { detail, loading } = useCommitDetail(focused);

  return (
    <div className="grid h-full grid-cols-[220px_1fr] min-[900px]:grid-cols-[300px_1fr] min-[1200px]:grid-cols-[380px_1fr]">
      <div className="flex min-w-0 flex-col border-r border-neutral-200 dark:border-neutral-800">
        <div className="border-b border-neutral-200 p-2 dark:border-neutral-800">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search commits…"
            className="w-full rounded border border-neutral-300 bg-white px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-900"
          />
        </div>
        <div className="flex-1 overflow-auto">
          {filtered.length === 0 && (
            <p className="p-3 text-xs text-neutral-500">No commits match.</p>
          )}
          {filtered.map((c) => (
            <button
              key={c.sha}
              onClick={() => void focusCommit(c.sha)}
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
      </div>
      <div className="flex min-h-0 flex-col overflow-hidden">
        {detail && (
          <div className="flex shrink-0 flex-col border-b border-neutral-200 bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900">
            <div className="flex items-start gap-2 px-4 pt-3">
              <button
                onClick={() => setDetailCollapsed((v) => !v)}
                className="mt-0.5 rounded px-1 text-xs text-neutral-500 hover:bg-neutral-200 dark:hover:bg-neutral-800"
                title={detailCollapsed ? "Expand details" : "Collapse details"}
                aria-expanded={!detailCollapsed}
              >
                {detailCollapsed ? "▸" : "▾"}
              </button>
              <div className="min-w-0 flex-1 truncate text-base font-semibold">
                {detail.subject}
              </div>
            </div>
            {!detailCollapsed && detail.body && (
              <pre className="mx-4 mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded border border-neutral-200 bg-white p-2 text-xs text-neutral-700 dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-300">
                {detail.body}
              </pre>
            )}
            <div className="flex items-center gap-3 px-4 pb-3 pt-2 text-xs text-neutral-500">
              <button
                onClick={() => void navigator.clipboard.writeText(detail.sha)}
                className="rounded bg-neutral-200 px-2 py-0.5 font-mono hover:bg-neutral-300 dark:bg-neutral-800 dark:hover:bg-neutral-700"
                title="Copy full SHA"
              >
                {detail.shortSha}
              </button>
              <span>{detail.author}</span>
              <span>{new Date(detail.date).toLocaleString()}</span>
            </div>
          </div>
        )}
        <div className="flex-1 overflow-auto">
          {loading && <div className="p-4 text-neutral-500">Loading commit…</div>}
          {!loading && detail &&
            detail.diff.map((d, i) => <DiffView key={`${detail.sha}-${i}`} diff={d} />)}
          {!loading && !detail && (
            <div className="p-4 text-neutral-500">Select a commit to view its diff.</div>
          )}
        </div>
      </div>
    </div>
  );
}
