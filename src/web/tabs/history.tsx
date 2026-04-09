import { useEffect, useMemo, useState } from "react";
import type { Commit, CommitDetail } from "@shared/types";
import { api } from "../lib/api";
import { DiffView } from "../components/diff-view";

export function HistoryTab() {
  const [commits, setCommits] = useState<Commit[]>([]);
  const [focused, setFocused] = useState<string | null>(null);
  const [detail, setDetail] = useState<CommitDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");

  useEffect(() => {
    void api.log(200, 0).then(setCommits);
  }, []);

  const filtered = useMemo(() => {
    if (!query) return commits;
    const q = query.toLowerCase();
    return commits.filter(
      (c) =>
        c.subject.toLowerCase().includes(q) ||
        c.body.toLowerCase().includes(q) ||
        c.author.toLowerCase().includes(q) ||
        c.shortSha.startsWith(q),
    );
  }, [commits, query]);

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
      <div className="flex flex-col border-r border-neutral-200 dark:border-neutral-800">
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
      </div>
      <div className="flex flex-col overflow-hidden">
        {detail && (
          <div className="border-b border-neutral-200 bg-neutral-50 p-4 dark:border-neutral-800 dark:bg-neutral-900">
            <div className="mb-1 text-base font-semibold">{detail.subject}</div>
            {detail.body && (
              <pre className="mb-2 whitespace-pre-wrap text-xs text-neutral-700 dark:text-neutral-300">
                {detail.body}
              </pre>
            )}
            <div className="flex items-center gap-3 text-xs text-neutral-500">
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
