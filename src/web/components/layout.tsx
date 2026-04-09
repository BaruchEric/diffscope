import type { ReactNode } from "react";
import { useStore, type Tab } from "../store";
import { StatusBar } from "./status-bar";

const TABS: { key: Tab; label: string }[] = [
  { key: "working-tree", label: "Working Tree" },
  { key: "history", label: "History" },
  { key: "branches", label: "Branches" },
  { key: "stashes", label: "Stashes" },
];

export function Layout({ children }: { children: ReactNode }) {
  const tab = useStore((s) => s.tab);
  const setTab = useStore((s) => s.setTab);
  const paused = useStore((s) => s.paused);
  const togglePaused = useStore((s) => s.togglePaused);
  const watcherDown = useStore((s) => s.watcherDown);
  const repoRoot = useStore((s) => s.repo?.root ?? null);
  const diffMode = useStore((s) => s.diffMode);
  const setDiffMode = useStore((s) => s.setDiffMode);
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
      <header className="flex items-center justify-between border-b border-neutral-200 bg-neutral-50 px-4 py-2 dark:border-neutral-800 dark:bg-neutral-900">
        <div className="flex items-center gap-4">
          <span className="font-semibold">diffscope</span>
          {repoRoot && (
            <span className="text-sm text-neutral-500">{shortenPath(repoRoot)}</span>
          )}
        </div>
        <nav className="flex gap-1">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex items-center gap-1.5 rounded px-3 py-1 text-sm ${
                tab === t.key
                  ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900"
                  : "text-neutral-600 hover:bg-neutral-200 dark:text-neutral-400 dark:hover:bg-neutral-800"
              }`}
            >
              {t.label}
              {counts[t.key] > 0 && t.key !== "history" && (
                <span
                  className={`rounded-full px-1.5 text-[10px] tabular-nums ${
                    tab === t.key
                      ? "bg-neutral-700 text-neutral-100 dark:bg-neutral-300 dark:text-neutral-800"
                      : "bg-neutral-200 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400"
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
            <span className="text-xs text-amber-600">⚠ Live updates off</span>
          )}
          <button
            onClick={() => setDiffMode(diffMode === "unified" ? "split" : "unified")}
            className="rounded border border-neutral-300 px-2 py-1 text-xs dark:border-neutral-700"
          >
            {diffMode === "unified" ? "Split" : "Unified"}
          </button>
          <button
            onClick={togglePaused}
            className="rounded border border-neutral-300 px-2 py-1 text-xs dark:border-neutral-700"
          >
            {paused ? "▶ Resume" : "⏸ Pause"}
          </button>
        </div>
      </header>
      <main className="flex-1 overflow-hidden">{children}</main>
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
