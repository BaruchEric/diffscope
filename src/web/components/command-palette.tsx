// src/web/components/command-palette.tsx
import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../store";
import { buildActions, type PaletteAction } from "../lib/actions";
import { fuzzyFilter } from "../lib/fuzzy";
import { useSettings, type ThemeId } from "../settings";

const THEME_COMMANDS: PaletteAction[] = [
  {
    id: "theme.midnight",
    label: "Theme: Midnight",
    run: () => useSettings.getState().set({ theme: "midnight" }),
  },
  {
    id: "theme.paper",
    label: "Theme: Paper",
    run: () => useSettings.getState().set({ theme: "paper" }),
  },
  {
    id: "theme.aperture",
    label: "Theme: Aperture",
    run: () => useSettings.getState().set({ theme: "aperture" }),
  },
  {
    id: "theme.auto",
    label: "Theme: Auto (follow OS)",
    run: () => useSettings.getState().set({ theme: "auto" }),
  },
  {
    id: "theme.cycle",
    label: "Theme: Cycle",
    run: () => {
      const order: ThemeId[] = ["auto", "midnight", "paper", "aperture"];
      const current = useSettings.getState().theme;
      const next = order[(order.indexOf(current) + 1) % order.length]!;
      useSettings.getState().set({ theme: next });
    },
  },
];

type ItemKind =
  | { kind: "action"; action: PaletteAction }
  | { kind: "file"; path: string }
  | { kind: "commit"; sha: string; subject: string }
  | { kind: "branch"; name: string }
  | { kind: "stash"; index: number; message: string };

export function CommandPalette() {
  const open = useStore((s) => s.paletteOpen);
  const close = useStore((s) => s.closePalette);
  const tab = useStore((s) => s.tab);
  const status = useStore((s) => s.status);
  const log = useStore((s) => s.log);
  const branches = useStore((s) => s.branches);
  const stashes = useStore((s) => s.stashes);
  const focusFile = useStore((s) => s.focusFile);
  const focusCommit = useStore((s) => s.focusCommit);
  const focusBranch = useStore((s) => s.focusBranch);
  const focusStash = useStore((s) => s.focusStash);
  const setTab = useStore((s) => s.setTab);

  const [query, setQuery] = useState("");
  const [selIdx, setSelIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const actions = useMemo(() => [...buildActions(), ...THEME_COMMANDS], []);

  const items = useMemo(() => {
    const filteredActions = fuzzyFilter(actions, query, (a) => a.label).map(
      (a) => ({ kind: "action" as const, action: a }),
    );

    let contextual: ItemKind[] = [];
    if (tab === "working-tree") {
      contextual = fuzzyFilter(
        status.map((f) => f.path),
        query,
        (p) => p,
      ).map((p) => ({ kind: "file" as const, path: p }));
    } else if (tab === "history") {
      contextual = fuzzyFilter(log, query, (c) => c.subject).map((c) => ({
        kind: "commit" as const,
        sha: c.sha,
        subject: c.subject,
      }));
    } else if (tab === "branches") {
      contextual = fuzzyFilter(branches, query, (b) => b.name).map((b) => ({
        kind: "branch" as const,
        name: b.name,
      }));
    } else if (tab === "stashes") {
      contextual = fuzzyFilter(stashes, query, (s) => s.message).map((s) => ({
        kind: "stash" as const,
        index: s.index,
        message: s.message,
      }));
    }

    return { actions: filteredActions, contextual };
  }, [actions, query, tab, status, log, branches, stashes]);

  const flatList: ItemKind[] = useMemo(
    () => [...items.actions, ...items.contextual],
    [items],
  );

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setSelIdx(0);
    const t = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, [open]);

  useEffect(() => {
    setSelIdx(0);
  }, [query, tab]);

  // Keep the latest list / selection / activate fn in refs so the keydown
  // listener stays stable across arrow-key presses. Without this, each
  // selIdx change would tear down and re-attach the listener.
  const flatListRef = useRef(flatList);
  flatListRef.current = flatList;
  const selIdxRef = useRef(selIdx);
  selIdxRef.current = selIdx;

  useEffect(() => {
    if (!open) return;
    // Esc is handled by the central shortcuts chain. This listener only owns
    // ArrowUp/ArrowDown/Enter while the palette is open.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelIdx((i) => Math.min(i + 1, flatListRef.current.length - 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelIdx((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        const chosen = flatListRef.current[selIdxRef.current];
        if (!chosen) return;
        activateRef.current(chosen);
      }
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () =>
      window.removeEventListener("keydown", onKey, { capture: true });
  }, [open]);

  const activate = (item: ItemKind) => {
    if (item.kind === "action") item.action.run();
    else if (item.kind === "file") void focusFile(item.path);
    else if (item.kind === "commit") {
      void focusCommit(item.sha);
      setTab("history");
    } else if (item.kind === "branch") focusBranch(item.name);
    else if (item.kind === "stash") focusStash(item.index);
    close();
  };
  const activateRef = useRef(activate);
  activateRef.current = activate;

  if (!open) return null;

  return (
    <div
      onClick={close}
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 pt-24 backdrop-blur-sm"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-[520px] overflow-hidden rounded-lg border border-border bg-bg-elevated shadow-soft"
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Type an action, file, commit, branch, or stash…"
          className="w-full border-b border-border bg-transparent px-4 py-3 text-sm text-fg placeholder:text-fg-subtle focus:border-accent focus:outline-none"
          autoFocus
        />
        <div className="max-h-[400px] overflow-auto">
          {items.actions.length > 0 && (
            <Section title="Actions">
              {items.actions.map((entry, i) => (
                <Row
                  key={entry.action.id}
                  selected={i === selIdx}
                  onClick={() => activate(entry)}
                >
                  <span>{entry.action.label}</span>
                  {entry.action.hint && (
                    <span className="ml-auto font-mono text-xs text-fg-subtle">
                      {entry.action.hint}
                    </span>
                  )}
                </Row>
              ))}
            </Section>
          )}
          {items.contextual.length > 0 && (
            <Section title={contextTitle(tab)}>
              {items.contextual.map((entry, i) => {
                const gi = items.actions.length + i;
                return (
                  <Row
                    key={keyFor(entry)}
                    selected={gi === selIdx}
                    onClick={() => activate(entry)}
                  >
                    {labelFor(entry)}
                  </Row>
                );
              })}
            </Section>
          )}
          {flatList.length === 0 && (
            <div className="px-4 py-6 text-center text-sm text-fg-subtle">
              No matches
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="bg-surface px-4 py-1 text-[10px] font-semibold uppercase tracking-wide text-fg-subtle">
        {title}
      </div>
      {children}
    </div>
  );
}

function Row({
  selected,
  onClick,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={
        "flex w-full items-center gap-2 px-4 py-2 text-left text-sm " +
        (selected
          ? "bg-accent text-accent-fg"
          : "text-fg hover:bg-surface-hover")
      }
    >
      {selected && <span className="text-accent-fg">›</span>}
      {children}
    </button>
  );
}

function contextTitle(tab: string): string {
  switch (tab) {
    case "working-tree":
      return "Files";
    case "history":
      return "Commits";
    case "branches":
      return "Branches";
    case "stashes":
      return "Stashes";
    default:
      return "Items";
  }
}

function keyFor(item: ItemKind): string {
  if (item.kind === "file") return `f:${item.path}`;
  if (item.kind === "commit") return `c:${item.sha}`;
  if (item.kind === "branch") return `b:${item.name}`;
  if (item.kind === "stash") return `s:${item.index}`;
  return "x";
}

function labelFor(item: ItemKind): string {
  if (item.kind === "file") return item.path;
  if (item.kind === "commit") return item.subject;
  if (item.kind === "branch") return item.name;
  if (item.kind === "stash") return `stash@{${item.index}}: ${item.message}`;
  return "";
}
