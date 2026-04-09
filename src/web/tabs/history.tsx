import { useCallback, useEffect, useMemo, useState } from "react";
import { fuzzyFilter } from "../lib/fuzzy";
import { useCommitDetail } from "../lib/use-commit-detail";
import { DiffView } from "../components/diff-view";
import { PaneSplit } from "../components/pane-split";
import { ListRow } from "../components/list-row";
import { useStore } from "../store";

export function HistoryTab() {
  const log = useStore((s) => s.log);
  const loadLog = useStore((s) => s.loadLog);
  const focused = useStore((s) => s.focusedCommitSha);
  const focusCommit = useStore((s) => s.focusCommit);
  const [query, setQuery] = useState("");
  const [detailCollapsed, setDetailCollapsed] = useState(false);
  const [collapsedFiles, setCollapsedFiles] = useState<Set<string>>(
    () => new Set(),
  );

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

  // Reset per-file collapse state when the focused commit changes. Keying
  // the effect on the sha (not the whole detail object) avoids unrelated
  // resets when the commit refetches with the same sha.
  useEffect(() => {
    setCollapsedFiles(new Set());
  }, [detail?.sha]);

  const toggleFileCollapsed = useCallback((path: string) => {
    setCollapsedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const collapseAll = useCallback(() => {
    if (!detail) return;
    setCollapsedFiles(new Set(detail.diff.map((d) => d.path)));
  }, [detail]);

  const expandAll = useCallback(() => {
    setCollapsedFiles(new Set());
  }, []);

  const detailHeader = detail && (
    <div className="flex h-full min-h-0 flex-col border-b border-border bg-bg-elevated">
      <div className="flex shrink-0 items-start gap-2 px-4 pt-3">
        <button
          onClick={() => setDetailCollapsed((v) => !v)}
          className="mt-0.5 rounded px-1 text-xs text-fg-muted hover:bg-surface-hover hover:text-fg"
          title={detailCollapsed ? "Expand details" : "Collapse details"}
          aria-expanded={!detailCollapsed}
        >
          {detailCollapsed ? "▸" : "▾"}
        </button>
        <div className="min-w-0 flex-1 truncate text-base font-semibold text-fg">
          {detail.subject}
        </div>
      </div>
      {!detailCollapsed && detail.body && (
        <pre className="mx-4 mt-2 min-h-0 flex-1 overflow-auto whitespace-pre-wrap rounded border border-border bg-surface p-2 text-xs text-fg-muted">
          {detail.body}
        </pre>
      )}
      <div className="flex shrink-0 items-center gap-3 px-4 pb-3 pt-2 text-xs text-fg-muted">
        <button
          onClick={() => void navigator.clipboard.writeText(detail.sha)}
          className="rounded bg-surface px-2 py-0.5 font-mono text-fg hover:bg-surface-hover"
          title="Copy full SHA"
        >
          {detail.shortSha}
        </button>
        <span>{detail.author}</span>
        <span>{new Date(detail.date).toLocaleString()}</span>
        <div className="ml-auto flex items-center gap-1">
          <button
            onClick={collapseAll}
            className="rounded px-2 py-0.5 hover:bg-surface-hover hover:text-fg"
            title="Collapse all files"
          >
            Collapse all
          </button>
          <button
            onClick={expandAll}
            className="rounded px-2 py-0.5 hover:bg-surface-hover hover:text-fg"
            title="Expand all files"
          >
            Expand all
          </button>
        </div>
      </div>
    </div>
  );

  const diffSection = (
    <div className="h-full overflow-auto">
      {loading && <div className="p-4 text-fg-muted">Loading commit…</div>}
      {!loading && detail &&
        detail.diff.map((d) => (
          <DiffView
            key={d.oldPath ? `${d.oldPath}->${d.path}` : d.path}
            diff={d}
            collapsed={collapsedFiles.has(d.path)}
            onToggleCollapsed={() => toggleFileCollapsed(d.path)}
          />
        ))}
      {!loading && !detail && (
        <div className="p-4 text-fg-muted">Select a commit to view its diff.</div>
      )}
    </div>
  );

  return (
    <div className="grid h-full grid-cols-[220px_1fr] min-[900px]:grid-cols-[300px_1fr] min-[1200px]:grid-cols-[380px_1fr]">
      <div className="flex min-w-0 flex-col border-r border-border">
        <div className="border-b border-border p-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search commits…"
            className="w-full rounded border border-border bg-surface px-2 py-1 text-sm text-fg focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent-soft"
          />
        </div>
        <div className="flex-1 overflow-auto">
          {filtered.length === 0 && (
            <p className="p-3 text-xs text-fg-muted">No commits match.</p>
          )}
          {filtered.map((c) => (
            <ListRow
              key={c.sha}
              selected={focused === c.sha}
              onClick={() => void focusCommit(c.sha)}
            >
              <div className="truncate font-medium">{c.subject}</div>
              <div className="truncate text-xs text-fg-subtle">
                {c.shortSha} · {c.author} · {new Date(c.date).toLocaleString()}
              </div>
            </ListRow>
          ))}
        </div>
      </div>
      <div className="flex min-h-0 flex-col overflow-hidden">
        {detail ? (
          <PaneSplit axis="y" a={detailHeader} b={diffSection} />
        ) : (
          diffSection
        )}
      </div>
    </div>
  );
}
