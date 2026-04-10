import { useStore } from "../store";
import { useSettings } from "../settings";
import { useTerminalStore } from "../terminal/terminal-store";

export function StatusBar() {
  const repo = useStore((s) => s.repo);
  const staged = useStore((s) => s.status.filter((f) => !f.isUntracked && f.staged).length);
  const unstaged = useStore((s) => s.status.filter((f) => !f.isUntracked && f.unstaged).length);
  const untracked = useStore((s) => s.status.filter((f) => f.isUntracked).length);
  const current = useStore((s) => s.branches.find((b) => b.isCurrent));
  const watcherDown = useStore((s) => s.watcherDown);
  const viewingFile = useStore((s) => s.viewingFile);
  const focusedDiff = useStore((s) => s.focusedDiff);
  const paused = useStore((s) => s.paused);
  const terminalCount = useTerminalStore((s) => s.terminals.length);
  const drawerOpen = useSettings((s) => s.terminalDrawerOpen);
  const toggleDrawer = () => {
    useSettings.getState().set({ terminalDrawerOpen: !drawerOpen });
  };

  return (
    <footer className="flex h-6 items-center gap-3 border-t border-border bg-bg-elevated px-3 text-[11px] text-fg-muted">
      <span className="flex items-center gap-1">
        <span
          className={`live-dot inline-block h-1.5 w-1.5 rounded-full bg-accent ${
            paused || watcherDown ? "paused opacity-50" : ""
          }`}
        />
        {watcherDown ? "live updates off" : "live"}
      </span>
      {current && (
        <span>
          ⎇ {current.name}
          {current.upstream && (
            <span className="ml-1 text-fg-subtle">
              {current.ahead > 0 && ` ↑${current.ahead}`}
              {current.behind > 0 && ` ↓${current.behind}`}
            </span>
          )}
        </span>
      )}
      <span className="text-fg-subtle">
        {staged > 0 && <span className="text-fg">+{staged} staged</span>}
        {staged > 0 && (unstaged > 0 || untracked > 0) && " · "}
        {unstaged > 0 && <span className="text-accent">{unstaged} unstaged</span>}
        {unstaged > 0 && untracked > 0 && " · "}
        {untracked > 0 && <span className="text-diff-add-sign">{untracked} untracked</span>}
        {staged === 0 && unstaged === 0 && untracked === 0 && "clean"}
      </span>
      {viewingFile && !focusedDiff && (
        <span className="text-fg-muted">
          viewing: <span className="text-fg">{viewingFile.path}</span>
          {viewingFile.contents.kind !== "text" && (
            <> · <span>{viewingFile.contents.kind}</span></>
          )}
          {" "}· read-only
        </span>
      )}
      <div className="ml-auto flex items-center gap-2">
        <span className="truncate font-mono text-fg-subtle">
          {repo?.headSha?.slice(0, 7)}
        </span>
        {(terminalCount > 0 || drawerOpen) && (
          <button
            onClick={toggleDrawer}
            title={`Terminal (${terminalCount} open)`}
            aria-label="Toggle terminal drawer"
            className={`flex items-center gap-1 rounded px-1 ${
              drawerOpen ? "text-accent" : "text-fg-muted hover:text-fg"
            }`}
          >
            <span>⌨</span>
            <span className="tabular-nums">{terminalCount}</span>
          </button>
        )}
        <button
          onClick={() => useStore.getState().openSettings()}
          title="Settings (,)"
          aria-label="Open settings"
          className="text-fg-muted hover:text-fg"
        >
          ⚙
        </button>
      </div>
    </footer>
  );
}
