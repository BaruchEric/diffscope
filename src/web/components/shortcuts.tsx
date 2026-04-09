import { useEffect, useRef, useState } from "react";
import { useStore } from "../store";
import { useSettings } from "../settings";
import { allDirPathsForTree, visibleFilePathsForTree } from "./file-tree";

const TABS_ORDER = ["working-tree", "history", "branches", "stashes"] as const;

interface ShortcutRow {
  keys: string;
  description: string;
}

const SHORTCUT_HELP: ShortcutRow[] = [
  { keys: "j / k", description: "Next / previous file" },
  { keys: "[ / ]", description: "Next / previous item in current list" },
  { keys: "↑ / ↓", description: "Scroll diff (browser default)" },
  { keys: "Tab / ⇧Tab", description: "Next / previous tab" },
  { keys: "g then w/h/b/s", description: "Jump to Working Tree / History / Branches / Stashes" },
  { keys: "u", description: "Toggle unified / split diff" },
  { keys: "t", description: "Toggle flat / tree file list" },
  { keys: "b", description: "Toggle blame on current file" },
  { keys: "/", description: "Filter file list" },
  { keys: "p", description: "Pause / resume live updates" },
  { keys: "⌘K / ⌃K", description: "Command palette" },
  { keys: ",", description: "Settings" },
  { keys: "?", description: "Show this help" },
  { keys: "Esc", description: "Clear / close (priority: settings → palette → filter → focus)" },
  { keys: "Enter", description: "Dive into highlighted item / expand big file" },
];

const G_LEADER_TIMEOUT_MS = 1500;

export function Shortcuts() {
  const [helpOpen, setHelpOpen] = useState(false);
  const gLeaderRef = useRef<number | null>(null);
  // Mirror helpOpen into a ref so the keydown listener can read it without
  // rebinding every time help toggles.
  const helpOpenRef = useRef(helpOpen);
  helpOpenRef.current = helpOpen;

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const inInput =
        target &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA");

      // Esc priority chain — runs even inside inputs (to blur) and
      // before the early-return for input focus.
      if (e.key === "Escape") {
        const s = useStore.getState();
        if (s.settingsOpen) {
          s.closeSettings();
          return;
        }
        if (s.paletteOpen) {
          s.closePalette();
          return;
        }
        if (helpOpenRef.current) {
          setHelpOpen(false);
          return;
        }
        if (inInput) {
          (target as HTMLElement).blur();
          return;
        }
        if (s.focusedPath) {
          useStore.setState({ focusedPath: null, focusedDiff: null });
          return;
        }
        return;
      }

      if (inInput) return;

      // Cmd/Ctrl+K — command palette
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        useStore.getState().openPalette();
        return;
      }

      if (e.key === "?") {
        setHelpOpen((h) => !h);
        return;
      }
      if (e.key === ",") {
        useStore.getState().openSettings();
        return;
      }

      const s = useStore.getState();

      // Enter — context-sensitive. Palette handles its own Enter via capture listener.
      if (e.key === "Enter") {
        if (s.paletteOpen) return;
        // Future: expand collapsed big-file placeholder. For now, no-op.
        return;
      }

      // g-leader for tab jumps.
      if (gLeaderRef.current !== null) {
        clearTimeout(gLeaderRef.current);
        gLeaderRef.current = null;
        if (e.key === "w") {
          s.setTab("working-tree");
          return;
        }
        if (e.key === "h") {
          s.setTab("history");
          return;
        }
        if (e.key === "b") {
          s.setTab("branches");
          return;
        }
        if (e.key === "s") {
          s.setTab("stashes");
          return;
        }
        // Unknown key after g — fall through to normal handling.
      }
      if (e.key === "g") {
        gLeaderRef.current = window.setTimeout(() => {
          gLeaderRef.current = null;
        }, G_LEADER_TIMEOUT_MS);
        return;
      }

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
        useSettings
          .getState()
          .set({ fileListMode: cur === "tree" ? "flat" : "tree" });
        return;
      }
      if (e.key === "b") {
        const p = s.focusedPath;
        if (p) s.toggleBlame(p);
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
        const currentIdx = TABS_ORDER.indexOf(
          s.tab as (typeof TABS_ORDER)[number],
        );
        const delta = e.shiftKey ? -1 : 1;
        const nextIdx =
          (currentIdx + delta + TABS_ORDER.length) % TABS_ORDER.length;
        s.setTab(TABS_ORDER[nextIdx]!);
        return;
      }

      // j/k over the current tab's active list.
      if (e.key === "j" || e.key === "k") {
        const delta = e.key === "j" ? 1 : -1;
        navigateSibling(delta);
        return;
      }

      // [ / ] — same as j/k (alt binding for muscle memory).
      if (e.key === "[" || e.key === "]") {
        const delta = e.key === "]" ? 1 : -1;
        navigateSibling(delta);
        return;
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
        className="min-w-[420px] max-w-[560px] rounded-lg bg-white p-6 shadow-xl dark:bg-neutral-900"
      >
        <h2 className="mb-4 text-lg font-semibold">Keyboard shortcuts</h2>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
          {SHORTCUT_HELP.map((row) => (
            <div key={row.keys} className="contents">
              <dt className="font-mono text-neutral-600 dark:text-neutral-400">
                {row.keys}
              </dt>
              <dd>{row.description}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}

function navigateSibling(delta: 1 | -1): void {
  const s = useStore.getState();
  const mode = useSettings.getState().fileListMode;
  if (s.tab === "working-tree") {
    let paths: string[] = s.status.map((f) => f.path);
    if (mode === "tree") {
      // Use all-expanded for sibling navigation so every file is reachable.
      // Both helpers share a cached tree keyed on `status` reference identity,
      // so repeated j/k over unchanged state is near-free.
      paths = visibleFilePathsForTree(s.status, allDirPathsForTree(s.status));
    }
    if (paths.length === 0) return;
    const idx = s.focusedPath ? paths.indexOf(s.focusedPath) : -1;
    const next = paths[(idx + delta + paths.length) % paths.length];
    if (next) void s.focusFile(next);
    return;
  }
  if (s.tab === "history") {
    const shas = s.log.map((c) => c.sha);
    if (shas.length === 0) return;
    const idx = s.focusedCommitSha ? shas.indexOf(s.focusedCommitSha) : -1;
    const next = shas[(idx + delta + shas.length) % shas.length];
    if (next) void s.focusCommit(next);
    return;
  }
  if (s.tab === "branches") {
    const names = s.branches.map((b) => b.name);
    if (names.length === 0) return;
    const idx = s.focusedBranch ? names.indexOf(s.focusedBranch) : -1;
    const next = names[(idx + delta + names.length) % names.length];
    if (next) s.focusBranch(next);
    return;
  }
  if (s.tab === "stashes") {
    if (s.stashes.length === 0) return;
    const cur = s.focusedStashIndex ?? -1;
    const nextIdx =
      (cur + delta + s.stashes.length) % s.stashes.length;
    s.focusStash(nextIdx);
    return;
  }
}
