import { useMemo } from "react";
import { DiffView } from "../components/diff-view";
import { ListRow } from "../components/list-row";
import { useCommitDetail } from "../lib/use-commit-detail";
import { useStore } from "../store";

export function StashesTab() {
  const stashes = useStore((s) => s.stashes);
  const focusedIndex = useStore((s) => s.focusedStashIndex);
  const focusStash = useStore((s) => s.focusStash);
  const focused = useMemo(
    () =>
      focusedIndex !== null
        ? stashes.find((s) => s.index === focusedIndex) ?? null
        : null,
    [stashes, focusedIndex],
  );
  const { detail, loading } = useCommitDetail(focused?.sha ?? null);

  return (
    <div className="grid h-full grid-cols-[360px_1fr]">
      <div className="overflow-auto border-r border-border">
        {stashes.length === 0 && (
          <p className="p-4 text-sm text-fg-muted">No stashes.</p>
        )}
        {stashes.map((s) => (
          <ListRow
            key={s.index}
            selected={focusedIndex === s.index}
            onClick={() => focusStash(s.index)}
          >
            <div className="truncate font-medium">stash@{"{"}{s.index}{"}"}</div>
            <div className="truncate text-xs text-fg-subtle">{s.message}</div>
          </ListRow>
        ))}
      </div>
      <div className="overflow-auto">
        {loading && <div className="p-4 text-fg-muted">Loading stash…</div>}
        {!loading && detail &&
          detail.diff.map((d) => (
            <DiffView
              key={d.oldPath ? `${d.oldPath}->${d.path}` : d.path}
              diff={d}
            />
          ))}
        {!loading && !detail && !focused && (
          <div className="p-4 text-fg-muted">Select a stash to view its diff.</div>
        )}
      </div>
    </div>
  );
}
