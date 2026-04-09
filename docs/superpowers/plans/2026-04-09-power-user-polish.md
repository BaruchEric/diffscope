# Power-User Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 7 quality-of-life features to diffscope (resizable panes, Cmd+K palette, file-tree view, lazy HEAD blame, open-in-editor, settings modal, expanded shortcuts) sharing a new centralized settings store.

**Architecture:** New `useSettings` Zustand store (`src/web/settings.ts`) is the single source of truth for persisted user preferences, writing through to `localStorage` under one key. A new `theme.ts` module applies `data-theme` on `<html>`. One new backend endpoint (`/api/blame`) runs `git blame --porcelain HEAD -- <path>`, with an in-memory LRU cache invalidated on `head-changed`. Everything else is a frontend composition: `<PaneSplit>` wraps the existing file-list + diff-view region in `layout.tsx`; `<CommandPalette>` and `<SettingsModal>` are root-level overlays; `<FileTree>` is a pure function of the existing flat `FileStatus[]`; `<BlameGutter>` and `<OpenInEditor>` extend `<DiffView>`.

**Tech Stack:** TypeScript, React 18, Zustand, Tailwind CSS, Vite (frontend); Bun runtime, native `bun:test` (backend). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-04-09-power-user-polish-design.md`

---

## Conventions used in this plan

- Every task lists exact file paths and shows complete code blocks. No "add error handling similar to X" placeholders.
- Every task ends in a commit. Commit messages follow the project's `<scope>: <summary>` style (see `git log` — e.g. `feat(web): …`, `feat(server): …`, `refactor(web): …`).
- Run `bun run lint && bun test` after every phase. Fix any issues before committing that phase's final task.
- The engineer reading this may not know Zustand. Quick primer: `create<T>((set, get) => ({ ...initial, action() { set({...}) } }))`. Read with `useStore((s) => s.field)` inside a component; read outside a component with `useStore.getState()`.
- The engineer may not know the `git blame --porcelain` format. It's documented in full inside Task 6.3 before any code is written.

---

## Phase 1 — Settings store + theme plumbing

### Task 1.1: Flip Tailwind dark mode from `media` to `class`

**Files:**
- Modify: `tailwind.config.ts`

The current config uses `darkMode: "media"`, which means `dark:` classes respond to the OS preference automatically. The theme override feature needs to ignore the OS and respond to an explicit class, so this must change first. The existing components already use `dark:bg-neutral-900` etc. — no component changes are needed, the selector semantics switch from `@media (prefers-color-scheme: dark)` to `.dark .bg-neutral-900`.

- [ ] **Step 1: Modify `tailwind.config.ts`**

Replace the line `darkMode: "media",` with:

```ts
darkMode: ["class", '[data-theme="dark"]'],
```

Full file after edit:

```ts
import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/web/**/*.{ts,tsx}"],
  darkMode: ["class", '[data-theme="dark"]'],
  theme: {
    extend: {
      fontFamily: {
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
    },
  },
  plugins: [],
} satisfies Config;
```

Why `["class", '[data-theme="dark"]']`: Tailwind's array form lets us pick the attribute selector we'll use in Task 1.3. Components keep using `dark:` classes unchanged.

- [ ] **Step 2: Rebuild the web bundle and confirm dark mode still applies in dev**

Run:
```bash
bun run dev:web
```

Open the app in a browser with OS dark mode on. The UI should still render dark because Task 1.3 will default the theme to `system`. Before Task 1.3 ships, dark mode is temporarily broken — that's expected; we'll fix it in the same phase and not commit in between.

No commit yet — this task's commit ships together with Tasks 1.2, 1.3, 1.4 as one atomic "settings + theme" change at the end of the phase.

---

### Task 1.2: Create the settings store

**Files:**
- Create: `src/web/settings.ts`

- [ ] **Step 1: Create the file**

```ts
// src/web/settings.ts
// Centralized, persisted user preferences.
// One storage key, one setter, one loader.
import { create } from "zustand";

export type Theme = "system" | "light" | "dark";
export type Editor = "none" | "vscode" | "cursor" | "zed" | "idea" | "subl";
export type FileListMode = "flat" | "tree";
export type DefaultTab =
  | "last-used"
  | "working-tree"
  | "history"
  | "branches"
  | "stashes";

export interface Settings {
  theme: Theme;
  defaultTab: DefaultTab;
  fileListMode: FileListMode;
  editor: Editor;
  blameStickyOn: boolean;
  fileListWidthPx: number;
}

const STORAGE_KEY = "diffscope:settings:v1";

const DEFAULTS: Settings = {
  theme: "system",
  defaultTab: "last-used",
  fileListMode: "flat",
  editor: "none",
  blameStickyOn: false,
  fileListWidthPx: 320,
};

interface SettingsStore extends Settings {
  loaded: boolean;
  load(): void;
  set(partial: Partial<Settings>): void;
  reset(keys: (keyof Settings)[]): void;
}

function readStoredSettings(): Partial<Settings> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object") return parsed as Partial<Settings>;
    return {};
  } catch {
    return {};
  }
}

function migrateLegacyKeys(): Partial<Settings> {
  // Legacy keys from before settings.ts existed. Read once, then delete.
  const out: Partial<Settings> = {};
  try {
    const tab = localStorage.getItem("diffscope:tab");
    if (tab && ["working-tree", "history", "branches", "stashes"].includes(tab)) {
      // Legacy "last-opened tab" maps to defaultTab only if nothing was stored yet.
      // We intentionally do NOT write it here — last-used remains the default.
      // The legacy value is just dropped.
    }
    localStorage.removeItem("diffscope:tab");
    localStorage.removeItem("diffscope:diffMode");
  } catch {
    // ignore
  }
  return out;
}

function writeThrough(state: Settings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // quota / disabled storage — drop silently
  }
}

export const useSettings = create<SettingsStore>((set, get) => ({
  ...DEFAULTS,
  loaded: false,

  load() {
    migrateLegacyKeys();
    const stored = readStoredSettings();
    const merged: Settings = { ...DEFAULTS, ...stored };
    set({ ...merged, loaded: true });
  },

  set(partial) {
    const { loaded: _l, load: _load, set: _set, reset: _reset, ...current } =
      get();
    const next: Settings = { ...current, ...partial };
    writeThrough(next);
    set(partial);
  },

  reset(keys) {
    const partial: Partial<Settings> = {};
    for (const k of keys) partial[k] = DEFAULTS[k] as never;
    get().set(partial);
  },
}));

// Non-hook accessor for use outside React components (shortcuts, event handlers).
export function getSettings(): Settings {
  const s = useSettings.getState();
  const { loaded: _l, load: _load, set: _set, reset: _reset, ...rest } = s;
  return rest;
}
```

Notes on the design:
- `load()` is idempotent but intentionally called once at boot.
- `set()` uses a single write-through so partial updates are atomic.
- The `reset(keys)` method supports the "Reset pane widths" button in the settings modal.
- The legacy migration intentionally drops `diffscope:tab` because `defaultTab === "last-used"` is the new equivalent behavior — we derive "last used" from live store state in Task 1.4.
- No React context. `useSettings((s) => s.theme)` in components; `getSettings()` in imperative code.

No commit yet — lands with Task 1.4.

---

### Task 1.3: Create the theme module

**Files:**
- Create: `src/web/theme.ts`

- [ ] **Step 1: Create the file**

```ts
// src/web/theme.ts
// Applies theme to the document root.
// `system` follows OS at runtime.
import type { Theme } from "./settings";

let mediaQuery: MediaQueryList | null = null;
let mediaListener: ((e: MediaQueryListEvent) => void) | null = null;

function resolveSystem(): "light" | "dark" {
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function writeAttribute(resolved: "light" | "dark"): void {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute("data-theme", resolved);
}

export function applyTheme(theme: Theme): void {
  // Detach any prior system listener — we'll re-attach only if needed.
  if (mediaQuery && mediaListener) {
    mediaQuery.removeEventListener("change", mediaListener);
    mediaListener = null;
    mediaQuery = null;
  }

  if (theme === "system") {
    writeAttribute(resolveSystem());
    if (typeof window !== "undefined") {
      mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
      mediaListener = (e) => writeAttribute(e.matches ? "dark" : "light");
      mediaQuery.addEventListener("change", mediaListener);
    }
    return;
  }
  writeAttribute(theme);
}
```

Why a module-level `mediaQuery`: we want `applyTheme` to be idempotent without leaking listeners when the user toggles between `system` and a fixed theme.

No commit yet — lands with Task 1.4.

---

### Task 1.4: Wire settings + theme into app boot; remove inline localStorage from store.ts

**Files:**
- Modify: `src/web/app.tsx`
- Modify: `src/web/store.ts`

- [ ] **Step 1: Modify `src/web/app.tsx`**

At the top of the file, add imports:

```ts
import { useSettings, getSettings } from "./settings";
import { applyTheme } from "./theme";
```

Inside the `App` component, before the existing `initialize()` effect, add a `useEffect` that loads settings and applies the theme once at mount. Subscribe to theme changes to re-apply. Example structure (merge this into the existing component body — do not duplicate the file):

```tsx
useEffect(() => {
  useSettings.getState().load();
  applyTheme(getSettings().theme);
}, []);

useEffect(() => {
  const unsub = useSettings.subscribe((s) => applyTheme(s.theme));
  return () => unsub();
}, []);
```

If `app.tsx` already has `useEffect(() => { useStore.getState().initialize(); … }, [])`, put the new effects immediately above it so settings are loaded before `initialize()` runs.

- [ ] **Step 2: Modify `src/web/store.ts` — remove inline localStorage**

Delete the two inline `localStorage.setItem` calls in `setTab` and `setDiffMode` and the matching reads in `initialize`. Replace with `useSettings.set` delegation.

At the top of the file, add:

```ts
import { useSettings, getSettings } from "./settings";
```

Replace the `setTab` implementation:

```ts
setTab: (tab) => {
  useSettings.getState().set({ defaultTab: "last-used" });
  set({ tab });
},
```

Wait — `defaultTab` is a separate user preference. Clicking a tab should NOT overwrite the user's chosen default. Fix: `setTab` only sets the live tab, and we persist "last-used tab" in a separate key so it survives reloads. To keep Task 1.4 minimal, we store the last-used tab on `useSettings` too, under a new field. Open `src/web/settings.ts` from Task 1.2 and add one field:

```ts
// In Settings interface, add:
lastUsedTab: "working-tree" | "history" | "branches" | "stashes";
```

And in `DEFAULTS`:

```ts
lastUsedTab: "working-tree",
```

Back in `store.ts`, `setTab` becomes:

```ts
setTab: (tab) => {
  useSettings.getState().set({ lastUsedTab: tab });
  set({ tab });
},
```

Replace `setDiffMode`:

```ts
setDiffMode: (mode) => {
  // DiffMode is persisted as a separate local preference; we add it to Settings below.
  useSettings.getState().set({ diffMode: mode });
  set({ diffMode: mode });
},
```

And add to the `Settings` interface in `src/web/settings.ts`:

```ts
diffMode: "unified" | "split";
```

And in `DEFAULTS`:

```ts
diffMode: "unified",
```

Replace the `initialize()` body's legacy-key reads. Delete these lines:

```ts
const savedMode = localStorage.getItem("diffscope:diffMode") as DiffMode | null;
if (savedMode) set({ diffMode: savedMode });
const savedTab = localStorage.getItem("diffscope:tab") as Tab | null;
if (savedTab && ["working-tree", "history", "branches", "stashes"].includes(savedTab)) {
  set({ tab: savedTab });
}
```

Replace them with:

```ts
const s = getSettings();
const initialTab: Tab =
  s.defaultTab === "last-used" ? s.lastUsedTab : s.defaultTab;
set({ tab: initialTab, diffMode: s.diffMode });
```

Important: `getSettings()` must be called after `useSettings.load()`. Since `app.tsx` now calls `load()` in a `useEffect` that runs before `initialize()` (which is in a later effect), this ordering holds as long as you kept the new effects above the existing one in Step 1.

- [ ] **Step 3: Run lint, type check, and tests**

```bash
bun run lint
bunx tsc -p tsconfig.web.json --noEmit
bun test
```

Expected: all pass. If `tsc` complains about `DiffMode` or `Tab` being imported from two places, standardize on importing from `./store` (where they're currently defined).

- [ ] **Step 4: Manual smoke check**

Start the backend + frontend:
```bash
DIFFSCOPE_DEV_PORT=41111 bun run --hot src/server/cli.ts /path/to/test-repo
bun run dev:web
```

1. Load the app — it should render in the current OS theme.
2. Open devtools console and run `localStorage.setItem("diffscope:settings:v1", JSON.stringify({ theme: "light" }))`, reload — should force light.
3. Same with `"dark"` — should force dark.
4. Set back to `system` or clear the key, reload — should follow OS.
5. Click different tabs, reload — the same tab reopens (because `lastUsedTab` is being persisted).

- [ ] **Step 5: Commit phase 1**

```bash
git add tailwind.config.ts src/web/settings.ts src/web/theme.ts src/web/app.tsx src/web/store.ts
git commit -m "feat(web): centralized settings store + theme override

- darkMode: class via data-theme attribute
- useSettings Zustand store with localStorage write-through
- applyTheme with OS fallback on system
- Migrate inline store.ts localStorage calls to useSettings"
```

---

## Phase 2 — Resizable panes

### Task 2.1: Create PaneSplit component

**Files:**
- Create: `src/web/components/pane-split.tsx`

- [ ] **Step 1: Create the file**

```tsx
// src/web/components/pane-split.tsx
// Two-child horizontal split with a draggable divider.
// Left child width is persisted via useSettings.fileListWidthPx.
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useSettings } from "../settings";

const MIN_WIDTH = 180;
const MAX_FRACTION = 0.4;
const DEFAULT_WIDTH = 320;

function clamp(px: number): number {
  const max = Math.max(MIN_WIDTH + 100, Math.floor(window.innerWidth * MAX_FRACTION));
  return Math.min(Math.max(px, MIN_WIDTH), max);
}

export function PaneSplit({
  left,
  right,
}: {
  left: ReactNode;
  right: ReactNode;
}) {
  const widthPx = useSettings((s) => s.fileListWidthPx);
  const [dragging, setDragging] = useState(false);
  const rafRef = useRef<number | null>(null);

  // Clamp on window resize so a saved width doesn't overflow after window shrinks.
  useEffect(() => {
    const onResize = () => {
      const clamped = clamp(useSettings.getState().fileListWidthPx);
      if (clamped !== useSettings.getState().fileListWidthPx) {
        useSettings.getState().set({ fileListWidthPx: clamped });
      }
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setDragging(true);
    const startX = e.clientX;
    const startWidth = useSettings.getState().fileListWidthPx;

    const onMove = (me: MouseEvent) => {
      if (rafRef.current !== null) return;
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        const next = clamp(startWidth + (me.clientX - startX));
        useSettings.getState().set({ fileListWidthPx: next });
      });
    };
    const onUp = () => {
      setDragging(false);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, []);

  const onDoubleClick = useCallback(() => {
    useSettings.getState().set({ fileListWidthPx: DEFAULT_WIDTH });
  }, []);

  return (
    <div className="flex h-full min-h-0 w-full">
      <div
        className="h-full min-h-0 shrink-0 overflow-hidden"
        style={{ width: widthPx }}
      >
        {left}
      </div>
      <div
        role="separator"
        aria-orientation="vertical"
        onMouseDown={onMouseDown}
        onDoubleClick={onDoubleClick}
        className={
          "relative h-full w-1 shrink-0 cursor-col-resize bg-neutral-200 hover:bg-blue-400 dark:bg-neutral-800" +
          (dragging ? " bg-blue-500 dark:bg-blue-500" : "")
        }
        title="Drag to resize, double-click to reset"
      />
      <div className="h-full min-h-0 min-w-0 flex-1 overflow-hidden">{right}</div>
    </div>
  );
}
```

No commit yet — lands with Task 2.2.

---

### Task 2.2: Integrate PaneSplit into layout.tsx

**Files:**
- Modify: `src/web/components/layout.tsx`

- [ ] **Step 1: Read the file to locate the file-list + diff-view region**

Before editing, open `src/web/components/layout.tsx` and find the JSX region where `<FileList />` and `<DiffView />` are rendered side-by-side. That's the region to wrap.

- [ ] **Step 2: Import PaneSplit**

At the top of `layout.tsx`:

```ts
import { PaneSplit } from "./pane-split";
```

- [ ] **Step 3: Wrap file list + diff view**

Replace the existing two-column container (whatever class it has — likely `flex` with `FileList` and `DiffView` inside) with:

```tsx
<PaneSplit
  left={<FileList />}
  right={<DiffView />}
/>
```

Keep the tab bar and status bar outside this wrapper so they continue to span the full window width.

- [ ] **Step 4: Run lint/type/test**

```bash
bun run lint && bunx tsc -p tsconfig.web.json --noEmit && bun test
```

Expected: all pass.

- [ ] **Step 5: Manual smoke check**

1. Start backend + frontend.
2. Drag the vertical divider left/right — smooth, no jitter.
3. Drag hard to the left — stops at 180px.
4. Drag hard to the right — stops around 40% of window width.
5. Double-click divider — snaps back to 320px.
6. Reload — width persists.
7. Resize browser window to narrow — stored width clamps down automatically.

- [ ] **Step 6: Commit phase 2**

```bash
git add src/web/components/pane-split.tsx src/web/components/layout.tsx
git commit -m "feat(web): resizable file-list / diff-view pane"
```

---

## Phase 3 — Settings modal

### Task 3.1: Add transient UI state for palette / settings open

**Files:**
- Modify: `src/web/store.ts`

- [ ] **Step 1: Add state and actions**

Add to `StoreState` interface:

```ts
paletteOpen: boolean;
settingsOpen: boolean;
openPalette: () => void;
closePalette: () => void;
openSettings: () => void;
closeSettings: () => void;
```

Add to the initial state in `create`:

```ts
paletteOpen: false,
settingsOpen: false,
openPalette: () => set({ paletteOpen: true }),
closePalette: () => set({ paletteOpen: false }),
openSettings: () => set({ settingsOpen: true }),
closeSettings: () => set({ settingsOpen: false }),
```

No commit yet — lands with Task 3.4.

---

### Task 3.2: Create the SettingsModal component

**Files:**
- Create: `src/web/components/settings-modal.tsx`

- [ ] **Step 1: Create the file**

```tsx
// src/web/components/settings-modal.tsx
import { useEffect } from "react";
import { useStore } from "../store";
import {
  useSettings,
  type Theme,
  type Editor,
  type DefaultTab,
  type FileListMode,
} from "../settings";

const THEMES: { value: Theme; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

const DEFAULT_TABS: { value: DefaultTab; label: string }[] = [
  { value: "last-used", label: "Last used" },
  { value: "working-tree", label: "Working Tree" },
  { value: "history", label: "History" },
  { value: "branches", label: "Branches" },
  { value: "stashes", label: "Stashes" },
];

const EDITORS: { value: Editor; label: string }[] = [
  { value: "none", label: "None" },
  { value: "vscode", label: "VS Code" },
  { value: "cursor", label: "Cursor" },
  { value: "zed", label: "Zed" },
  { value: "idea", label: "IntelliJ" },
  { value: "subl", label: "Sublime Text" },
];

const LIST_MODES: { value: FileListMode; label: string }[] = [
  { value: "flat", label: "Flat" },
  { value: "tree", label: "Tree" },
];

export function SettingsModal() {
  const open = useStore((s) => s.settingsOpen);
  const close = useStore((s) => s.closeSettings);

  const theme = useSettings((s) => s.theme);
  const defaultTab = useSettings((s) => s.defaultTab);
  const fileListMode = useSettings((s) => s.fileListMode);
  const editor = useSettings((s) => s.editor);
  const blameStickyOn = useSettings((s) => s.blameStickyOn);
  const set = useSettings((s) => s.set);
  const reset = useSettings((s) => s.reset);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close();
      }
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () =>
      window.removeEventListener("keydown", onKey, { capture: true });
  }, [open, close]);

  if (!open) return null;

  return (
    <div
      onClick={close}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-[420px] rounded-lg bg-white p-6 shadow-xl dark:bg-neutral-900"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Settings</h2>
          <button
            onClick={close}
            className="text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100"
            aria-label="Close settings"
          >
            ×
          </button>
        </div>

        <div className="space-y-4">
          <Row label="Theme">
            <select
              value={theme}
              onChange={(e) => set({ theme: e.target.value as Theme })}
              className="rounded border border-neutral-300 bg-white px-2 py-1 dark:border-neutral-700 dark:bg-neutral-800"
            >
              {THEMES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </Row>

          <Row label="Default tab">
            <select
              value={defaultTab}
              onChange={(e) =>
                set({ defaultTab: e.target.value as DefaultTab })
              }
              className="rounded border border-neutral-300 bg-white px-2 py-1 dark:border-neutral-700 dark:bg-neutral-800"
            >
              {DEFAULT_TABS.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </Row>

          <Row label="File list view">
            <select
              value={fileListMode}
              onChange={(e) =>
                set({ fileListMode: e.target.value as FileListMode })
              }
              className="rounded border border-neutral-300 bg-white px-2 py-1 dark:border-neutral-700 dark:bg-neutral-800"
            >
              {LIST_MODES.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </Row>

          <Row label="Open in editor">
            <select
              value={editor}
              onChange={(e) => set({ editor: e.target.value as Editor })}
              className="rounded border border-neutral-300 bg-white px-2 py-1 dark:border-neutral-700 dark:bg-neutral-800"
            >
              {EDITORS.map((e2) => (
                <option key={e2.value} value={e2.value}>
                  {e2.label}
                </option>
              ))}
            </select>
          </Row>

          <Row label="Sticky blame">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={blameStickyOn}
                onChange={(e) => set({ blameStickyOn: e.target.checked })}
              />
              <span className="text-sm text-neutral-600 dark:text-neutral-400">
                Carry blame toggle to next file
              </span>
            </label>
          </Row>

          <div className="border-t border-neutral-200 pt-4 dark:border-neutral-800">
            <button
              onClick={() => reset(["fileListWidthPx"])}
              className="rounded border border-neutral-300 px-3 py-1 text-sm hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
            >
              Reset pane widths
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm font-medium">{label}</span>
      {children}
    </div>
  );
}
```

No commit yet — lands with Task 3.4.

---

### Task 3.3: Mount modal + add gear icon + `,` shortcut

**Files:**
- Modify: `src/web/app.tsx`
- Modify: `src/web/components/status-bar.tsx`
- Modify: `src/web/components/shortcuts.tsx`

- [ ] **Step 1: Mount `<SettingsModal />` in app.tsx**

Add import:

```ts
import { SettingsModal } from "./components/settings-modal";
```

Render `<SettingsModal />` at the same level as `<Shortcuts />` (near the root of the app JSX). Example placement — put it at the end of the top-level fragment.

- [ ] **Step 2: Add gear icon to status-bar.tsx**

Import the store:

```ts
import { useStore } from "../store";
```

Add a button to the status bar's right side (wherever other controls live):

```tsx
<button
  onClick={() => useStore.getState().openSettings()}
  title="Settings (,)"
  aria-label="Open settings"
  className="px-2 text-neutral-600 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
>
  ⚙
</button>
```

- [ ] **Step 3: Add `,` shortcut**

In `src/web/components/shortcuts.tsx`, inside the `handler` function, after the existing `if (e.key === "Escape")` block and before the `const s = useStore.getState();` line, add:

```ts
if (e.key === ",") {
  useStore.getState().openSettings();
  return;
}
```

Note: shortcut conflict check — `,` is not a default browser or React binding, and the early-return on input focus means it won't fire in text inputs.

- [ ] **Step 4: Run lint/type/test + smoke**

```bash
bun run lint && bunx tsc -p tsconfig.web.json --noEmit && bun test
```

Smoke check:
1. Click the gear icon — modal opens.
2. Press `Esc` — modal closes.
3. Press `,` — modal opens.
4. Change theme to Dark — UI goes dark immediately.
5. Change theme to System — UI follows OS.
6. Set default tab to "History", reload — opens on History tab.
7. Reset pane widths button — after dragging the pane, clicking this snaps back to 320px.

---

### Task 3.4: Commit phase 3

- [ ] **Step 1: Commit**

```bash
git add src/web/store.ts src/web/components/settings-modal.tsx src/web/app.tsx src/web/components/status-bar.tsx src/web/components/shortcuts.tsx
git commit -m "feat(web): settings modal (theme, default tab, editor, view mode)"
```

---

## Phase 4 — File-tree view

### Task 4.1: Create FileTree component

**Files:**
- Create: `src/web/components/file-tree.tsx`

- [ ] **Step 1: Create the file**

```tsx
// src/web/components/file-tree.tsx
// Pure function of FileStatus[] → collapsible tree.
// Collapse state is component-local (resets on reload per design).
// On first render and whenever the input file set changes, every
// ancestor directory of a changed file is expanded.
import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { FileStatus } from "@shared/types";

interface TreeNode {
  name: string;
  fullPath: string; // "" for root, "src" / "src/web" for dirs
  isDir: boolean;
  children: TreeNode[];
  file?: FileStatus;
}

function buildTree(files: FileStatus[]): TreeNode {
  const root: TreeNode = {
    name: "",
    fullPath: "",
    isDir: true,
    children: [],
  };
  for (const f of files) {
    const parts = f.path.split("/");
    let cursor = root;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]!;
      const isLast = i === parts.length - 1;
      const childPath = cursor.fullPath ? `${cursor.fullPath}/${part}` : part;
      let child = cursor.children.find((c) => c.name === part);
      if (!child) {
        child = {
          name: part,
          fullPath: childPath,
          isDir: !isLast,
          children: [],
        };
        cursor.children.push(child);
      }
      if (isLast) child.file = f;
      cursor = child;
    }
  }
  // Sort: directories first, alphabetical within each level.
  const sort = (n: TreeNode): void => {
    n.children.sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    for (const c of n.children) sort(c);
  };
  sort(root);
  return root;
}

function collectAncestorDirs(files: FileStatus[]): Set<string> {
  const out = new Set<string>();
  for (const f of files) {
    const parts = f.path.split("/");
    for (let i = 1; i < parts.length; i++) {
      out.add(parts.slice(0, i).join("/"));
    }
  }
  return out;
}

function flattenVisible(
  node: TreeNode,
  expanded: Set<string>,
  depth: number,
  out: { node: TreeNode; depth: number }[],
): void {
  for (const child of node.children) {
    out.push({ node: child, depth });
    if (child.isDir && expanded.has(child.fullPath)) {
      flattenVisible(child, expanded, depth + 1, out);
    }
  }
}

export function FileTree({
  files,
  focusedPath,
  onFileClick,
}: {
  files: FileStatus[];
  focusedPath: string | null;
  onFileClick: (path: string) => void;
}) {
  const tree = useMemo(() => buildTree(files), [files]);
  const [expanded, setExpanded] = useState<Set<string>>(
    () => collectAncestorDirs(files),
  );

  // When the set of files changes (new/removed from status), auto-expand
  // ancestors of any currently-changed file.
  useEffect(() => {
    setExpanded((prev) => {
      const next = new Set(prev);
      for (const dir of collectAncestorDirs(files)) next.add(dir);
      return next;
    });
  }, [files]);

  const visible = useMemo(() => {
    const out: { node: TreeNode; depth: number }[] = [];
    flattenVisible(tree, expanded, 0, out);
    return out;
  }, [tree, expanded]);

  const toggle = (dirPath: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(dirPath)) next.delete(dirPath);
      else next.add(dirPath);
      return next;
    });

  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-1 border-b border-neutral-200 px-2 py-1 text-xs dark:border-neutral-800">
        <button
          className="rounded px-1 hover:bg-neutral-100 dark:hover:bg-neutral-800"
          onClick={() =>
            setExpanded(new Set(collectAllDirs(tree)))
          }
          title="Expand all"
        >
          ＋
        </button>
        <button
          className="rounded px-1 hover:bg-neutral-100 dark:hover:bg-neutral-800"
          onClick={() => setExpanded(new Set())}
          title="Collapse all"
        >
          −
        </button>
      </div>
      <ul className="flex-1 overflow-auto font-mono text-xs">
        {visible.map(({ node, depth }) => (
          <li key={node.fullPath}>
            {node.isDir ? (
              <button
                onClick={() => toggle(node.fullPath)}
                className="flex w-full items-center gap-1 px-2 py-0.5 text-left hover:bg-neutral-100 dark:hover:bg-neutral-800"
                style={{ paddingLeft: 8 + depth * 12 }}
              >
                <span className="w-3 text-neutral-500">
                  {expanded.has(node.fullPath) ? "▾" : "▸"}
                </span>
                <span className="text-neutral-700 dark:text-neutral-300">
                  {node.name}
                </span>
                <span className="ml-1 text-neutral-400">
                  {countChanges(node)}
                </span>
              </button>
            ) : (
              <button
                onClick={() => node.file && onFileClick(node.file.path)}
                className={
                  "flex w-full items-center gap-1 px-2 py-0.5 text-left hover:bg-neutral-100 dark:hover:bg-neutral-800 " +
                  (focusedPath === node.file?.path
                    ? "bg-blue-100 dark:bg-blue-900"
                    : "")
                }
                style={{ paddingLeft: 8 + (depth + 1) * 12 }}
              >
                <span className="truncate">{node.name}</span>
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function collectAllDirs(node: TreeNode): string[] {
  const out: string[] = [];
  const walk = (n: TreeNode) => {
    if (n.isDir && n.fullPath) out.push(n.fullPath);
    for (const c of n.children) walk(c);
  };
  walk(node);
  return out;
}

function countChanges(node: TreeNode): string {
  let n = 0;
  const walk = (x: TreeNode) => {
    if (x.file) n++;
    for (const c of x.children) walk(c);
  };
  walk(node);
  return n > 0 ? `(${n})` : "";
}

// Export for j/k navigation: returns the visible file paths in order,
// matching what the user sees when the tree is rendered with the given
// expanded set. Used by shortcuts.tsx via a re-derivation helper on store.
export function visibleFilePathsForTree(
  files: FileStatus[],
  expanded: Set<string>,
): string[] {
  const tree = buildTree(files);
  const out: { node: TreeNode; depth: number }[] = [];
  flattenVisible(tree, expanded, 0, out);
  return out.filter((v) => !v.node.isDir).map((v) => v.node.file!.path);
}
```

Note on `j/k`: the existing shortcuts use `s.status.map((f) => f.path)`. In tree mode the visible order differs. We'll address this in Phase 8 when we restructure shortcuts — for now in Phase 4, `j/k` may skip files when tree view is active with collapsed dirs. That's an acceptable intermediate state documented here.

No commit yet — lands with Task 4.3.

---

### Task 4.2: Add tree/flat mode toggle to file-list.tsx

**Files:**
- Modify: `src/web/components/file-list.tsx`

- [ ] **Step 1: Read the file first**

Open `src/web/components/file-list.tsx` and locate the top-level render. There will be a header area (with the `/`-filter input) and the main grouped list.

- [ ] **Step 2: Import FileTree and useSettings**

```ts
import { FileTree } from "./file-tree";
import { useSettings } from "../settings";
```

- [ ] **Step 3: Add mode toggle button in the header**

Near the existing filter input or header, add:

```tsx
{(() => {
  const mode = useSettings((s) => s.fileListMode);
  const set = useSettings((s) => s.set);
  return (
    <div className="flex items-center gap-1">
      <button
        onClick={() => set({ fileListMode: "flat" })}
        title="Flat list"
        aria-pressed={mode === "flat"}
        className={
          "rounded px-1 text-xs " +
          (mode === "flat"
            ? "bg-neutral-200 dark:bg-neutral-700"
            : "hover:bg-neutral-100 dark:hover:bg-neutral-800")
        }
      >
        ☰
      </button>
      <button
        onClick={() => set({ fileListMode: "tree" })}
        title="Tree view"
        aria-pressed={mode === "tree"}
        className={
          "rounded px-1 text-xs " +
          (mode === "tree"
            ? "bg-neutral-200 dark:bg-neutral-700"
            : "hover:bg-neutral-100 dark:hover:bg-neutral-800")
        }
      >
        ▾
      </button>
    </div>
  );
})()}
```

- [ ] **Step 4: Swap the renderer based on mode**

In the same component, read:

```ts
const fileListMode = useSettings((s) => s.fileListMode);
```

Where the existing grouped flat list is rendered, wrap with:

```tsx
{fileListMode === "tree" ? (
  <FileTree
    files={status}
    focusedPath={focusedPath}
    onFileClick={(p) => focusFile(p)}
  />
) : (
  // existing flat grouped list JSX unchanged
)}
```

Use whatever names the file already uses for `status`, `focusedPath`, `focusFile` (likely via `useStore`).

- [ ] **Step 5: Run lint/type/test + smoke check**

```bash
bun run lint && bunx tsc -p tsconfig.web.json --noEmit && bun test
```

Smoke:
1. Open working-tree tab with some modified files.
2. Click tree icon — renders as directory tree, dirs containing changes expanded.
3. Collapse a dir — its children hide.
4. Click a file in the tree — diff loads on the right.
5. Click flat icon — returns to grouped list.
6. Reload — mode persists.
7. Reload in tree mode — the expanded set is re-seeded from current changes (not the pre-reload state, by design).

No commit yet — lands with Task 4.3.

---

### Task 4.3: Add `t` shortcut and commit phase 4

**Files:**
- Modify: `src/web/components/shortcuts.tsx`

- [ ] **Step 1: Import useSettings**

At the top:

```ts
import { useSettings } from "../settings";
```

- [ ] **Step 2: Add `t` binding**

Inside `handler`, after the `,` binding added in Task 3.3 (and before the filter-slash binding), add:

```ts
if (e.key === "t") {
  const cur = useSettings.getState().fileListMode;
  useSettings.getState().set({ fileListMode: cur === "tree" ? "flat" : "tree" });
  return;
}
```

- [ ] **Step 3: Commit phase 4**

```bash
bun run lint && bunx tsc -p tsconfig.web.json --noEmit && bun test
git add src/web/components/file-tree.tsx src/web/components/file-list.tsx src/web/components/shortcuts.tsx
git commit -m "feat(web): file-tree view with flat/tree mode toggle"
```

---

## Phase 5 — Command palette

### Task 5.1: TDD the fuzzy matcher

**Files:**
- Create: `src/web/lib/fuzzy.ts`
- Create: `test/fuzzy.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// test/fuzzy.test.ts
import { describe, expect, test } from "bun:test";
import { fuzzyScore, fuzzyFilter } from "../src/web/lib/fuzzy";

describe("fuzzyScore", () => {
  test("empty query matches everything with score 0", () => {
    expect(fuzzyScore("hello world", "")).toBe(0);
  });
  test("exact substring scores higher than scattered match", () => {
    const a = fuzzyScore("hello world", "world");
    const b = fuzzyScore("wiserldrld", "world");
    expect(a).toBeGreaterThan(b);
  });
  test("acronym match scores positive", () => {
    expect(fuzzyScore("Toggle Blame View", "tbv")).toBeGreaterThan(0);
  });
  test("no match returns -Infinity", () => {
    expect(fuzzyScore("hello", "xyz")).toBe(-Infinity);
  });
  test("case insensitive", () => {
    expect(fuzzyScore("Hello World", "world")).toBeGreaterThan(0);
  });
});

describe("fuzzyFilter", () => {
  test("sorts results by score descending, ties stable", () => {
    const items = ["apple", "application", "banana", "pineapple"];
    const result = fuzzyFilter(items, "app", (x) => x);
    expect(result[0]).toBe("apple");
    expect(result).toContain("application");
    expect(result).toContain("pineapple");
    expect(result).not.toContain("banana");
  });
});
```

- [ ] **Step 2: Run test to verify failure**

```bash
bun test test/fuzzy.test.ts
```

Expected: FAIL with "cannot find module '../src/web/lib/fuzzy'".

- [ ] **Step 3: Implement**

```ts
// src/web/lib/fuzzy.ts
// Tiny fuzzy matcher: substring and acronym scoring.
// No external dependencies.

export function fuzzyScore(haystack: string, needle: string): number {
  if (needle === "") return 0;
  const h = haystack.toLowerCase();
  const n = needle.toLowerCase();

  // Exact substring: highest score.
  const idx = h.indexOf(n);
  if (idx !== -1) {
    // Earlier match = higher score. Shorter haystack = higher score.
    return 1000 - idx - (h.length - n.length) * 0.1;
  }

  // Acronym match: each needle char must match first char of a word
  // (run of non-whitespace after whitespace) in order.
  const words = h.split(/[\s/_-]+/).filter((w) => w.length > 0);
  let wi = 0;
  let ni = 0;
  while (ni < n.length && wi < words.length) {
    if (words[wi]!.startsWith(n[ni]!)) {
      ni++;
    }
    wi++;
  }
  if (ni === n.length) {
    return 500 - wi;
  }

  // Scattered match: each needle char appears in order.
  let hi = 0;
  let matched = 0;
  for (const c of n) {
    const found = h.indexOf(c, hi);
    if (found === -1) return -Infinity;
    hi = found + 1;
    matched++;
  }
  if (matched === n.length) return 100 - h.length * 0.01;
  return -Infinity;
}

export function fuzzyFilter<T>(
  items: T[],
  query: string,
  getText: (item: T) => string,
): T[] {
  if (query === "") return items.slice();
  const scored: { item: T; score: number }[] = [];
  for (const item of items) {
    const score = fuzzyScore(getText(item), query);
    if (score > -Infinity) scored.push({ item, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.map((s) => s.item);
}
```

- [ ] **Step 4: Run tests to verify pass**

```bash
bun test test/fuzzy.test.ts
```

Expected: PASS.

No commit yet — lands with Task 5.4.

---

### Task 5.2: Create actions registry

**Files:**
- Create: `src/web/lib/actions.ts`

- [ ] **Step 1: Create the file**

```ts
// src/web/lib/actions.ts
// Command palette actions registry.
// Each action has an id, human label, optional shortcut hint,
// and a run function that receives the store.
import { useSettings } from "../settings";
import { useStore } from "../store";
import type { Tab } from "../store";

export interface PaletteAction {
  id: string;
  label: string;
  hint?: string;
  run(): void;
}

function switchTab(tab: Tab) {
  useStore.getState().setTab(tab);
}

export function buildActions(): PaletteAction[] {
  return [
    {
      id: "tab.working-tree",
      label: "Go to Working Tree",
      hint: "g w",
      run: () => switchTab("working-tree"),
    },
    {
      id: "tab.history",
      label: "Go to History",
      hint: "g h",
      run: () => switchTab("history"),
    },
    {
      id: "tab.branches",
      label: "Go to Branches",
      hint: "g b",
      run: () => switchTab("branches"),
    },
    {
      id: "tab.stashes",
      label: "Go to Stashes",
      hint: "g s",
      run: () => switchTab("stashes"),
    },
    {
      id: "diff.toggle-mode",
      label: "Toggle Unified / Split Diff",
      hint: "u",
      run: () => {
        const s = useStore.getState();
        s.setDiffMode(s.diffMode === "unified" ? "split" : "unified");
      },
    },
    {
      id: "list.toggle-mode",
      label: "Toggle Flat / Tree File List",
      hint: "t",
      run: () => {
        const cur = useSettings.getState().fileListMode;
        useSettings
          .getState()
          .set({ fileListMode: cur === "tree" ? "flat" : "tree" });
      },
    },
    {
      id: "updates.toggle-pause",
      label: "Toggle Pause Live Updates",
      hint: "p",
      run: () => useStore.getState().togglePaused(),
    },
    {
      id: "settings.open",
      label: "Open Settings",
      hint: ",",
      run: () => useStore.getState().openSettings(),
    },
    {
      id: "file.copy-path",
      label: "Copy Current File Path",
      run: () => {
        const p = useStore.getState().focusedPath;
        if (p) void navigator.clipboard.writeText(p);
      },
    },
  ];
}
```

Note: the "Toggle Blame" action is intentionally **not** added in Phase 5. It's added in Task 7.2's amendment to this file (see that task), because `store.toggleBlame` only exists after Phase 7.

No commit yet — lands with Task 5.4.

---

### Task 5.3: Create the CommandPalette component

**Files:**
- Create: `src/web/components/command-palette.tsx`

- [ ] **Step 1: Create the file**

```tsx
// src/web/components/command-palette.tsx
import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../store";
import { buildActions, type PaletteAction } from "../lib/actions";
import { fuzzyFilter } from "../lib/fuzzy";

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

  const actions = useMemo(() => {
    return buildActions().filter((a) => {
      // Defensive: some actions reference store methods added in later phases.
      try {
        // Cheap probe: every action function is guarded inside; we trust them.
        return true;
      } catch {
        return false;
      }
    });
  }, []);

  const items = useMemo(() => {
    // Filter actions
    const filteredActions = fuzzyFilter(actions, query, (a) => a.label).map(
      (a) => ({ kind: "action" as const, action: a }),
    );

    // Contextual items
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

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        close();
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelIdx((i) => Math.min(i + 1, flatList.length - 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelIdx((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        const chosen = flatList[selIdx];
        if (!chosen) return;
        activate(chosen);
      }
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () =>
      window.removeEventListener("keydown", onKey, { capture: true });
  }, [open, flatList, selIdx, close]);

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

  if (!open) return null;

  return (
    <div
      onClick={close}
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-24"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-[520px] overflow-hidden rounded-lg bg-white shadow-xl dark:bg-neutral-900"
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Type an action, file, commit, branch, or stash…"
          className="w-full border-b border-neutral-200 bg-transparent px-4 py-3 text-sm outline-none dark:border-neutral-800"
          autoFocus
        />
        <div className="max-h-[400px] overflow-auto">
          {items.actions.length > 0 && (
            <Section title="Actions">
              {items.actions.map((entry, i) => {
                const gi = i;
                return (
                  <Row
                    key={entry.action.id}
                    selected={gi === selIdx}
                    onClick={() => activate(entry)}
                  >
                    <span>{entry.action.label}</span>
                    {entry.action.hint && (
                      <span className="ml-auto font-mono text-xs text-neutral-500">
                        {entry.action.hint}
                      </span>
                    )}
                  </Row>
                );
              })}
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
            <div className="px-4 py-6 text-center text-sm text-neutral-500">
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
      <div className="bg-neutral-50 px-4 py-1 text-[10px] font-semibold uppercase tracking-wide text-neutral-500 dark:bg-neutral-800/50">
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
          ? "bg-blue-100 dark:bg-blue-900/50"
          : "hover:bg-neutral-100 dark:hover:bg-neutral-800")
      }
    >
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
```

No commit yet — lands with Task 5.4.

---

### Task 5.4: Mount palette + wire `Cmd+K` + commit phase 5

**Files:**
- Modify: `src/web/app.tsx`
- Modify: `src/web/components/shortcuts.tsx`

- [ ] **Step 1: Mount `<CommandPalette />` in app.tsx**

Add import:

```ts
import { CommandPalette } from "./components/command-palette";
```

Render `<CommandPalette />` at the root level alongside `<SettingsModal />`.

- [ ] **Step 2: Wire `Cmd+K` in shortcuts.tsx**

Inside `handler`, after the existing input-target early return and before the `?` binding, add:

```ts
if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
  e.preventDefault();
  useStore.getState().openPalette();
  return;
}
```

- [ ] **Step 3: Run lint/type/test**

```bash
bun run lint && bunx tsc -p tsconfig.web.json --noEmit && bun test
```

- [ ] **Step 4: Smoke check**

1. Press `Cmd+K` → palette opens.
2. Type "go history" → the "Go to History" action filters to the top.
3. Enter → switches to history tab, palette closes.
4. Press `Cmd+K` on the working-tree tab → type a file name → Enter → the file opens in the diff view.
5. Press `Cmd+K` on the branches tab → type a branch name → Enter → focuses that branch.
6. Esc closes the palette.

- [ ] **Step 5: Commit phase 5**

```bash
git add src/web/lib/fuzzy.ts test/fuzzy.test.ts src/web/lib/actions.ts src/web/components/command-palette.tsx src/web/app.tsx src/web/components/shortcuts.tsx
git commit -m "feat(web): command palette (Cmd+K) with actions + contextual items"
```

---

## Phase 6 — Backend blame endpoint

### Task 6.1: Add BlameLine type

**Files:**
- Modify: `src/shared/types.ts`

- [ ] **Step 1: Append to the file**

Add at the bottom of `src/shared/types.ts`:

```ts
export interface BlameLine {
  /** 1-based line number in the HEAD version of the file. */
  lineNumber: number;
  /** Full 40-char sha. */
  sha: string;
  /** First 7 chars of sha. */
  shaShort: string;
  /** Commit author name. */
  author: string;
  /** ISO 8601 author time. */
  authorTimeIso: string;
  /** One-line commit summary. */
  summary: string;
}
```

No commit yet — lands with Task 6.6.

---

### Task 6.2: Write failing test for blameFile

**Files:**
- Create: `test/blame.test.ts`

- [ ] **Step 1: Create the test file**

```ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createTempRepo, type TempRepo } from "./helpers/temp-repo";
import { blameFile } from "../src/server/blame";

describe("blameFile", () => {
  let temp: TempRepo;
  beforeEach(() => {
    temp = createTempRepo();
  });
  afterEach(() => {
    temp.cleanup();
  });

  test("returns one BlameLine per HEAD line", async () => {
    temp.write("a.ts", "one\ntwo\nthree\n");
    temp.git("add", ".");
    temp.git("commit", "-m", "init");

    const lines = await blameFile(temp.root, "a.ts");
    expect(lines).toHaveLength(3);
    expect(lines[0]!.lineNumber).toBe(1);
    expect(lines[0]!.author).toBe("Test");
    expect(lines[0]!.summary).toBe("init");
    expect(lines[0]!.shaShort).toHaveLength(7);
    expect(lines[0]!.sha).toHaveLength(40);
  });

  test("attributes different lines to different commits", async () => {
    temp.write("a.ts", "one\ntwo\n");
    temp.git("add", ".");
    temp.git("commit", "-m", "first");
    temp.write("a.ts", "one\ntwo\nTHREE\n");
    temp.git("add", ".");
    temp.git("commit", "-m", "second");

    const lines = await blameFile(temp.root, "a.ts");
    expect(lines).toHaveLength(3);
    expect(lines[0]!.summary).toBe("first");
    expect(lines[1]!.summary).toBe("first");
    expect(lines[2]!.summary).toBe("second");
  });

  test("throws for a file with no HEAD version", async () => {
    temp.write("a.ts", "hello\n");
    temp.git("add", ".");
    temp.git("commit", "-m", "init");
    temp.write("b.ts", "new\n");
    // b.ts is untracked
    await expect(blameFile(temp.root, "b.ts")).rejects.toBeDefined();
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
bun test test/blame.test.ts
```

Expected: FAIL with "Cannot find module '../src/server/blame'".

No commit yet — lands with Task 6.6.

---

### Task 6.3: Implement blameFile

**Files:**
- Create: `src/server/blame.ts`

**Context on `git blame --porcelain`**: The porcelain format is stable, documented, and easy to parse. For each group of lines attributed to a commit it emits a header block like:

```
<40-char-sha> <original-line> <final-line> [<num-lines>]
author Eric Baruch
author-mail <eric@example.com>
author-time 1712668268
author-tz +0000
committer ...
summary some short summary
... (plus other metadata lines)
filename a.ts
	<tab-prefixed source line>
```

Subsequent lines in the same block that re-use the same commit omit the author/summary/etc. metadata — they carry only the sha+original+final header and the tab-prefixed content. Rule: cache the commit metadata by sha; every time you see a header line, set the "current sha" and if you haven't seen that sha before, collect the next `author` / `author-time` / `summary` lines into the cache. Emit one `BlameLine` per content line (the tab-prefixed ones).

- [ ] **Step 1: Create the file**

```ts
// src/server/blame.ts
import { spawn } from "node:child_process";
import type { BlameLine } from "../shared/types";

async function runGit(cwd: string, args: readonly string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", args as string[], { cwd });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d.toString("utf8")));
    child.stderr.on("data", (d) => (stderr += d.toString("utf8")));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`git blame failed (${code}): ${stderr}`));
    });
  });
}

interface CommitMeta {
  author: string;
  authorTimeIso: string;
  summary: string;
}

/**
 * Parse `git blame --porcelain` output into a flat BlameLine[].
 */
export function parseBlamePorcelain(raw: string): BlameLine[] {
  const out: BlameLine[] = [];
  const metaBySha = new Map<string, CommitMeta>();
  let currentSha = "";
  let currentFinalLine = 0;
  let partialMeta: Partial<CommitMeta> = {};

  const lines = raw.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (line === "") continue;

    if (line.startsWith("\t")) {
      // Content line — emit one BlameLine using the current sha + cached meta.
      const meta = metaBySha.get(currentSha);
      if (!meta) {
        // Shouldn't happen, but be defensive.
        continue;
      }
      out.push({
        lineNumber: currentFinalLine,
        sha: currentSha,
        shaShort: currentSha.slice(0, 7),
        author: meta.author,
        authorTimeIso: meta.authorTimeIso,
        summary: meta.summary,
      });
      continue;
    }

    // A line that starts with a 40-char hex sha followed by two or three numbers
    // is a header. Example:
    //   "a1b2c3...hex40 3 5" or "a1b2c3...hex40 3 5 2"
    const headerMatch = /^([0-9a-f]{40}) (\d+) (\d+)(?: (\d+))?$/.exec(line);
    if (headerMatch) {
      currentSha = headerMatch[1]!;
      currentFinalLine = parseInt(headerMatch[3]!, 10);
      if (!metaBySha.has(currentSha)) {
        partialMeta = {};
      }
      continue;
    }

    // Metadata lines for the current sha, only needed on first sight.
    if (!metaBySha.has(currentSha)) {
      if (line.startsWith("author ")) {
        partialMeta.author = line.slice("author ".length);
      } else if (line.startsWith("author-time ")) {
        const unix = parseInt(line.slice("author-time ".length), 10);
        partialMeta.authorTimeIso = new Date(unix * 1000).toISOString();
      } else if (line.startsWith("summary ")) {
        partialMeta.summary = line.slice("summary ".length);
      } else if (line === "boundary" || line.startsWith("previous ") ||
                 line.startsWith("filename ") || line.startsWith("author-mail ") ||
                 line.startsWith("author-tz ") || line.startsWith("committer ")) {
        // known metadata we don't use — skip
      }

      // When we have all three required fields, commit the meta to the cache.
      if (
        partialMeta.author !== undefined &&
        partialMeta.authorTimeIso !== undefined &&
        partialMeta.summary !== undefined
      ) {
        metaBySha.set(currentSha, {
          author: partialMeta.author,
          authorTimeIso: partialMeta.authorTimeIso,
          summary: partialMeta.summary,
        });
      }
    }
  }

  return out;
}

/**
 * Blame a file at HEAD. Throws if the file has no HEAD version
 * (untracked, deleted, etc.).
 */
export async function blameFile(
  cwd: string,
  path: string,
): Promise<BlameLine[]> {
  const out = await runGit(cwd, ["blame", "--porcelain", "HEAD", "--", path]);
  return parseBlamePorcelain(out);
}
```

- [ ] **Step 2: Run tests to verify pass**

```bash
bun test test/blame.test.ts
```

Expected: all 3 tests PASS. If the first test fails because the author-mail line comes before `author` in some git versions, verify by running `git blame --porcelain HEAD -- a.ts` manually in a test repo — the order is defined by git's porcelain format spec and puts `author` first. If a failure happens, the most likely cause is the `partialMeta` not being fully populated when we cache it; the code above handles that via the "all three required fields" gate.

No commit yet — lands with Task 6.6.

---

### Task 6.4: Register HTTP route + add cache

**Files:**
- Modify: `src/server/http.ts`
- Modify: `src/server/blame.ts`

- [ ] **Step 1: Add the LRU cache to blame.ts**

Append to `src/server/blame.ts`:

```ts
// Bounded LRU cache keyed by `${path}@${headSha}`.
const CACHE_MAX = 256;
const blameCache = new Map<string, BlameLine[]>();

export function getCachedBlame(
  path: string,
  headSha: string,
): BlameLine[] | undefined {
  const key = `${path}@${headSha}`;
  const hit = blameCache.get(key);
  if (hit === undefined) return undefined;
  // LRU touch
  blameCache.delete(key);
  blameCache.set(key, hit);
  return hit;
}

export function setCachedBlame(
  path: string,
  headSha: string,
  lines: BlameLine[],
): void {
  const key = `${path}@${headSha}`;
  blameCache.set(key, lines);
  while (blameCache.size > CACHE_MAX) {
    const oldest = blameCache.keys().next().value;
    if (oldest !== undefined) blameCache.delete(oldest);
  }
}

export function invalidateBlameCache(): void {
  blameCache.clear();
}
```

- [ ] **Step 2: Add the route to http.ts**

Add imports:

```ts
import {
  blameFile,
  getCachedBlame,
  setCachedBlame,
  invalidateBlameCache,
} from "./blame";
```

Inside the `handle` function, after the existing `/api/diff` handler, add:

```ts
if (pathname === "/api/blame") {
  if (!repo) return json({ error: "no repo loaded" }, 400);
  const path = url.searchParams.get("path");
  if (!path) return json({ error: "path required" }, 400);
  // Reject absolute paths and parent traversals — same rule as diff.
  if (path.startsWith("/") || path.includes("..")) {
    return json({ error: "invalid path" }, 400);
  }
  try {
    // Resolve current HEAD sha for cache keying.
    const info = await repo.getRepoRoot();
    void info; // just verifies repo is valid
    const { spawnSync } = await import("node:child_process");
    const headR = spawnSync("git", ["rev-parse", "HEAD"], {
      cwd: repo.cwd,
      encoding: "utf8",
    });
    if (headR.status !== 0) {
      return json({ error: "no HEAD" }, 404);
    }
    const headSha = headR.stdout.trim();
    const cached = getCachedBlame(path, headSha);
    if (cached) return json(cached);
    const lines = await blameFile(repo.cwd, path);
    setCachedBlame(path, headSha, lines);
    return json(lines);
  } catch (err) {
    // File with no HEAD version or git errors → 404
    return json(
      { error: err instanceof Error ? err.message : String(err) },
      404,
    );
  }
}
```

- [ ] **Step 3: Invalidate cache on head-changed**

Find where the `events.ts` hub detects `head-changed` (or where `http.ts` responds to it if the invalidation hook is HTTP-layer). The simplest approach: invalidate the entire cache on every `head-changed` event, which keeps the logic trivial.

Open `src/server/events.ts` and search for the emission of `"head-changed"`. Wherever that event is sent, add:

```ts
import { invalidateBlameCache } from "./blame";
// ...
invalidateBlameCache();
```

immediately before the `send({ type: "head-changed", ... })` call.

If the hub is structured in a way that makes this awkward (e.g. the emit is abstracted), invalidate in the `handle` function of `http.ts` — subscribe once at startup:

```ts
if (hub) {
  hub.subscribe((e) => {
    if (e.type === "head-changed") invalidateBlameCache();
  });
}
```

Use whichever integration point matches the existing `events.ts` style. No new subscription if `events.ts` already exposes a direct insertion point.

- [ ] **Step 4: Run tests + smoke**

```bash
bun run lint && bunx tsc -p tsconfig.web.json --noEmit && bun test
```

Smoke:
```bash
curl -s "http://localhost:41111/api/blame?path=README.md" | head -n 1
```

(Against a running dev backend on a real committed file.) Expected: a JSON array of `BlameLine` objects.

No commit yet — lands with Task 6.6.

---

### Task 6.5: Add `api.blame` to the frontend API client

**Files:**
- Modify: `src/web/lib/api.ts`

- [ ] **Step 1: Add BlameLine import + method**

At the top:

```ts
import type { BlameLine } from "@shared/types";
```

Inside the `api` object, add:

```ts
blame: (path: string) =>
  fetchJson<BlameLine[]>(`/api/blame?path=${encodeURIComponent(path)}`),
```

Note: this throws on 404 (no HEAD version), which callers will catch.

No commit yet — lands with Task 6.6.

---

### Task 6.6: Commit phase 6

- [ ] **Step 1: Commit**

```bash
git add src/shared/types.ts src/server/blame.ts src/server/http.ts src/server/events.ts src/web/lib/api.ts test/blame.test.ts
git commit -m "feat(server): /api/blame endpoint with porcelain parser + LRU cache"
```

---

## Phase 7 — Diff-view blame + open-in-editor

### Task 7.1: TDD editor-urls

**Files:**
- Create: `src/web/lib/editor-urls.ts`
- Create: `test/editor-urls.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// test/editor-urls.test.ts
import { describe, expect, test } from "bun:test";
import { editorUrl } from "../src/web/lib/editor-urls";

describe("editorUrl", () => {
  test("vscode format", () => {
    expect(editorUrl("vscode", "/a/b/c.ts", 10, 1)).toBe(
      "vscode://file/a/b/c.ts:10:1",
    );
  });
  test("cursor format", () => {
    expect(editorUrl("cursor", "/a/b/c.ts", 10, 1)).toBe(
      "cursor://file/a/b/c.ts:10:1",
    );
  });
  test("zed format", () => {
    expect(editorUrl("zed", "/a/b/c.ts", 10, 1)).toBe(
      "zed://file/a/b/c.ts:10:1",
    );
  });
  test("idea format", () => {
    expect(editorUrl("idea", "/a/b/c.ts", 10, 1)).toBe(
      "idea://open?file=/a/b/c.ts&line=10",
    );
  });
  test("subl format", () => {
    expect(editorUrl("subl", "/a/b/c.ts", 10, 1)).toBe(
      "subl://open?url=file:///a/b/c.ts&line=10",
    );
  });
  test("none returns null", () => {
    expect(editorUrl("none", "/a/b/c.ts", 10, 1)).toBe(null);
  });
  test("encodes path with spaces", () => {
    expect(editorUrl("vscode", "/a b/c.ts", 1, 1)).toBe(
      "vscode://file/a%20b/c.ts:1:1",
    );
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
bun test test/editor-urls.test.ts
```

Expected: FAIL with "cannot find module".

- [ ] **Step 3: Implement**

```ts
// src/web/lib/editor-urls.ts
import type { Editor } from "../settings";

export function editorUrl(
  editor: Editor,
  absPath: string,
  line: number,
  col: number,
): string | null {
  if (editor === "none") return null;
  const encoded = absPath.split("/").map(encodeURIComponent).join("/");
  switch (editor) {
    case "vscode":
      return `vscode://file${encoded}:${line}:${col}`;
    case "cursor":
      return `cursor://file${encoded}:${line}:${col}`;
    case "zed":
      return `zed://file${encoded}:${line}:${col}`;
    case "idea":
      return `idea://open?file=${encoded}&line=${line}`;
    case "subl":
      return `subl://open?url=file://${encoded}&line=${line}`;
    default:
      return null;
  }
}
```

- [ ] **Step 4: Run to verify pass**

```bash
bun test test/editor-urls.test.ts
```

Expected: PASS.

No commit yet — lands with Task 7.7.

---

### Task 7.2: Add blame state to store.ts

**Files:**
- Modify: `src/web/store.ts`

- [ ] **Step 1: Add fields and actions**

Add imports:

```ts
import type { BlameLine } from "@shared/types";
import { api } from "./lib/api";
```

(`api` is likely already imported — verify.)

Add to `StoreState`:

```ts
blameOnFor: Set<string>;
blameCache: Map<string, BlameLine[]>; // key: `${path}@${headSha}`
blameLoading: Set<string>;
toggleBlame: (path: string) => void;
ensureBlameLoaded: (path: string) => Promise<void>;
```

Add to the `create` initial state:

```ts
blameOnFor: new Set<string>(),
blameCache: new Map<string, BlameLine[]>(),
blameLoading: new Set<string>(),
```

Add the actions inside the `create` callback:

```ts
toggleBlame: (path) => {
  const s = get();
  const on = new Set(s.blameOnFor);
  const wasOn = on.has(path);
  if (wasOn) on.delete(path);
  else on.add(path);
  set({ blameOnFor: on });
  if (!wasOn) void s.ensureBlameLoaded(path);
},

ensureBlameLoaded: async (path) => {
  const s = get();
  const headSha = s.repo?.headSha ?? "";
  const key = `${path}@${headSha}`;
  if (s.blameCache.has(key)) return;
  if (s.blameLoading.has(path)) return;
  const loading = new Set(s.blameLoading);
  loading.add(path);
  set({ blameLoading: loading });
  try {
    const lines = await api.blame(path);
    const cache = new Map(get().blameCache);
    cache.set(key, lines);
    set({ blameCache: cache });
  } catch (err) {
    // Non-fatal — surface a toast.
    const msg = err instanceof Error ? err.message : String(err);
    set({
      toasts: [
        ...get().toasts,
        { id: Date.now(), kind: "warning", message: `Blame failed: ${msg}` },
      ],
    });
    // Turn blame off for this file so we don't spin.
    const on = new Set(get().blameOnFor);
    on.delete(path);
    set({ blameOnFor: on });
  } finally {
    const loading2 = new Set(get().blameLoading);
    loading2.delete(path);
    set({ blameLoading: loading2 });
  }
},
```

- [ ] **Step 2: Apply sticky behavior on focusFile**

Modify `focusFile` to honor `blameStickyOn`:

Inside the existing `focusFile` action, after `set({ focusedPath: path, focusedDiff: null })` and before the diff fetch, add:

```ts
const sticky = useSettings.getState().blameStickyOn;
if (sticky) {
  const on = new Set(get().blameOnFor);
  if (!on.has(path)) on.add(path);
  set({ blameOnFor: on });
  void get().ensureBlameLoaded(path);
}
```

- [ ] **Step 3: Invalidate blame cache on `head-changed` SSE**

Inside `handleEvent`, in the `case "head-changed":` block, add:

```ts
set({ blameCache: new Map(), blameOnFor: new Set() });
```

(Clear both so we don't show stale blame against a new HEAD.)

- [ ] **Step 4: Register the Blame action in the palette**

Open `src/web/lib/actions.ts` and add this entry to the array returned by `buildActions()`, right after the `file.copy-path` action:

```ts
{
  id: "blame.toggle",
  label: "Toggle Blame on Current File",
  hint: "b",
  run: () => {
    const p = useStore.getState().focusedPath;
    if (p) useStore.getState().toggleBlame(p);
  },
},
```

- [ ] **Step 5: Type check**

```bash
bunx tsc -p tsconfig.web.json --noEmit
```

Expected: clean.

No commit yet — lands with Task 7.7.

---

### Task 7.3: Create BlameGutter component

**Files:**
- Create: `src/web/components/blame-gutter.tsx`

- [ ] **Step 1: Create the file**

```tsx
// src/web/components/blame-gutter.tsx
import type { BlameLine } from "@shared/types";
import { useStore } from "../store";

export function BlameGutter({
  blame,
  lineNumber,
}: {
  blame: BlameLine[] | undefined;
  lineNumber: number | undefined;
}) {
  if (!blame || lineNumber === undefined) {
    return <span className="w-28 shrink-0 text-right text-neutral-400">—</span>;
  }
  const entry = blame[lineNumber - 1];
  if (!entry) {
    return <span className="w-28 shrink-0 text-right text-neutral-400">—</span>;
  }
  const rel = formatRelative(entry.authorTimeIso);
  const initials = entry.author
    .split(" ")
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  return (
    <button
      onClick={() => {
        useStore.getState().focusCommit(entry.sha);
        useStore.getState().setTab("history");
      }}
      title={`${entry.author} • ${entry.authorTimeIso}\n${entry.summary}`}
      className="w-28 shrink-0 overflow-hidden truncate text-right font-mono text-[10px] text-neutral-500 hover:text-blue-500"
    >
      <span>{entry.shaShort}</span>
      <span className="mx-1">{initials}</span>
      <span>{rel}</span>
    </button>
  );
}

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  const diff = Date.now() - then;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo`;
  const years = Math.floor(days / 365);
  return `${years}y`;
}
```

No commit yet — lands with Task 7.7.

---

### Task 7.4: Create OpenInEditor affordances

**Files:**
- Create: `src/web/components/open-in-editor.tsx`

- [ ] **Step 1: Create the file**

```tsx
// src/web/components/open-in-editor.tsx
import { useSettings } from "../settings";
import { editorUrl } from "../lib/editor-urls";

export function OpenInEditorLineIcon({
  absPath,
  line,
}: {
  absPath: string;
  line: number;
}) {
  const editor = useSettings((s) => s.editor);
  if (editor === "none") return null;
  const url = editorUrl(editor, absPath, line, 1);
  if (!url) return null;
  return (
    <a
      href={url}
      title={`Open in ${editor} at line ${line}`}
      className="ml-1 text-neutral-400 opacity-0 hover:text-blue-500 group-hover:opacity-100"
      onClick={(e) => e.stopPropagation()}
    >
      ↗
    </a>
  );
}

export function OpenInEditorHeaderButton({
  absPath,
  firstLine,
}: {
  absPath: string;
  firstLine: number;
}) {
  const editor = useSettings((s) => s.editor);
  if (editor === "none") return null;
  const url = editorUrl(editor, absPath, firstLine, 1);
  if (!url) return null;
  return (
    <a
      href={url}
      title={`Open in ${editor}`}
      className="rounded border border-neutral-300 px-2 py-0.5 text-xs hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
    >
      Open in editor
    </a>
  );
}
```

No commit yet — lands with Task 7.7.

---

### Task 7.5: Wire blame gutter + open-in-editor into diff-view.tsx

**Files:**
- Modify: `src/web/components/diff-view.tsx`

- [ ] **Step 1: Read the file to locate the line-render loop**

Open `src/web/components/diff-view.tsx`. Find where the component maps `diff.hunks[].lines[]` to rendered rows. That's where the blame column and open-in-editor icon need to insert.

- [ ] **Step 2: Add imports**

```ts
import { BlameGutter } from "./blame-gutter";
import {
  OpenInEditorLineIcon,
  OpenInEditorHeaderButton,
} from "./open-in-editor";
import { useSettings } from "../settings";
```

- [ ] **Step 3: Read blame state from store**

Inside the component body:

```ts
const focusedPath = useStore((s) => s.focusedPath);
const blameOnFor = useStore((s) => s.blameOnFor);
const blameCache = useStore((s) => s.blameCache);
const repo = useStore((s) => s.repo);
const toggleBlame = useStore((s) => s.toggleBlame);

const blameOn = focusedPath ? blameOnFor.has(focusedPath) : false;
const blameKey =
  focusedPath && repo ? `${focusedPath}@${repo.headSha}` : null;
const blame = blameKey ? blameCache.get(blameKey) : undefined;
```

- [ ] **Step 4: Add blame toggle in the diff header**

Find the diff header (where the unified/split toggle lives). Add:

```tsx
{focusedPath && (
  <>
    <button
      onClick={() => toggleBlame(focusedPath)}
      aria-pressed={blameOn}
      title="Toggle blame (HEAD only) — b"
      className={
        "rounded px-2 py-0.5 text-xs " +
        (blameOn
          ? "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-200"
          : "hover:bg-neutral-100 dark:hover:bg-neutral-800")
      }
    >
      Blame
    </button>
    <OpenInEditorHeaderButton
      absPath={`${repo?.root ?? ""}/${focusedPath}`}
      firstLine={firstHunkLine(diff)}
    />
  </>
)}
```

Where `firstHunkLine` is a tiny helper (add near top of the file):

```ts
import type { ParsedDiff } from "@shared/types";
function firstHunkLine(d: ParsedDiff | null): number {
  return d?.hunks[0]?.newStart ?? 1;
}
```

- [ ] **Step 5: Add blame column to each rendered diff line**

In the JSX for a diff line row, replace the top-level structure to include the blame column and the hover-icon:

```tsx
<div className="group flex items-start gap-2">
  {blameOn && (
    <BlameGutter blame={blame} lineNumber={line.newLine ?? line.oldLine} />
  )}
  <span className="w-10 shrink-0 text-right text-neutral-400">
    {line.newLine ?? line.oldLine ?? ""}
  </span>
  <span className="flex-1 whitespace-pre font-mono text-sm">{line.text}</span>
  {focusedPath && line.newLine && (
    <OpenInEditorLineIcon
      absPath={`${repo?.root ?? ""}/${focusedPath}`}
      line={line.newLine}
    />
  )}
</div>
```

Adapt class names to match the existing row structure; the key additions are:
- The `group` class on the wrapper (so `group-hover:opacity-100` works on the icon)
- The `{blameOn && <BlameGutter …/>}` at the start
- The `<OpenInEditorLineIcon …/>` at the end

Do not duplicate the existing row — modify it in place.

- [ ] **Step 6: Disable blame button on working-tree staged/unstaged diffs**

Working-tree diffs are blameable at HEAD because the file path has a HEAD version. The spec says blame is HEAD-only, which works even for a modified working-tree file — we're blaming the HEAD contents, not the dirty version. So the button is **not** disabled for working-tree diffs. Remove any "disable when unstaged" thinking — just let it work.

(If the backend `blameFile` throws for a file that's new/untracked, `ensureBlameLoaded` already handles that by toasting and turning blame off for that file.)

- [ ] **Step 7: Run lint/type/test**

```bash
bun run lint && bunx tsc -p tsconfig.web.json --noEmit && bun test
```

Expected: all pass.

- [ ] **Step 8: Smoke check**

1. Open a committed file in the working-tree tab.
2. Click "Blame" in the diff header — blame column appears.
3. Hover on a line → `↗` icon appears on the right.
4. Configure editor = VS Code in Settings → click the `↗` → VS Code opens at that line (or browser prompts to open the URL).
5. Configure editor = None → icons disappear.
6. Click a blame sha → history tab with that commit focused.
7. Toggle blame off → column disappears.
8. With sticky blame on (from Settings), click another file → blame auto-loads.
9. Commit something in the repo → blame cache clears, next blame fetch is fresh.

No commit yet — lands with Task 7.7.

---

### Task 7.6: Wire `b` shortcut to toggle blame

**Files:**
- Modify: `src/web/components/shortcuts.tsx`

- [ ] **Step 1: Add `b` binding**

Inside `handler`, alongside the existing single-letter bindings:

```ts
if (e.key === "b") {
  const p = useStore.getState().focusedPath;
  if (p) useStore.getState().toggleBlame(p);
  return;
}
```

No commit yet — lands with Task 7.7.

---

### Task 7.7: Commit phase 7

- [ ] **Step 1: Final lint + test**

```bash
bun run lint && bunx tsc -p tsconfig.web.json --noEmit && bun test
```

- [ ] **Step 2: Commit**

```bash
git add src/web/lib/editor-urls.ts test/editor-urls.test.ts src/web/store.ts src/web/lib/actions.ts src/web/components/blame-gutter.tsx src/web/components/open-in-editor.tsx src/web/components/diff-view.tsx src/web/components/shortcuts.tsx
git commit -m "feat(web): inline blame gutter + open-in-editor affordances"
```

---

## Phase 8 — Remaining shortcuts + help overlay

### Task 8.1: Restructure shortcuts.tsx into priority chain

**Files:**
- Modify: `src/web/components/shortcuts.tsx`

- [ ] **Step 1: Read the file**

Open `src/web/components/shortcuts.tsx`. By now it has: `?`, `Escape`, `,`, `Cmd+K`, `p`, `u`, `/`, `Tab`, `j/k`, `t`, `b`. We're going to restructure so Esc/Enter are context-sensitive, add `g` leader + `[`/`]`, and update the help content.

- [ ] **Step 2: Replace the file**

Replace the entire file with:

```tsx
import { useEffect, useRef, useState } from "react";
import { useStore } from "../store";
import { useSettings } from "../settings";
import { visibleFilePathsForTree } from "./file-tree";

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
        if (helpOpen) {
          setHelpOpen(false);
          return;
        }
        if (inInput) {
          (target as HTMLElement).blur();
          return;
        }
        if (s.focusedPath) {
          // Clear file focus → empty diff pane.
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

      // Enter — context-sensitive dive-in.
      // Palette handles its own Enter via capture listener.
      if (e.key === "Enter") {
        if (s.paletteOpen) return;
        // Future: expand collapsed big-file placeholder. For now this is a no-op
        // when nothing is actionable.
        return;
      }

      // g-leader for tab jumps.
      if (gLeaderRef.current !== null) {
        clearTimeout(gLeaderRef.current);
        gLeaderRef.current = null;
        if (e.key === "w") return void s.setTab("working-tree");
        if (e.key === "h") return void s.setTab("history");
        if (e.key === "b") return void s.setTab("branches");
        if (e.key === "s") return void s.setTab("stashes");
        // Unknown key after g — fall through to normal handling.
      }
      if (e.key === "g") {
        gLeaderRef.current = window.setTimeout(() => {
          gLeaderRef.current = null;
        }, G_LEADER_TIMEOUT_MS);
        return;
      }

      if (e.key === "p") return void s.togglePaused();
      if (e.key === "u")
        return void s.setDiffMode(s.diffMode === "unified" ? "split" : "unified");
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
  }, [helpOpen]);

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
    // In tree mode, we can't cheaply reconstruct the exact visible order
    // without the same expanded set the UI uses. Fall back to the flat
    // path order for navigation — correct for flat mode, "good enough"
    // for tree mode (skips unopened dirs' files, which is the intent).
    let paths: string[] = s.status.map((f) => f.path);
    if (mode === "tree") {
      // Use all-expanded for sibling navigation so every file is reachable.
      const allDirs = new Set<string>();
      for (const f of s.status) {
        const parts = f.path.split("/");
        for (let i = 1; i < parts.length; i++) {
          allDirs.add(parts.slice(0, i).join("/"));
        }
      }
      paths = visibleFilePathsForTree(s.status, allDirs);
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
```

Notes:
- The file previously had two separate code paths for `Escape` (inside and outside the input-target check). The new structure makes `Escape` the first thing handled, so the priority chain always runs.
- `navigateSibling` replaces the old working-tree-only `j/k` handling with cross-tab sibling navigation, so both `j/k` and `[/]` work on every tab.
- The `b` shortcut is now in the main chain. The earlier copy added in Task 7.6 gets removed when you replace the whole file above.

- [ ] **Step 2: Run lint/type/test**

```bash
bun run lint && bunx tsc -p tsconfig.web.json --noEmit && bun test
```

- [ ] **Step 3: Smoke-test every new shortcut**

1. `g w`, `g h`, `g b`, `g s` — each switches tabs.
2. Wait 2s after `g` — leader clears, next key does nothing special.
3. `[` / `]` — move selection in each tab.
4. Working-tree `j/k` still works.
5. History tab `j/k` moves the selected commit.
6. `Esc` with nothing open on working-tree with a file focused → clears file focus.
7. `Esc` with settings open → closes settings.
8. `Esc` with palette open → closes palette.
9. `Esc` with `/` filter active → blurs filter.
10. `?` → updated help overlay with all new shortcuts listed.
11. `Enter` when the palette is open with an item highlighted → activates it. (Verified because the palette installs its own capture listener earlier.)

- [ ] **Step 4: Commit phase 8**

```bash
git add src/web/components/shortcuts.tsx
git commit -m "feat(web): context-sensitive Esc/Enter, g-leader tab jumps, [/] sibling nav"
```

---

## Final verification

- [ ] **Step 1: Full test + lint**

```bash
bun run lint
bunx tsc -p tsconfig.web.json --noEmit
bun test
bun run build:web
```

Expected: all clean. The `build:web` confirms the Vite bundle still compiles.

- [ ] **Step 2: End-to-end manual walkthrough**

On a real repo with a few commits:
1. Launch `diffscope <repo>`.
2. Theme override works (light / dark / system).
3. Default tab set to Branches → relaunch → opens on Branches.
4. Pane drag, reset via Settings modal, reset via double-click divider.
5. Cmd+K → action, commit, file, branch, stash across tabs.
6. File tree view: toggle, expand/collapse all, `t` shortcut.
7. Blame on committed file: header button, `b` shortcut, sticky on next file, click sha → history tab.
8. Open in editor (pick VS Code if installed): hover `↗` icon, header button.
9. Esc priority chain from multiple UI states.
10. `g w h b s` leader, `[` / `]` sibling nav in every tab.
11. `?` help overlay lists every new shortcut.

- [ ] **Step 3: Verification-checkpoint commit (optional)**

If anything was amended along the way, a final "chore" commit is fine. Otherwise the 8 phase commits are the entire deliverable.

---

## Files summary

**New (15):**
- `src/web/settings.ts`
- `src/web/theme.ts`
- `src/web/components/pane-split.tsx`
- `src/web/components/settings-modal.tsx`
- `src/web/components/file-tree.tsx`
- `src/web/components/command-palette.tsx`
- `src/web/components/blame-gutter.tsx`
- `src/web/components/open-in-editor.tsx`
- `src/web/lib/fuzzy.ts`
- `src/web/lib/actions.ts`
- `src/web/lib/editor-urls.ts`
- `src/server/blame.ts`
- `test/fuzzy.test.ts`
- `test/blame.test.ts`
- `test/editor-urls.test.ts`

**Modified (11):**
- `tailwind.config.ts`
- `src/shared/types.ts`
- `src/web/app.tsx`
- `src/web/store.ts`
- `src/web/lib/api.ts`
- `src/web/components/layout.tsx`
- `src/web/components/file-list.tsx`
- `src/web/components/diff-view.tsx`
- `src/web/components/shortcuts.tsx`
- `src/web/components/status-bar.tsx`
- `src/server/http.ts`
- `src/server/events.ts` (if invalidation is hooked there)
