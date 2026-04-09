import { DiffView } from "../components/diff-view";
import { useCommitDetail } from "../lib/use-commit-detail";
import { useStore } from "../store";

export function StashesTab() {
  const stashes = useStore((s) => s.stashes);
  const focusedIndex = useStore((s) => s.focusedStashIndex);
  const focusStash = useStore((s) => s.focusStash);
  const focused =
    focusedIndex !== null ? stashes.find((s) => s.index === focusedIndex) ?? null : null;
  const { detail, loading } = useCommitDetail(focused?.sha ?? null);

  return (
    <div className="grid h-full grid-cols-[360px_1fr]">
      <div className="overflow-auto border-r border-border">
        {stashes.length === 0 && (
          <p className="p-4 text-sm text-fg-muted">No stashes.</p>
        )}
        {stashes.map((s) => (
          <button
            key={s.index}
            onClick={() => focusStash(s.index)}
            className={
              "block w-full truncate px-3 py-2 text-left text-sm border-l-2 " +
              (focusedIndex === s.index
                ? "bg-surface-hover text-fg border-accent"
                : "text-fg-muted hover:bg-surface-hover hover:text-fg border-transparent")
            }
          >
            <div className="truncate font-medium">stash@{"{"}{s.index}{"}"}</div>
            <div className="truncate text-xs text-fg-subtle">{s.message}</div>
          </button>
        ))}
      </div>
      <div className="overflow-auto">
        {loading && <div className="p-4 text-fg-muted">Loading stash…</div>}
        {!loading && detail &&
          detail.diff.map((d, i) => <DiffView key={`${detail.sha}-${i}`} diff={d} />)}
        {!loading && !detail && !focused && (
          <div className="p-4 text-fg-muted">Select a stash to view its diff.</div>
        )}
      </div>
    </div>
  );
}
