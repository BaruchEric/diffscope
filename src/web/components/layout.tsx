import type { ReactNode } from "react";
import { useStore, type Tab } from "../store";
import { useSettings } from "../settings";
import { StatusBar } from "./status-bar";
import { TerminalDrawerSlot } from "../terminal/terminal-drawer-slot";

const TABS: { key: Tab; label: string; shortLabel: string }[] = [
  { key: "working-tree", label: "Working Tree", shortLabel: "Working" },
  { key: "history", label: "History", shortLabel: "History" },
  { key: "branches", label: "Branches", shortLabel: "Branches" },
  { key: "stashes", label: "Stashes", shortLabel: "Stashes" },
];

export function Layout({ children }: { children: ReactNode }) {
  const tab = useSettings((s) => s.lastUsedTab);
  const setTab = (next: Tab) => useSettings.getState().set({ lastUsedTab: next });
  const paused = useStore((s) => s.paused);
  const togglePaused = useStore((s) => s.togglePaused);
  const watcherDown = useStore((s) => s.watcherDown);
  const repoRoot = useStore((s) => s.repo?.root ?? null);
  const diffMode = useSettings((s) => s.diffMode);
  const setDiffMode = (next: "unified" | "split") =>
    useSettings.getState().set({ diffMode: next });
  // Subscribe to scalar lengths instead of whole arrays so SSE ticks that
  // don't actually change counts don't re-render the header.
  const statusLen = useStore((s) => s.status.length);
  const branchesLen = useStore((s) => s.branches.length);
  const stashesLen = useStore((s) => s.stashes.length);

  const counts: Record<Tab, number> = {
    "working-tree": statusLen,
    history: 0,
    branches: branchesLen,
    stashes: stashesLen,
  };

  return (
    <div className="flex h-full flex-col">
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-border bg-bg-elevated px-3 py-2 sm:px-4">
        <div className="flex min-w-0 items-center gap-2 sm:gap-4">
          <span className="font-display text-[15px] font-medium tracking-tight text-fg">
            diff<span className="text-accent">·</span>scope
          </span>
          {repoRoot && (
            <span
              className="hidden min-w-0 truncate font-mono text-xs text-fg-subtle md:inline"
              title={repoRoot}
            >
              {shortenPath(repoRoot)}
            </span>
          )}
        </div>
        <nav className="order-last flex w-full gap-1 sm:order-none sm:w-auto">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex items-center gap-1.5 rounded px-2 py-1 text-sm sm:px-3 ${
                tab === t.key
                  ? "bg-accent text-accent-fg"
                  : "text-fg-muted hover:bg-surface-hover hover:text-fg"
              }`}
            >
              <span className="hidden sm:inline">{t.label}</span>
              <span className="sm:hidden">{t.shortLabel}</span>
              {counts[t.key] > 0 && t.key !== "history" && (
                <span
                  className={`rounded-full px-1.5 text-[10px] tabular-nums ${
                    tab === t.key
                      ? "bg-accent-fg/20 text-accent-fg"
                      : "bg-surface-hover text-fg-muted"
                  }`}
                >
                  {counts[t.key]}
                </span>
              )}
            </button>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          {watcherDown && (
            <span className="hidden text-xs text-accent lg:inline">
              ⚠ Live updates off
            </span>
          )}
          <button
            onClick={() => setDiffMode(diffMode === "unified" ? "split" : "unified")}
            className="rounded border border-border-strong px-2 py-1 text-xs text-fg-muted hover:border-accent hover:text-fg"
          >
            {diffMode === "unified" ? "Split" : "Unified"}
          </button>
          <button
            onClick={togglePaused}
            className="rounded border border-border-strong px-2 py-1 text-xs text-fg-muted hover:border-accent hover:text-fg"
            title={paused ? "Resume live updates" : "Pause live updates"}
          >
            <span className="hidden sm:inline">
              {paused ? "▶ Resume" : "⏸ Pause"}
            </span>
            <span className="sm:hidden">{paused ? "▶" : "⏸"}</span>
          </button>
        </div>
      </header>
      <div className="flex min-h-0 flex-1 flex-col">
        <main className="min-h-0 flex-1 overflow-hidden">{children}</main>
        <TerminalDrawerSlot />
      </div>
      <StatusBar />
    </div>
  );
}

function shortenPath(p: string): string {
  const home = "/Users/";
  if (p.startsWith(home)) {
    const rest = p.slice(home.length);
    const first = rest.indexOf("/");
    if (first >= 0) return `~${rest.slice(first)}`;
  }
  return p;
}
