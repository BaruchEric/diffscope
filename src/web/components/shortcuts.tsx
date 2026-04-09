import { useEffect, useState } from "react";
import { useStore } from "../store";
import { useSettings } from "../settings";

const SHORTCUTS = [
  ["j / k", "Next / previous file"],
  ["↑ / ↓", "Scroll diff (browser default)"],
  ["Tab / Shift+Tab", "Next / previous tab"],
  ["u", "Toggle unified / split"],
  ["/", "Filter file list"],
  ["p", "Pause / resume live updates"],
  ["?", "Show this help"],
];

const TABS_ORDER = ["working-tree", "history", "branches", "stashes"] as const;

export function Shortcuts() {
  const [helpOpen, setHelpOpen] = useState(false);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) {
        if (e.key === "Escape") target.blur();
        return;
      }

      if (e.key === "?") {
        setHelpOpen((h) => !h);
        return;
      }
      if (e.key === "Escape") {
        setHelpOpen(false);
        return;
      }
      if (e.key === ",") {
        useStore.getState().openSettings();
        return;
      }

      const s = useStore.getState();
      if (e.key === "p") {
        s.togglePaused();
        return;
      }
      if (e.key === "u") {
        s.setDiffMode(s.diffMode === "unified" ? "split" : "unified");
        return;
      }
      if (e.key === "t") {
        const cur = useSettings.getState().fileListMode;
        useSettings.getState().set({ fileListMode: cur === "tree" ? "flat" : "tree" });
        return;
      }
      if (e.key === "/") {
        e.preventDefault();
        const el = document.querySelector<HTMLInputElement>("[data-filter-input]");
        el?.focus();
        return;
      }
      if (e.key === "Tab") {
        e.preventDefault();
        const currentIdx = TABS_ORDER.indexOf(s.tab as (typeof TABS_ORDER)[number]);
        const delta = e.shiftKey ? -1 : 1;
        const nextIdx = (currentIdx + delta + TABS_ORDER.length) % TABS_ORDER.length;
        s.setTab(TABS_ORDER[nextIdx]!);
        return;
      }
      if ((e.key === "j" || e.key === "k") && s.tab === "working-tree") {
        const paths = s.status.map((f) => f.path);
        if (paths.length === 0) return;
        const idx = s.focusedPath ? paths.indexOf(s.focusedPath) : -1;
        const delta = e.key === "j" ? 1 : -1;
        const next = paths[(idx + delta + paths.length) % paths.length];
        if (next) void s.focusFile(next);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  if (!helpOpen) return null;
  return (
    <div
      onClick={() => setHelpOpen(false)}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="min-w-[360px] rounded-lg bg-white p-6 shadow-xl dark:bg-neutral-900"
      >
        <h2 className="mb-4 text-lg font-semibold">Keyboard shortcuts</h2>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
          {SHORTCUTS.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="font-mono text-neutral-600 dark:text-neutral-400">{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}
