# diffscope — Frontend Polish & Theme System — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Repaint diffscope's entire web chrome onto a semantic CSS-variable token system driven by `data-theme`, ship three visual presets (Midnight default, Paper, Aperture) with a live-preview picker, and preserve every existing interaction and responsive behavior.

**Architecture:** Tokens live in `src/web/index.css` as CSS custom properties per `[data-theme="<id>"]` block. Tailwind's `theme.extend` maps semantic names (`bg`, `surface`, `fg`, `accent`, `diff-add`, etc.) to those variables, so components write `bg-surface text-fg-muted` instead of raw `bg-neutral-50 dark:bg-neutral-900`. Dark-mode modifiers disappear from the codebase — `data-theme` is the single switch, each preset carries its own mode internally. Fonts load via a single Google Fonts `<link>` in `index.html`.

**Tech Stack:** Vite · React 19 · Tailwind 3 · Zustand · Shiki · bun test

**Design spec:** `docs/superpowers/specs/2026-04-09-frontend-polish-design.md` — read this first if any task is ambiguous.

---

## Notes on verification strategy

diffscope has no React component tests — only backend `bun test` suites. This plan uses:

- **Unit tests (`bun test`)** for pure logic: theme migration, `resolveThemeId`, future helpers.
- **`bun run typecheck`** after every task that touches `.ts`/`.tsx`. Catches type regressions from the `Theme → ThemeId` migration, Tailwind class changes do not fail typecheck but component prop changes do.
- **`bun run lint`** after code changes. Uses oxlint.
- **`bun run build:web`** after each phase. Catches Tailwind/CSS errors that typecheck misses.
- **Grep sweeps** (via the `Grep` tool or `rg`) after mechanical repaint phases to verify zero leftover `dark:*`, `bg-neutral-[0-9]`, `text-white`, etc.
- **Manual smoke** (via `bun run dev:web` + browser) at the end of each repaint phase. The engineer should visually verify the affected surface.

Commits happen at phase boundaries (roughly every 2-4 tasks), not per-task — 22 file commits would be noise.

---

## File structure

**New files:**
- None. All edits land in existing files.

**Modified files (grouped by phase):**

**Phase 1 — Token foundation (5 files)**
- `index.html` — add Google Fonts preconnect + stylesheet link
- `src/web/index.css` — token blocks for `midnight`, `paper`, `aperture`; global transitions; font-family defaults
- `tailwind.config.ts` — `darkMode` removed, semantic `colors` and `fontFamily` extension added
- `src/web/settings.ts` — `Theme → ThemeId`, `THEMES` table, `resolveThemeId`, migration in `load()`
- `src/web/theme.ts` — rewrite `applyTheme` to take `ThemeId`, keep OS listener for `auto`

**Phase 2 — Theme bootstrap (1 file)**
- `src/web/app.tsx` — pass the new `ThemeId` through the existing bootstrap effect

**Phase 3 — Top-level chrome (2 files)**
- `src/web/components/layout.tsx` — header, wordmark, tab nav, diff-mode toggle, pause button
- `src/web/components/status-bar.tsx` — tokens + LIVE dot pulse

**Phase 4 — Diff surface (3 files)**
- `src/web/components/diff-view.tsx` — file header bar, hunk header, diff rows, collapse banner, binary/image notice
- `src/web/components/blame-gutter.tsx` — gutter tokens
- `src/web/lib/highlight.ts` — read active theme's shiki theme, preload all three, swap without refetch

**Phase 5 — Lists & panes (8 files)**
- `src/web/components/file-list.tsx`
- `src/web/components/file-tree.tsx`
- `src/web/components/pane-split.tsx`
- `src/web/components/pane-split-vertical.tsx`
- `src/web/tabs/history.tsx`
- `src/web/tabs/working-tree.tsx`
- `src/web/tabs/branches.tsx`
- `src/web/tabs/stashes.tsx`

**Phase 6 — Modals & floating (6 files)**
- `src/web/components/settings-modal.tsx` — full rewrite around the theme picker grid
- `src/web/components/command-palette.tsx`
- `src/web/components/picker.tsx`
- `src/web/components/toasts.tsx`
- `src/web/components/shortcuts.tsx` — help overlay only (shortcut logic untouched)
- `src/web/components/open-in-editor.tsx`

**Phase 7 — Interaction polish (1 file)**
- `src/web/index.css` — global transition layer, focus-ring utilities, LIVE pulse keyframes

**Phase 8 — Cleanup sweep (0 new files)**
- Grep verification, any stragglers, final build

**Test files (new):**
- `test/settings-migration.test.ts` — theme migration unit tests
- `test/theme-resolve.test.ts` — `resolveThemeId` unit tests (pure-function variant)

---

## Substitution reference table

This is the canonical `old → new` mapping used across Phases 3–6. Every file applies the same substitutions — engineers should memorize the table once and apply mechanically.

| Old (Tailwind neutral + dark:) | New (semantic token) |
|---|---|
| `bg-white` | `bg-surface` |
| `bg-neutral-50 dark:bg-neutral-900` | `bg-bg-elevated` |
| `bg-neutral-100 dark:bg-neutral-800` | `bg-surface` |
| `bg-neutral-200 dark:bg-neutral-700` | `bg-surface-hover` |
| `bg-neutral-200/95 dark:bg-neutral-800/95` | `bg-surface/95` |
| `bg-neutral-900 dark:bg-neutral-100` + `text-white dark:text-neutral-900` | `bg-accent text-accent-fg` |
| `text-neutral-900 dark:text-neutral-100` | `text-fg` |
| `text-neutral-600 dark:text-neutral-400` | `text-fg-muted` |
| `text-neutral-500` | `text-fg-muted` |
| `text-neutral-400 dark:text-neutral-600` | `text-fg-subtle` |
| `border-neutral-200 dark:border-neutral-800` | `border-border` |
| `border-neutral-300 dark:border-neutral-700` | `border-border-strong` |
| `hover:bg-neutral-100 dark:hover:bg-neutral-800` | `hover:bg-surface-hover` |
| `hover:bg-neutral-200 dark:hover:bg-neutral-700` | `hover:bg-surface-hover` |
| `bg-red-100 dark:bg-red-900` | `bg-diff-del-bg` |
| `bg-green-100 dark:bg-green-900` | `bg-diff-add-bg` |
| `bg-cyan-50 dark:bg-cyan-950` | `bg-hunk-bg` |
| `text-cyan-700 dark:text-cyan-300` | `text-hunk-fg` |
| `bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-200` | `bg-accent-soft text-accent` |
| `text-amber-600` | `text-accent` (for warnings — accent in all themes is a warm/cool focal color) |
| `font-mono` | `font-mono` (unchanged — the variable is what swaps) |
| `font-semibold` + large display context | Add `font-display` to the element |

**If a combination isn't in the table:** pause and either extend the spec's token set or pick the closest semantic match and note it for review. Do not introduce raw colors.

---

# Phase 1 — Token foundation

Ships the skeleton: fonts load, tokens exist, settings can store a `ThemeId`, `applyTheme` does the right thing. No component visually changes yet — they're still full of `dark:*` modifiers, which continue working because Tailwind's `darkMode` stays on until Phase 2.

## Task 1.1 — Add Google Fonts link to `index.html`

**Files:**
- Modify: `index.html`

- [ ] **Step 1: Read current `index.html`**

```bash
cat index.html
```

Find the `<head>` block. There is no existing font link — the current setup relies on system fonts.

- [ ] **Step 2: Add preconnect + stylesheet link inside `<head>`, immediately after `<meta name="viewport">`**

Insert this block:

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600&family=JetBrains+Mono:wght@400;500&family=Fraunces:ital,wght@0,400;0,600;1,400&family=Instrument+Serif:ital@0;1&family=Geist:wght@400;500;600&display=swap">
```

- [ ] **Step 3: Run dev server and verify fonts load in the Network panel**

```bash
bun run dev:web
```

Open `http://localhost:5173` (or whatever port Vite prints), open DevTools → Network → Font. Confirm five font files loaded, no 404s. The current UI will look identical — we haven't bound the fonts yet.

- [ ] **Step 4: Stop the dev server (Ctrl-C)**

- [ ] **Step 5: Typecheck — no TS changes but habit check**

```bash
bun run typecheck
```

Expected: passes. (Nothing TS was modified, but this confirms the baseline is green.)

*(No commit yet — this gets bundled into 1.3.)*

## Task 1.2 — Define tokens in `index.css`

**Files:**
- Modify: `src/web/index.css`

- [ ] **Step 1: Replace `src/web/index.css` in full with the block below**

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

html,
body,
#root {
  height: 100%;
}

/* ───────────────────────────────────────────────────────────
   Theme tokens
   Single source of truth for all surface, foreground, border,
   accent, and diff colors. Each [data-theme] block is a
   complete theme — no partial overrides.
   ─────────────────────────────────────────────────────────── */

:root,
[data-theme="midnight"] {
  --bg:             #0b0d10;
  --bg-elevated:    #0d1016;
  --surface:        #12151a;
  --surface-hover:  #1a2230;
  --border:         #1a2230;
  --border-strong:  #2a3441;

  --fg:             #e2e8f0;
  --fg-muted:       #64748b;
  --fg-subtle:      #475569;

  --accent:         #67e8f9;
  --accent-fg:      #0b0d10;
  --accent-soft:    rgba(103, 232, 249, 0.12);

  --diff-add-bg:    rgba(34, 197, 94, 0.08);
  --diff-add-fg:    #86efac;
  --diff-add-sign:  #22c55e;
  --diff-del-bg:    rgba(239, 68, 68, 0.09);
  --diff-del-fg:    #fca5a5;
  --diff-del-sign:  #ef4444;

  --hunk-bg:        rgba(103, 232, 249, 0.06);
  --hunk-fg:        #67e8f9;

  --shadow-soft:    0 1px 2px rgba(0, 0, 0, 0.4), 0 8px 24px -12px rgba(0, 0, 0, 0.5);

  --font-sans:      "IBM Plex Sans", ui-sans-serif, system-ui, -apple-system, sans-serif;
  --font-display:   "JetBrains Mono", ui-monospace, "SF Mono", monospace;
  --font-mono:      "JetBrains Mono", ui-monospace, "SF Mono", monospace;

  --radius:         6px;
  --radius-lg:      10px;

  color-scheme: dark;
}

[data-theme="paper"] {
  --bg:             #faf7f1;
  --bg-elevated:    #f5efe0;
  --surface:        #fffefa;
  --surface-hover:  #f5efe0;
  --border:         #ede5d2;
  --border-strong:  #d6cdb3;

  --fg:             #1c1917;
  --fg-muted:       #78716c;
  --fg-subtle:      #a8a29e;

  --accent:         #c2410c;
  --accent-fg:      #faf7f1;
  --accent-soft:    rgba(194, 65, 12, 0.10);

  --diff-add-bg:    #ecfdf5;
  --diff-add-fg:    #15803d;
  --diff-add-sign:  #15803d;
  --diff-del-bg:    #fef2f2;
  --diff-del-fg:    #b91c1c;
  --diff-del-sign:  #b91c1c;

  --hunk-bg:        rgba(194, 65, 12, 0.07);
  --hunk-fg:        #9a3412;

  --shadow-soft:    0 1px 2px rgba(28, 25, 23, 0.04), 0 8px 24px -12px rgba(28, 25, 23, 0.12);

  --font-sans:      "IBM Plex Sans", ui-sans-serif, system-ui, -apple-system, sans-serif;
  --font-display:   "Fraunces", "Iowan Old Style", Georgia, serif;
  --font-mono:      "JetBrains Mono", ui-monospace, "SF Mono", monospace;

  --radius:         8px;
  --radius-lg:      12px;

  color-scheme: light;
}

[data-theme="aperture"] {
  --bg:             #f7f7f5;
  --bg-elevated:    #ffffff;
  --surface:        #ffffff;
  --surface-hover:  #f5f5f4;
  --border:         #e7e5e4;
  --border-strong:  #d6d3d1;

  --fg:             #0c0a09;
  --fg-muted:       #57534e;
  --fg-subtle:      #a8a29e;

  --accent:         #b45309;
  --accent-fg:      #ffffff;
  --accent-soft:    rgba(180, 83, 9, 0.10);

  --diff-add-bg:    #fefce8;
  --diff-add-fg:    #713f12;
  --diff-add-sign:  #b45309;
  --diff-del-bg:    #fafaf9;
  --diff-del-fg:    #a8a29e;
  --diff-del-sign:  #d6d3d1;

  --hunk-bg:        rgba(180, 83, 9, 0.06);
  --hunk-fg:        #b45309;

  --shadow-soft:    0 1px 2px rgba(12, 10, 9, 0.03), 0 12px 32px -12px rgba(12, 10, 9, 0.10);

  --font-sans:      "Geist", ui-sans-serif, system-ui, -apple-system, sans-serif;
  --font-display:   "Instrument Serif", "Apple Garamond", Garamond, serif;
  --font-mono:      "JetBrains Mono", ui-monospace, "SF Mono", monospace;

  --radius:         6px;
  --radius-lg:      10px;

  color-scheme: light;
}

body {
  background-color: var(--bg);
  color: var(--fg);
  font-family: var(--font-sans);
  font-feature-settings: "cv11", "ss01";
}

/* Thin scrollbars tinted by the active theme */
* {
  scrollbar-width: thin;
  scrollbar-color: var(--border-strong) transparent;
}
*::-webkit-scrollbar { width: 10px; height: 10px; }
*::-webkit-scrollbar-track { background: transparent; }
*::-webkit-scrollbar-thumb { background: var(--border-strong); border-radius: 99px; }
```

- [ ] **Step 2: Typecheck**

```bash
bun run typecheck
```

Expected: passes (CSS isn't typechecked but confirms no tsx file was accidentally broken).

- [ ] **Step 3: Dev server smoke**

```bash
bun run dev:web
```

The app should still render. Default `data-theme` is undefined (we haven't called `applyTheme` with a new ID yet) but `:root` falls back to midnight, so the body should go dark. Existing `dark:*` modifiers continue working because Tailwind still has `darkMode` enabled until Task 1.4. **Some components will look wrong here because they assume `bg-white` or `text-neutral-*` — that's expected; Phases 3-6 repaint them.**

Verify:
- Body background is near-black (`#0b0d10`)
- Body font is still IBM Plex Sans or falls back to system (fonts from 1.1 should be loaded)

- [ ] **Step 4: Stop dev server**

## Task 1.3 — Extend `tailwind.config.ts` with semantic tokens

**Files:**
- Modify: `tailwind.config.ts`

- [ ] **Step 1: Replace `tailwind.config.ts` in full**

```ts
import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/web/**/*.{ts,tsx}"],
  // darkMode intentionally omitted — data-theme is the single switch, each
  // theme declares its own mode internally. `dark:` modifiers are removed
  // from the codebase in the Phase 3-6 repaint pass.
  theme: {
    extend: {
      colors: {
        bg: {
          DEFAULT: "var(--bg)",
          elevated: "var(--bg-elevated)",
        },
        surface: {
          DEFAULT: "var(--surface)",
          hover: "var(--surface-hover)",
        },
        border: {
          DEFAULT: "var(--border)",
          strong: "var(--border-strong)",
        },
        fg: {
          DEFAULT: "var(--fg)",
          muted: "var(--fg-muted)",
          subtle: "var(--fg-subtle)",
        },
        accent: {
          DEFAULT: "var(--accent)",
          fg: "var(--accent-fg)",
          soft: "var(--accent-soft)",
        },
        "diff-add": {
          bg: "var(--diff-add-bg)",
          fg: "var(--diff-add-fg)",
          sign: "var(--diff-add-sign)",
        },
        "diff-del": {
          bg: "var(--diff-del-bg)",
          fg: "var(--diff-del-fg)",
          sign: "var(--diff-del-sign)",
        },
        hunk: {
          bg: "var(--hunk-bg)",
          fg: "var(--hunk-fg)",
        },
      },
      fontFamily: {
        sans: ["var(--font-sans)"],
        display: ["var(--font-display)"],
        mono: ["var(--font-mono)"],
      },
      borderRadius: {
        DEFAULT: "var(--radius)",
        lg: "var(--radius-lg)",
      },
      boxShadow: {
        soft: "var(--shadow-soft)",
      },
    },
  },
  plugins: [],
} satisfies Config;
```

**Important:** this removes the `darkMode` field entirely. After this change, `dark:*` modifiers in existing components are **no-ops** — they will not generate CSS. The components still work because their non-`dark:` classes provide defaults. The Phase 3-6 repaint replaces those defaults with semantic tokens. Between now and the end of Phase 6, the app will look wrong — **this is expected and intentional.** Do not try to "fix" individual components mid-phase.

- [ ] **Step 2: Typecheck**

```bash
bun run typecheck
```

Expected: passes.

- [ ] **Step 3: Build — catches Tailwind class errors that typecheck misses**

```bash
bun run build:web
```

Expected: completes without errors. Warnings about unused `dark:*` classes are fine (Tailwind just won't generate them).

- [ ] **Step 4: Commit tokens + fonts + config**

```bash
git add index.html src/web/index.css tailwind.config.ts
git commit -m "feat(web): CSS-variable token system + Google Fonts loader

Introduces the semantic token foundation for the upcoming theme system.
Defines midnight/paper/aperture presets as [data-theme] blocks in
index.css, extends tailwind.config with bg/surface/fg/accent/diff-*
semantic colors, and loads IBM Plex Sans, JetBrains Mono, Fraunces,
Instrument Serif, and Geist via a single Google Fonts link.

Components still use dark:* modifiers — the Phase 3-6 repaint converts
them to semantic tokens. The app will look broken in spots until that
repaint lands. This is the scaffolding commit only."
```

## Task 1.4 — Settings type migration + `resolveThemeId`

**Files:**
- Modify: `src/web/settings.ts`
- Create: `test/settings-migration.test.ts`

- [ ] **Step 1: Write the failing migration test**

Create `test/settings-migration.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { migrateLegacyTheme, type ThemeId } from "../src/web/settings";

describe("migrateLegacyTheme", () => {
  test("maps legacy 'dark' to 'midnight'", () => {
    expect(migrateLegacyTheme("dark")).toBe("midnight");
  });

  test("maps legacy 'light' to 'paper'", () => {
    expect(migrateLegacyTheme("light")).toBe("paper");
  });

  test("maps legacy 'system' to 'auto'", () => {
    expect(migrateLegacyTheme("system")).toBe("auto");
  });

  test("passes through valid new ThemeIds unchanged", () => {
    const ids: ThemeId[] = ["auto", "midnight", "paper", "aperture"];
    for (const id of ids) {
      expect(migrateLegacyTheme(id)).toBe(id);
    }
  });

  test("falls back to 'auto' for unknown values", () => {
    expect(migrateLegacyTheme("nonsense" as string)).toBe("auto");
    expect(migrateLegacyTheme(undefined)).toBe("auto");
    expect(migrateLegacyTheme(null as unknown as string)).toBe("auto");
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

```bash
bun test test/settings-migration.test.ts
```

Expected: FAIL with "migrateLegacyTheme is not exported" or similar.

- [ ] **Step 3: Rewrite `src/web/settings.ts` to export the new types and migration**

Replace the existing `Theme` type and the entire file with:

```ts
// src/web/settings.ts
// Centralized, persisted user preferences.
// One storage key, one setter, one loader.
import { create } from "zustand";

export type ThemeId = "auto" | "midnight" | "paper" | "aperture";
export type Editor = "none" | "vscode" | "cursor" | "zed" | "idea" | "subl";
export type FileListMode = "flat" | "tree";
export type DefaultTab =
  | "last-used"
  | "working-tree"
  | "history"
  | "branches"
  | "stashes";

export interface ThemeMeta {
  id: ThemeId;
  label: string;
  mode: "light" | "dark";
  accent: string;
  shikiTheme: string;
  description: string;
}

// `auto` carries no visual metadata of its own — it is a pointer to
// whichever concrete preset `applyTheme` resolves to. Code that wants to
// render a swatch or decide a mode for `auto` must resolve it first via
// `resolveThemeId(id)`.
export const THEMES: ThemeMeta[] = [
  {
    id: "auto",
    label: "Auto",
    mode: "dark",
    accent: "#67e8f9",
    shikiTheme: "vitesse-dark",
    description: "Follows your OS",
  },
  {
    id: "midnight",
    label: "Midnight",
    mode: "dark",
    accent: "#67e8f9",
    shikiTheme: "vitesse-dark",
    description: "Dark · refined editor",
  },
  {
    id: "paper",
    label: "Paper",
    mode: "light",
    accent: "#c2410c",
    shikiTheme: "catppuccin-latte",
    description: "Light · editorial",
  },
  {
    id: "aperture",
    label: "Aperture",
    mode: "light",
    accent: "#b45309",
    shikiTheme: "rose-pine-dawn",
    description: "Light · premium",
  },
];

const VALID_THEME_IDS = new Set<ThemeId>(["auto", "midnight", "paper", "aperture"]);

/**
 * Migrate legacy theme values from earlier versions to the new ThemeId set.
 * Pure function — no DOM or localStorage access. Safe to call repeatedly.
 */
export function migrateLegacyTheme(value: unknown): ThemeId {
  if (typeof value !== "string") return "auto";
  if (VALID_THEME_IDS.has(value as ThemeId)) return value as ThemeId;
  if (value === "dark") return "midnight";
  if (value === "light") return "paper";
  if (value === "system") return "auto";
  return "auto";
}

/**
 * Resolve `auto` to a concrete theme based on the provided mediaQuery match
 * result. The caller owns the mediaQuery — keeping this pure makes it
 * trivially testable and safe to call during SSR.
 */
export function resolveThemeId(
  id: ThemeId,
  prefersDark: boolean,
): Exclude<ThemeId, "auto"> {
  if (id !== "auto") return id;
  return prefersDark ? "midnight" : "paper";
}

export interface Settings {
  theme: ThemeId;
  defaultTab: DefaultTab;
  fileListMode: FileListMode;
  editor: Editor;
  blameStickyOn: boolean;
  fileListWidthPx: number;
  commitDetailHeightPx: number;
  lastUsedTab: "working-tree" | "history" | "branches" | "stashes";
  diffMode: "unified" | "split";
}

const STORAGE_KEY = "diffscope:settings:v1";

const DEFAULTS: Settings = {
  theme: "auto",
  defaultTab: "last-used",
  fileListMode: "flat",
  editor: "none",
  blameStickyOn: false,
  fileListWidthPx: 320,
  commitDetailHeightPx: 180,
  lastUsedTab: "working-tree",
  diffMode: "unified",
};

const SETTINGS_KEYS = Object.keys(DEFAULTS) as (keyof Settings)[];

function pickSettings(state: SettingsStore): Settings {
  const out: Record<string, unknown> = {};
  for (const k of SETTINGS_KEYS) out[k] = state[k];
  return out as unknown as Settings;
}

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

function migrateLegacyKeys(): void {
  try {
    localStorage.removeItem("diffscope:tab");
    localStorage.removeItem("diffscope:diffMode");
  } catch {
    // ignore
  }
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
    const merged: Settings = {
      ...DEFAULTS,
      ...stored,
      // Migrate theme value in case stored value is from an older version
      // (e.g., "system" / "dark" / "light" from v1 users).
      theme: migrateLegacyTheme((stored as { theme?: unknown }).theme),
    };
    // Write the migrated value back so the next load is a no-op fast path.
    writeThrough(merged);
    set({ ...merged, loaded: true });
  },

  set(partial) {
    const next: Settings = { ...pickSettings(get()), ...partial };
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
  return pickSettings(useSettings.getState());
}
```

**Breaking change:** `export type Theme` is gone, replaced by `ThemeId`. Any importer of `Theme` will break. We fix those importers in Tasks 1.5 and 6.1.

- [ ] **Step 4: Run the migration test**

```bash
bun test test/settings-migration.test.ts
```

Expected: all 5 tests pass.

- [ ] **Step 5: Add and run `resolveThemeId` tests**

Append to `test/settings-migration.test.ts`:

```ts
import { resolveThemeId } from "../src/web/settings";

describe("resolveThemeId", () => {
  test("passes concrete themes through unchanged", () => {
    expect(resolveThemeId("midnight", false)).toBe("midnight");
    expect(resolveThemeId("midnight", true)).toBe("midnight");
    expect(resolveThemeId("paper", true)).toBe("paper");
    expect(resolveThemeId("aperture", false)).toBe("aperture");
  });

  test("resolves auto to midnight when prefersDark is true", () => {
    expect(resolveThemeId("auto", true)).toBe("midnight");
  });

  test("resolves auto to paper when prefersDark is false", () => {
    expect(resolveThemeId("auto", false)).toBe("paper");
  });
});
```

Run:

```bash
bun test test/settings-migration.test.ts
```

Expected: 8 tests pass.

## Task 1.5 — Rewrite `theme.ts` to apply a `ThemeId`

**Files:**
- Modify: `src/web/theme.ts`

- [ ] **Step 1: Replace `src/web/theme.ts` in full**

```ts
// src/web/theme.ts
// Applies the active theme to the document root.
// `auto` follows OS preference at runtime; all other values are concrete.
import { resolveThemeId, type ThemeId } from "./settings";

let mediaQuery: MediaQueryList | null = null;
let mediaListener: ((e: MediaQueryListEvent) => void) | null = null;

function writeAttribute(resolved: Exclude<ThemeId, "auto">): void {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute("data-theme", resolved);
}

export function applyTheme(id: ThemeId): void {
  // Detach any prior system listener — we'll re-attach only if still `auto`.
  if (mediaQuery && mediaListener) {
    mediaQuery.removeEventListener("change", mediaListener);
    mediaListener = null;
    mediaQuery = null;
  }

  if (id === "auto") {
    if (typeof window === "undefined") {
      writeAttribute("midnight");
      return;
    }
    mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    writeAttribute(resolveThemeId("auto", mediaQuery.matches));
    mediaListener = (e) => writeAttribute(resolveThemeId("auto", e.matches));
    mediaQuery.addEventListener("change", mediaListener);
    return;
  }

  writeAttribute(id);
}
```

- [ ] **Step 2: Typecheck**

```bash
bun run typecheck
```

Expected: errors in any component that still imports the old `Theme` type. At this point, the only importer should be `settings-modal.tsx` (via its local `THEMES` array) and maybe `app.tsx` indirectly. List the errors.

- [ ] **Step 3: Minimal surgical fixup to app.tsx**

If `app.tsx` imports `Theme`, change it to import `ThemeId`. The existing `getSettings().theme` call already returns the right type — only the import needs updating. Leave settings-modal for Task 6.1.

Open `src/web/app.tsx` and if it has `import type { Theme } from "./settings"`, remove or replace. In the current version it doesn't import `Theme` directly — it just calls `applyTheme(getSettings().theme)` which now takes `ThemeId`. Should compile cleanly.

- [ ] **Step 4: Also temporarily fix settings-modal.tsx typecheck without touching the UI**

We don't rewrite the modal until Task 6.1, but we need it to compile. Open `src/web/components/settings-modal.tsx` and change:

```ts
import {
  useSettings,
  type Theme,                      // ← delete
  type Editor,
  type DefaultTab,
  type FileListMode,
} from "../settings";

const THEMES: { value: Theme; label: string }[] = [    // ← change Theme to ThemeId
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];
```

Replace with:

```ts
import {
  useSettings,
  type ThemeId,
  type Editor,
  type DefaultTab,
  type FileListMode,
} from "../settings";

// Temporary — full picker rewrite lands in Task 6.1.
const THEME_OPTIONS: { value: ThemeId; label: string }[] = [
  { value: "auto", label: "Auto" },
  { value: "midnight", label: "Midnight" },
  { value: "paper", label: "Paper" },
  { value: "aperture", label: "Aperture" },
];
```

And update the `<select>` at line ~78 to reference `THEME_OPTIONS` instead of `THEMES`, and change the cast from `as Theme` to `as ThemeId`:

```tsx
<select
  value={theme}
  onChange={(e) => set({ theme: e.target.value as ThemeId })}
  className="rounded border border-neutral-300 bg-white px-2 py-1 dark:border-neutral-700 dark:bg-neutral-800"
>
  {THEME_OPTIONS.map((t) => (
    <option key={t.value} value={t.value}>
      {t.label}
    </option>
  ))}
</select>
```

Leave the `dark:*` Tailwind classes alone — they'll be swept away in Task 6.1.

- [ ] **Step 5: Typecheck**

```bash
bun run typecheck
```

Expected: passes.

- [ ] **Step 6: Run all tests**

```bash
bun test
```

Expected: all tests pass (migration + existing backend suites).

- [ ] **Step 7: Manual smoke**

```bash
bun run dev:web
```

1. Open the app. Default `theme` is `auto`, which resolves to either midnight or paper based on OS. Body background should match.
2. Open DevTools, run `document.documentElement.setAttribute('data-theme', 'midnight')`. Body goes dark.
3. Run `document.documentElement.setAttribute('data-theme', 'paper')`. Body goes cream.
4. Run `document.documentElement.setAttribute('data-theme', 'aperture')`. Body goes warm white.
5. Open settings modal (cmd+,). The theme dropdown should show Auto/Midnight/Paper/Aperture. Selecting each should change the body color. **The modal itself will look wrong** (still `bg-white dark:bg-neutral-900` etc.) — that's expected. Inner component chrome is stale until Phase 6.

Stop the dev server.

- [ ] **Step 8: Commit Phase 1**

```bash
git add src/web/settings.ts src/web/theme.ts src/web/components/settings-modal.tsx test/settings-migration.test.ts src/web/app.tsx
git commit -m "feat(web): ThemeId type + migration + applyTheme rewrite

Replaces the binary Theme ('system'|'light'|'dark') type with a named
ThemeId ('auto'|'midnight'|'paper'|'aperture'). Adds resolveThemeId and
migrateLegacyTheme as pure functions with full test coverage. Rewrites
applyTheme to write data-theme=<concrete preset> and keep the OS
matchMedia listener wired for 'auto'.

Settings modal is temporarily wired up with a plain select of the four
theme IDs so typecheck passes; the full preview-card picker rewrite
lands in Phase 6."
```

---

# Phase 2 — Theme bootstrap sanity check

No code changes — just verify the foundation is solid before tearing up 16 components.

## Task 2.1 — End-to-end theme switch smoke

- [ ] **Step 1: Start the dev server**

```bash
bun run dev:web
```

- [ ] **Step 2: Clear localStorage** (in DevTools console)

```js
localStorage.clear()
```

Refresh. The app should land in `auto` which resolves to your OS preference. Verify the body tint matches expectation.

- [ ] **Step 3: Switch themes via settings modal**

Open settings (`Cmd+,`). Change the theme dropdown to each value in turn. Verify:
- **Auto:** matches OS
- **Midnight:** deep near-black (`#0b0d10`)
- **Paper:** warm cream (`#faf7f1`)
- **Aperture:** warm white (`#f7f7f5`)

Each switch must be instant — no refresh, no flash.

- [ ] **Step 4: Verify persistence**

Refresh the page. The last-selected theme should still apply.

- [ ] **Step 5: Verify OS listener for `auto`**

Set theme to Auto. Change your OS theme (System Preferences → Appearance on macOS). The app body color should update without a refresh.

- [ ] **Step 6: Stop the dev server**

If any of these steps failed, **stop and debug** before starting Phase 3. Foundation issues compound.

---

# Phase 3 — Top-level chrome

Repaints the header, tab nav, status bar, and diff-mode toggle. This is the most visible surface — nail it first and the rest of the repaint inherits visual confidence.

## Task 3.1 — Repaint `components/layout.tsx`

**Files:**
- Modify: `src/web/components/layout.tsx`

Apply the substitution table from the top of this document. The key classes to swap are at lines 36, 42, 53-56, 62-66, 77, 82-83, 88-89.

- [ ] **Step 1: Replace the `<header>` opening tag (line 36)**

Before:

```tsx
<header className="flex shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-neutral-200 bg-neutral-50 px-3 py-2 sm:px-4 dark:border-neutral-800 dark:bg-neutral-900">
```

After:

```tsx
<header className="flex shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-border bg-bg-elevated px-3 py-2 sm:px-4">
```

- [ ] **Step 2: Wordmark and path (lines 38-42)**

Before:

```tsx
<span className="font-semibold">diffscope</span>
{repoRoot && (
  <span
    className="hidden min-w-0 truncate text-sm text-neutral-500 md:inline"
    title={repoRoot}
  >
    {shortenPath(repoRoot)}
  </span>
)}
```

After:

```tsx
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
```

The wordmark now uses the theme's display font (JetBrains Mono in Midnight, Fraunces in Paper, Instrument Serif in Aperture) and gets a centered accent dot between `diff` and `scope`.

- [ ] **Step 3: Tab buttons (lines 51-73)**

Before:

```tsx
<button
  key={t.key}
  onClick={() => setTab(t.key)}
  className={`flex items-center gap-1.5 rounded px-2 py-1 text-sm sm:px-3 ${
    tab === t.key
      ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900"
      : "text-neutral-600 hover:bg-neutral-200 dark:text-neutral-400 dark:hover:bg-neutral-800"
  }`}
>
  <span className="hidden sm:inline">{t.label}</span>
  <span className="sm:hidden">{t.shortLabel}</span>
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
```

After:

```tsx
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
```

- [ ] **Step 4: Right-side buttons (lines 75-97)**

Before:

```tsx
<div className="flex items-center gap-2">
  {watcherDown && (
    <span className="hidden text-xs text-amber-600 lg:inline">
      ⚠ Live updates off
    </span>
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
    title={paused ? "Resume live updates" : "Pause live updates"}
  >
    ...
  </button>
</div>
```

After:

```tsx
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
    ...
  </button>
</div>
```

- [ ] **Step 5: Typecheck and lint**

```bash
bun run typecheck && bun run lint
```

Expected: both pass.

- [ ] **Step 6: Grep this file to confirm zero `dark:` and zero `neutral-` remain**

```bash
rg 'dark:|neutral-[0-9]' src/web/components/layout.tsx
```

Expected: no matches.

## Task 3.2 — Repaint `components/status-bar.tsx`

**Files:**
- Modify: `src/web/components/status-bar.tsx`

- [ ] **Step 1: Read the current file**

```bash
cat src/web/components/status-bar.tsx
```

- [ ] **Step 2: Apply substitution table**

For every occurrence, substitute per the master table:
- `bg-neutral-50 dark:bg-neutral-900` → `bg-bg-elevated`
- `border-neutral-200 dark:border-neutral-800` → `border-border`
- `text-neutral-600 dark:text-neutral-400` → `text-fg-muted`
- `text-neutral-500` → `text-fg-muted`
- any `text-green-600` / `text-red-600` for status → keep as-is (semantic state, not chrome)

- [ ] **Step 3: Find the "LIVE" indicator span and wrap the dot with a pulse class**

Look for the part that renders the watcher status dot. It's likely a `<span>` with a green background. Replace the inline classes with `live-dot`:

```tsx
<span className="live-dot inline-block h-1.5 w-1.5 rounded-full bg-accent" />
```

The `.live-dot` class is defined in Phase 7's `index.css` polish task — for now the extra class is a no-op.

- [ ] **Step 4: Typecheck, lint, grep**

```bash
bun run typecheck && bun run lint && rg 'dark:|neutral-[0-9]' src/web/components/status-bar.tsx
```

Expected: zero `dark:` / `neutral-` matches in this file.

## Task 3.3 — Manual smoke + Phase 3 commit

- [ ] **Step 1: Dev server smoke**

```bash
bun run dev:web
```

Open the app in each theme (use the settings modal dropdown from Task 1.5). For each theme verify:
- Header bar uses `bg-bg-elevated` — warm cream in Paper, near-black in Midnight, pure white in Aperture
- Wordmark uses the theme's display font
- Active tab has the accent color background
- Status bar tints match the theme

Known broken (expected): file list, file tree, diff view, commit detail, modals. Those are Phases 4-6.

- [ ] **Step 2: Stop dev server and commit**

```bash
git add src/web/components/layout.tsx src/web/components/status-bar.tsx
git commit -m "feat(web): repaint top-level chrome with semantic tokens

Header, tab nav, diff-mode toggle, pause button, and status bar all now
use the bg/surface/fg/accent semantic tokens. Wordmark adopts the
theme's display font with a centered accent dot. Tab active state uses
bg-accent instead of hardcoded neutral-900."
```

---

# Phase 4 — Diff surface

The most code-heavy phase. diff-view.tsx is 488 lines and contains 20 `dark:*` occurrences across the file header, hunk header, unified rows, split rows, blame integration, and collapse banner.

## Task 4.1 — Repaint `components/diff-view.tsx`

**Files:**
- Modify: `src/web/components/diff-view.tsx`

- [ ] **Step 1: Read the full file for context**

```bash
wc -l src/web/components/diff-view.tsx
```

It's 488 lines — read it in one pass using the Read tool with no limit, since 488 < 2000.

- [ ] **Step 2: Apply substitutions across the file**

Use the Grep tool to find every `dark:` occurrence and replace. The 20 occurrences are concentrated in these patterns:

| Location | Before | After |
|---|---|---|
| Loading/empty state | `text-neutral-500` | `text-fg-muted` |
| Binary notice | `text-sm text-neutral-500` | `text-sm text-fg-muted` |
| Large-diff banner button | `bg-neutral-200 dark:bg-neutral-800` | `bg-surface-hover text-fg` |
| Sticky file header | `border-neutral-300 bg-neutral-200/95 dark:border-neutral-700 dark:bg-neutral-800/95` | `border-border bg-surface/95` |
| File collapse chevron | `text-neutral-500 hover:bg-neutral-300 dark:hover:bg-neutral-700` | `text-fg-muted hover:bg-surface-hover` |
| Hunk separator border | `border-neutral-100 dark:border-neutral-900` | `border-border` |
| Hunk header | `bg-cyan-50 px-3 py-0.5 text-cyan-700 dark:bg-cyan-950 dark:text-cyan-300` | `bg-hunk-bg px-3 py-0.5 text-hunk-fg` |
| File path dir (muted) | `text-neutral-400 dark:text-neutral-600` | `text-fg-subtle` |
| File path dir | `text-neutral-500 dark:text-neutral-400` | `text-fg-muted` |
| File path name (old, strikethrough) | `text-neutral-500 line-through dark:text-neutral-500` | `text-fg-subtle line-through` |
| File path name (new) | `font-semibold text-neutral-900 dark:text-neutral-100` | `font-semibold text-fg` |
| Blame button active | `bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-200` | `bg-accent-soft text-accent` |
| Blame button inactive hover | `hover:bg-neutral-100 dark:hover:bg-neutral-800` | `hover:bg-surface-hover` |
| Split gutter text | `text-neutral-400` | `text-fg-subtle` |
| Split empty cell bg (`SPLIT_EMPTY_BG`) | `bg-neutral-50 dark:bg-neutral-900/40` | `bg-bg-elevated` |
| `sideBg` del result | `bg-red-100 dark:bg-red-900` | `bg-diff-del-bg` |
| `sideBg` add result | `bg-green-100 dark:bg-green-900` | `bg-diff-add-bg` |
| Unified row add | (whatever the current del/add row classes are in `HunkLines`) | `bg-diff-add-bg text-diff-add-fg` |
| Unified row del | | `bg-diff-del-bg text-diff-del-fg` |

**Do not convert the shiki-highlighted `<pre>` and `<code>` spans.** Shiki injects inline `style="color: ..."` that overrides Tailwind anyway, and Phase 4.3 handles shiki theme swapping separately.

- [ ] **Step 3: Verify the large Read/Edit loop is done**

```bash
rg 'dark:|neutral-[0-9]|bg-(red|green|cyan|blue)-[0-9]' src/web/components/diff-view.tsx
```

Expected: no matches. If any remain, either they're in `sideBg`/constants you missed, or they're intentional (flag them and check with the spec).

- [ ] **Step 4: Typecheck**

```bash
bun run typecheck
```

Expected: passes.

## Task 4.2 — Repaint `components/blame-gutter.tsx`

**Files:**
- Modify: `src/web/components/blame-gutter.tsx`

- [ ] **Step 1: Read the file**

Read `src/web/components/blame-gutter.tsx` in full (it's small).

- [ ] **Step 2: Apply the substitution table to every class**

Main targets:
- Gutter background → `bg-surface`
- Gutter border → `border-border`
- Author text → `text-fg-muted`
- Date text → `text-fg-subtle`
- Hover state → `hover:bg-surface-hover`

- [ ] **Step 3: Typecheck + grep**

```bash
bun run typecheck && rg 'dark:|neutral-[0-9]' src/web/components/blame-gutter.tsx
```

Expected: passes, no matches.

## Task 4.3 — Shiki theme swap in `lib/highlight.ts`

**Files:**
- Modify: `src/web/lib/highlight.ts`

- [ ] **Step 1: Read the current file**

```bash
cat src/web/lib/highlight.ts
```

It likely initializes a single Shiki highlighter with one theme (probably `github-dark` or similar). We need to:
1. Preload all three themes (`vitesse-dark`, `catppuccin-latte`, `rose-pine-dawn`).
2. Expose a function that returns the currently-active shiki theme based on the settings store's `theme` value.
3. Invalidate any highlighted-HTML cache on theme change so diff rows get re-highlighted.

- [ ] **Step 2: Refactor the highlighter initialization**

Replace the existing highlighter init with:

```ts
import { createHighlighter, type Highlighter } from "shiki";
import { useSettings, THEMES, resolveThemeId, type ThemeId } from "../settings";

const SHIKI_THEMES = ["vitesse-dark", "catppuccin-latte", "rose-pine-dawn"] as const;

let highlighter: Highlighter | null = null;
let highlighterPromise: Promise<Highlighter> | null = null;

export async function getHighlighter(): Promise<Highlighter> {
  if (highlighter) return highlighter;
  if (highlighterPromise) return highlighterPromise;
  highlighterPromise = createHighlighter({
    themes: SHIKI_THEMES as unknown as string[],
    langs: [
      // keep the existing lang list from the prior version — if not obvious,
      // leave a TODO for the engineer to transfer the list verbatim from
      // the previous file content.
    ],
  }).then((h) => {
    highlighter = h;
    return h;
  });
  return highlighterPromise;
}

export function activeShikiTheme(): string {
  const id = useSettings.getState().theme;
  const prefersDark =
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches;
  const resolved = resolveThemeId(id, prefersDark);
  return THEMES.find((t) => t.id === resolved)?.shikiTheme ?? "vitesse-dark";
}

// Keep the existing langFromPath export unchanged.
```

**Important:** transfer the `langs: [...]` list verbatim from the original file. Shiki lazy-loads languages, so the list must be complete for the existing file types diffscope highlights. If the original file lazy-loaded langs on demand, preserve that mechanism.

- [ ] **Step 3: Subscribe to theme changes and invalidate any HTML cache**

The existing highlight pipeline likely memoizes highlighted HTML per-line (check `useHighlightedTexts` in `diff-view.tsx`). On a theme change we need to:
(a) force re-highlight with the new theme, OR
(b) skip it — shiki's `codeToHtml` is cheap enough that re-rendering the visible diff on theme swap is acceptable.

**Choose (b) for simplicity.** Add a subscription in `highlight.ts` that triggers a lightweight re-render signal if a cache exists — or just document that theme changes require re-focusing the file (one-line note in the settings modal description).

If `useHighlightedTexts` uses `useMemo` keyed on `(path, texts)`, add the current shiki theme to the key:

```ts
const theme = useSettings((s) => s.theme);
// existing useMemo that produces highlighted HTML
const highlighted = useMemo(
  () => texts.map((t) => highlightText(path, t, activeShikiTheme())),
  [path, texts, theme], // ← add theme here
);
```

- [ ] **Step 4: Update diff-view.tsx callers of `useHighlightedTexts` to re-render on theme change**

Find `useHighlightedTexts` in `diff-view.tsx`. Add the theme selector inside the hook so its identity changes on theme swap. If the hook already lives in `highlight.ts`, add the selector there instead.

- [ ] **Step 5: Typecheck**

```bash
bun run typecheck
```

Expected: passes. Fix type errors for any lang list or API change.

- [ ] **Step 6: Manual smoke of diff surface**

```bash
bun run dev:web
```

1. Open a file with a diff.
2. Verify add rows are tinted (green in Midnight/Paper, amber in Aperture), del rows are tinted (red in Midnight/Paper, struck-through gray in Aperture).
3. Switch themes via the settings modal. Diff row tints must update instantly.
4. Verify shiki syntax highlighting — keywords, strings, functions — re-renders with the new shiki theme.
5. Toggle split/unified. Both modes must look right.

If Aperture's struck-through gray removals don't strike through, the `text-decoration: line-through` class is missing. Look for the row-class code and add `line-through text-fg-subtle` on the del row when the theme is aperture. **Note to engineer:** the cleanest way is a CSS rule, not a React conditional. Add to `index.css`:

```css
[data-theme="aperture"] .diff-row-del code {
  text-decoration: line-through;
  text-decoration-thickness: 0.5px;
  color: var(--diff-del-fg);
}
```

And give the del row `className="diff-row-del ..."`.

- [ ] **Step 7: Stop dev server and commit Phase 4**

```bash
git add src/web/components/diff-view.tsx src/web/components/blame-gutter.tsx src/web/lib/highlight.ts src/web/index.css
git commit -m "feat(web): repaint diff surface + shiki theme per preset

diff-view, blame-gutter, and the shiki highlighter all now flow through
the semantic token system. Each theme preset carries its own shiki
theme (vitesse-dark / catppuccin-latte / rose-pine-dawn) and diff rows
re-highlight on theme swap via a theme-keyed useMemo. Aperture's del
rows use a CSS-only strikethrough for its signature struck-through
removal look."
```

---

# Phase 5 — Lists & panes

Eight files, all mechanical substitutions. Group into two commits.

## Task 5.1 — File list and file tree

**Files:**
- Modify: `src/web/components/file-list.tsx`
- Modify: `src/web/components/file-tree.tsx`

- [ ] **Step 1: Apply the master substitution table to both files**

For each file:
1. Read it in full.
2. Grep for `dark:|neutral-[0-9]|bg-white|text-white`.
3. Replace each occurrence per the substitution table.
4. For the **active row** (selected file), use the pattern:
   ```tsx
   className={isActive
     ? "bg-surface-hover text-fg border-l-2 border-accent"
     : "text-fg-muted hover:bg-surface-hover hover:text-fg border-l-2 border-transparent"}
   ```
   The 2px accent border gives the active file an unmissable tell without a heavy background.

- [ ] **Step 2: Grep sweep per file**

```bash
rg 'dark:|neutral-[0-9]|bg-white|text-white' src/web/components/file-list.tsx src/web/components/file-tree.tsx
```

Expected: no matches.

- [ ] **Step 3: Typecheck + lint**

```bash
bun run typecheck && bun run lint
```

## Task 5.2 — Tab views (history, working-tree, branches, stashes)

**Files:**
- Modify: `src/web/tabs/history.tsx`
- Modify: `src/web/tabs/working-tree.tsx`
- Modify: `src/web/tabs/branches.tsx`
- Modify: `src/web/tabs/stashes.tsx`

- [ ] **Step 1: For each tab file, repeat the substitution process**

Pay attention to:
- **Commit list rows** in `history.tsx` — active commit gets the same `border-l-2 border-accent` treatment as the file list's active row.
- **Filter input** in `history.tsx` — `border-border focus:border-accent focus:ring-2 focus:ring-accent-soft`.
- **Status badges** (modified/added/deleted) in `working-tree.tsx` — use `text-diff-add-sign` and `text-diff-del-sign` for colored glyphs.

- [ ] **Step 2: Grep sweep across all four files**

```bash
rg 'dark:|neutral-[0-9]|bg-white|text-white' src/web/tabs/
```

Expected: no matches.

- [ ] **Step 3: Typecheck + lint**

```bash
bun run typecheck && bun run lint
```

## Task 5.3 — Pane splitters

**Files:**
- Modify: `src/web/components/pane-split.tsx`
- Modify: `src/web/components/pane-split-vertical.tsx`

- [ ] **Step 1: Apply substitution table**

The divider should use:
- Idle: `bg-border` (thin hairline)
- Hover: `bg-accent` (visible accent bar)
- Dragging: `bg-accent`

Add a small grip indicator (three dots) centered on the handle on hover:

```tsx
<div className="group relative h-full w-px bg-border transition-colors hover:bg-accent">
  <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 opacity-0 transition-opacity group-hover:opacity-100">
    <div className="flex h-6 w-1 flex-col items-center justify-center gap-0.5">
      <div className="h-0.5 w-0.5 rounded-full bg-accent-fg" />
      <div className="h-0.5 w-0.5 rounded-full bg-accent-fg" />
      <div className="h-0.5 w-0.5 rounded-full bg-accent-fg" />
    </div>
  </div>
</div>
```

Adapt to the existing DOM. The vertical splitter uses `h-px w-full` instead.

- [ ] **Step 2: Grep sweep**

```bash
rg 'dark:|neutral-[0-9]' src/web/components/pane-split.tsx src/web/components/pane-split-vertical.tsx
```

Expected: no matches.

## Task 5.4 — Phase 5 smoke + commit

- [ ] **Step 1: Dev server smoke**

```bash
bun run dev:web
```

For each theme:
- File list and file tree render with correct surface/text tokens, active file has accent border
- History tab shows commit rows, active commit is accent-bordered, filter input has accent focus ring
- Working-tree, branches, stashes render cleanly
- Pane dividers are hairlines by default, accent on hover with the grip indicator

- [ ] **Step 2: Commit**

```bash
git add \
  src/web/components/file-list.tsx \
  src/web/components/file-tree.tsx \
  src/web/components/pane-split.tsx \
  src/web/components/pane-split-vertical.tsx \
  src/web/tabs/history.tsx \
  src/web/tabs/working-tree.tsx \
  src/web/tabs/branches.tsx \
  src/web/tabs/stashes.tsx
git commit -m "feat(web): repaint lists, tabs, and pane splitters

File list, file tree, all four tab views, and both pane splitters flow
through the semantic token system. Active rows use a left accent border
instead of the prior filled-neutral background. Pane handles gain a
visible grip on hover."
```

---

# Phase 6 — Modals & floating

The biggest single rewrite is `settings-modal.tsx` — the theme picker goes from `<select>` to a card grid with live previews.

## Task 6.1 — Settings modal rewrite with theme picker

**Files:**
- Modify: `src/web/components/settings-modal.tsx`

- [ ] **Step 1: Read the current file**

Read `src/web/components/settings-modal.tsx` in full. Note the existing `Row` helper and the patterns for the other settings (`defaultTab`, `fileListMode`, `editor`, `blameStickyOn`).

- [ ] **Step 2: Replace the file in full**

```tsx
// src/web/components/settings-modal.tsx
import { useStore } from "../store";
import {
  useSettings,
  type ThemeId,
  type Editor,
  type DefaultTab,
  type FileListMode,
  THEMES,
  resolveThemeId,
} from "../settings";

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

  if (!open) return null;

  return (
    <div
      onClick={close}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-[520px] rounded-lg border border-border bg-bg-elevated p-6 shadow-soft"
      >
        <div className="mb-5 flex items-center justify-between">
          <h2 className="font-display text-lg text-fg">Settings</h2>
          <button
            onClick={close}
            className="text-fg-muted hover:text-fg"
            aria-label="Close settings"
          >
            ×
          </button>
        </div>

        <div className="space-y-5">
          <div>
            <div className="mb-2 text-xs font-medium uppercase tracking-wider text-fg-subtle">
              Theme
            </div>
            <ThemePicker current={theme} onSelect={(id) => set({ theme: id })} />
          </div>

          <Row label="Default tab">
            <select
              value={defaultTab}
              onChange={(e) =>
                set({ defaultTab: e.target.value as DefaultTab })
              }
              className="rounded border border-border-strong bg-surface px-2 py-1 text-fg focus:border-accent focus:outline-none"
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
              className="rounded border border-border-strong bg-surface px-2 py-1 text-fg focus:border-accent focus:outline-none"
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
              className="rounded border border-border-strong bg-surface px-2 py-1 text-fg focus:border-accent focus:outline-none"
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
                className="accent-accent"
              />
              <span className="text-sm text-fg-muted">
                Carry blame toggle to next file
              </span>
            </label>
          </Row>

          <div className="border-t border-border pt-4">
            <button
              onClick={() => reset(["fileListWidthPx"])}
              className="rounded border border-border-strong px-3 py-1 text-sm text-fg-muted hover:border-accent hover:text-fg"
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
      <span className="text-sm font-medium text-fg">{label}</span>
      {children}
    </div>
  );
}

interface ThemePickerProps {
  current: ThemeId;
  onSelect: (id: ThemeId) => void;
}

function ThemePicker({ current, onSelect }: ThemePickerProps) {
  return (
    <div className="grid grid-cols-2 gap-3">
      {THEMES.map((t) => {
        const isActive = current === t.id;
        // For the Auto card, render the preview using whichever theme it
        // would currently resolve to. We compute prefersDark on render —
        // the picker is transient enough that re-renders are fine.
        const prefersDark =
          typeof window !== "undefined" &&
          window.matchMedia("(prefers-color-scheme: dark)").matches;
        const previewId = resolveThemeId(t.id, prefersDark);
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => onSelect(t.id)}
            className={
              "group overflow-hidden rounded-lg border-2 text-left transition " +
              (isActive
                ? "border-accent shadow-soft"
                : "border-border hover:border-border-strong")
            }
          >
            <div data-theme={previewId} className="h-20 w-full bg-bg p-2">
              <ThemePreview />
            </div>
            <div className="border-t border-border bg-surface p-3">
              <div className="font-display text-sm text-fg">{t.label}</div>
              <div className="text-xs text-fg-muted">{t.description}</div>
            </div>
          </button>
        );
      })}
    </div>
  );
}

/**
 * Miniature render of diffscope's diff view: header bar + one add row +
 * one del row + status dot. Rendered inside a `data-theme` container so
 * its colors come from the target preset's tokens.
 */
function ThemePreview() {
  return (
    <div className="flex h-full flex-col gap-0.5">
      <div className="flex h-2 items-center gap-1 rounded-sm bg-bg-elevated px-1">
        <div className="h-1 w-1 rounded-full bg-accent" />
        <div className="ml-auto h-0.5 w-4 rounded bg-border-strong" />
      </div>
      <div className="flex-1 rounded-sm border border-border bg-surface p-1">
        <div className="mb-0.5 h-1 w-full rounded-sm bg-diff-add-bg" />
        <div className="h-1 w-2/3 rounded-sm bg-diff-del-bg" />
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Typecheck + lint**

```bash
bun run typecheck && bun run lint
```

Expected: passes.

- [ ] **Step 4: Manual smoke**

```bash
bun run dev:web
```

1. Open settings modal.
2. Verify 4 cards render: Auto, Midnight, Paper, Aperture.
3. Each card's mini-preview uses its own theme's colors (Auto mirrors whichever it resolves to).
4. Clicking a card instantly swaps the whole app's theme.
5. Active card has the 2px accent border.
6. Hover on inactive cards darkens the border.

Stop dev server.

## Task 6.2 — Command palette, picker, toasts, shortcuts, open-in-editor

**Files:**
- Modify: `src/web/components/command-palette.tsx`
- Modify: `src/web/components/picker.tsx`
- Modify: `src/web/components/toasts.tsx`
- Modify: `src/web/components/shortcuts.tsx`
- Modify: `src/web/components/open-in-editor.tsx`

All mechanical substitutions. For each file:

- [ ] **Step 1: Apply the master substitution table**

Important details per file:

**command-palette.tsx:** The selected result row uses `bg-accent text-accent-fg` with a small accent chevron. The backdrop is `bg-black/50 backdrop-blur-sm`. The input has `border-border focus:border-accent focus:outline-none`.

**picker.tsx:** Same modal shell as settings — `border-border bg-bg-elevated shadow-soft`. Recent repos list uses the same `border-l-2 border-accent` active treatment as the file list.

**toasts.tsx:** Map the three variants:
- `success` → `bg-diff-add-bg text-diff-add-fg border-diff-add-sign`
- `warn` → `bg-accent-soft text-accent border-accent`
- `error` → `bg-diff-del-bg text-diff-del-fg border-diff-del-sign`

**shortcuts.tsx:** The help overlay (the list of keybindings) — backdrop `bg-black/60`, panel `bg-bg-elevated border-border`, key chips `bg-surface-hover text-fg border-border`, description text `text-fg-muted`.

**open-in-editor.tsx:** Button variants use `text-fg-muted hover:text-accent` for the per-line icon, `border-border-strong hover:border-accent text-fg-muted hover:text-fg` for the header button.

- [ ] **Step 2: Grep sweep across all five files**

```bash
rg 'dark:|neutral-[0-9]|bg-white|text-white' \
  src/web/components/command-palette.tsx \
  src/web/components/picker.tsx \
  src/web/components/toasts.tsx \
  src/web/components/shortcuts.tsx \
  src/web/components/open-in-editor.tsx
```

Expected: no matches.

- [ ] **Step 3: Typecheck + lint**

```bash
bun run typecheck && bun run lint
```

- [ ] **Step 4: Manual smoke**

```bash
bun run dev:web
```

Verify in each theme:
- `Cmd+K` opens the command palette with themed chrome
- `?` opens the shortcuts help overlay
- The picker (no repo loaded) is themed
- Trigger a toast (e.g., copy a line) and verify themed appearance
- Open-in-editor icons inherit the accent on hover

Stop dev server.

## Task 6.3 — Phase 6 commit

- [ ] **Step 1: Add command palette "Theme: …" commands**

In `src/web/components/command-palette.tsx`, add four commands to the existing command list:

```ts
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
```

Import `ThemeId` from `../settings` at the top if not already.

**No direct keybinding** — palette-only per spec's open question #1. If user wants a direct key later, add it in a follow-up.

- [ ] **Step 2: Typecheck + lint**

```bash
bun run typecheck && bun run lint
```

- [ ] **Step 3: Smoke test the palette commands**

```bash
bun run dev:web
```

Open palette (`Cmd+K`), type "theme", verify five commands appear. Test each cycles/sets correctly.

- [ ] **Step 4: Commit Phase 6**

```bash
git add \
  src/web/components/settings-modal.tsx \
  src/web/components/command-palette.tsx \
  src/web/components/picker.tsx \
  src/web/components/toasts.tsx \
  src/web/components/shortcuts.tsx \
  src/web/components/open-in-editor.tsx
git commit -m "feat(web): repaint modals + theme picker with live previews

Settings modal now shows a 2×2 grid of theme cards with miniature
previews rendered inside their own data-theme container. Command
palette, picker, toasts, shortcuts help overlay, and open-in-editor
buttons all flow through the semantic token system. Adds five 'Theme:
...' commands to the palette."
```

---

# Phase 7 — Interaction polish

The "reactive" ask: transitions, focus rings, the LIVE dot pulse.

## Task 7.1 — Global transition layer + focus rings + LIVE pulse

**Files:**
- Modify: `src/web/index.css`

- [ ] **Step 1: Append the polish block to `src/web/index.css`**

Below the theme blocks and before the `body` selector, add:

```css
/* ───────────────────────────────────────────────────────────
   Interaction polish — runs for all themes.
   Keep opt-outs tight: anything that re-renders often
   (diff rows, syntax-highlighted spans) should not animate.
   ─────────────────────────────────────────────────────────── */

*,
*::before,
*::after {
  transition:
    background-color 150ms ease-out,
    border-color 150ms ease-out,
    color 150ms ease-out,
    box-shadow 150ms ease-out;
}

/* Opt out of transitions where motion is noise or perf matters. */
pre,
code,
.diff-row,
.diff-row-add,
.diff-row-del,
.no-transition,
.no-transition * {
  transition: none;
}

/* Keyboard focus ring — applied by our components via `focus-ring` class.
   We don't use outline: because the ring needs to match the active theme's
   accent, which Tailwind's ring utilities also do, but a utility class keeps
   the markup lean. */
.focus-ring:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
  border-radius: inherit;
}

/* Drop the default focus ring on buttons and inputs that our code manages. */
button:focus-visible,
input:focus-visible,
select:focus-visible,
textarea:focus-visible,
[role="button"]:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

/* LIVE dot pulse — used by status-bar.tsx via .live-dot. */
.live-dot {
  box-shadow: 0 0 0 0 var(--accent-soft);
  animation: live-pulse 2s ease-out infinite;
}
@keyframes live-pulse {
  0%,
  100% {
    box-shadow: 0 0 0 0 var(--accent-soft);
  }
  50% {
    box-shadow: 0 0 0 4px transparent;
  }
}
.live-dot.paused {
  animation: none;
}
```

- [ ] **Step 2: Mark the status-bar LIVE dot as paused when watcher is paused**

Open `src/web/components/status-bar.tsx`. Find the `<span className="live-dot ...">` added in Task 3.2. Modify the className to conditionally add `paused`:

```tsx
<span
  className={`live-dot inline-block h-1.5 w-1.5 rounded-full bg-accent ${
    paused || watcherDown ? "paused" : ""
  }`}
/>
```

Wire `paused` / `watcherDown` from the store selectors already present in the file (see layout.tsx for the pattern).

- [ ] **Step 3: Apply diff-row opt-out classes in `diff-view.tsx`**

Find the unified and split row rendering in `diff-view.tsx`. Add `diff-row-add` / `diff-row-del` class names to add/del rows so the global transition opt-out applies. The CSS is already scoped to those class names.

- [ ] **Step 4: Typecheck + lint + build**

```bash
bun run typecheck && bun run lint && bun run build:web
```

Expected: all pass.

- [ ] **Step 5: Manual smoke**

```bash
bun run dev:web
```

Verify:
- Theme swap fades the background/colors across ~150ms — not snap, not sluggish.
- Keyboard focus on buttons and inputs shows a 2px accent ring with 2px offset.
- LIVE dot in the status bar pulses slowly (2s loop).
- Pressing Pause (in the header) stops the LIVE dot pulse.
- Diff rows do NOT animate on theme swap — they snap. (If they transition, the `.diff-row-add` / `.diff-row-del` classes aren't being applied.)

- [ ] **Step 6: Commit Phase 7**

```bash
git add src/web/index.css src/web/components/status-bar.tsx src/web/components/diff-view.tsx
git commit -m "feat(web): interaction polish — transitions, focus rings, LIVE pulse

Adds a 150ms global ease-out transition on background/border/color/
shadow with a scoped opt-out for diff rows and shiki-highlighted code.
Button/input focus-visible now draws a 2px accent ring matching the
active theme. LIVE status dot gains a 2s pulse that stops when the
watcher is paused or down."
```

**Sliding active-tab underline** — cut per spec's open question #4 unless the engineer has time at the end of Phase 8 and wants to add it as a follow-up. The static active-tab `bg-accent` look from Task 3.1 is the shipped version.

---

# Phase 8 — Cleanup sweep + final verification

## Task 8.1 — Grep for leftover legacy classes

- [ ] **Step 1: Sweep the full `src/web/` directory**

```bash
rg 'dark:' src/web/
```

Expected: **no matches.** If any exist, fix them using the substitution table and re-run.

```bash
rg 'bg-neutral-[0-9]|text-neutral-[0-9]|border-neutral-[0-9]' src/web/
```

Expected: no matches.

```bash
rg 'bg-white(?![-\w])|text-white(?![-\w])' src/web/
```

Expected: no matches. (The negative lookaheads exclude `white-*` variants like `whiteboard`, if any.)

```bash
rg 'bg-(red|green|blue|cyan|amber|orange|yellow)-[0-9]' src/web/
```

Expected: **no matches** except possibly inside the shiki language list in `highlight.ts` (if any configured token colors exist — they shouldn't). Investigate any hits.

- [ ] **Step 2: Fix any stragglers inline**

If the sweep finds leftover classes, fix them in place and re-run the greps until all four return zero.

## Task 8.2 — Full test suite

- [ ] **Step 1: Run all tests**

```bash
bun test
```

Expected: all pass. The backend suites (`blame`, `parser`, `events`, `repo`, `editor-urls`, `fuzzy`) should be unaffected by this repaint since we touched zero backend code.

- [ ] **Step 2: Typecheck both configs**

```bash
bun run typecheck
```

Expected: passes.

- [ ] **Step 3: Lint**

```bash
bun run lint
```

Expected: passes.

- [ ] **Step 4: Production build**

```bash
bun run build:web
```

Expected: builds successfully. Check the output for warnings. Note the final bundle size — it should be essentially the same as before (tokens are CSS, not JS).

## Task 8.3 — Final manual acceptance

- [ ] **Step 1: Dev server**

```bash
bun run dev:web
```

- [ ] **Step 2: Walk through the full UI in each theme**

For **Auto**, **Midnight**, **Paper**, **Aperture**:
- Header and tab nav chrome
- Working Tree tab: file list, diff view, hunk header, blame toggle
- History tab: commit list, filter, commit detail, file list, diff
- Branches tab
- Stashes tab
- Settings modal with the theme picker (verify the Auto card updates its preview when you toggle OS dark mode)
- Command palette (`Cmd+K`), including typing "theme" and running each Theme command
- Shortcuts help overlay (`?`)
- Picker (unload the repo or reload on an empty directory to test)
- Toasts (trigger one via a copy action)

- [ ] **Step 3: Keyboard navigation**

Tab through buttons, verify the accent focus ring draws on every button and input. Ensure no browser-default blue ring leaks through.

- [ ] **Step 4: Responsive check**

Resize the window from wide → narrow. The recent responsive pass should still work — header wraps, diff auto-switches from split to unified. Verify the repaint didn't break the responsive breakpoints.

- [ ] **Step 5: LIVE dot animation**

Watch the status bar for 2s cycles. Pause the watcher — pulse stops. Resume — pulse restarts.

- [ ] **Step 6: Stop dev server**

## Task 8.4 — Final commit (if any cleanup happened)

- [ ] **Step 1: Check git status**

```bash
git status
```

If Phase 8 produced any straggler fixes, commit them:

```bash
git add -u src/web/
git commit -m "chore(web): final cleanup sweep — remove leftover dark: and neutral-*"
```

If Phase 8 was clean (no changes), skip this task.

---

## Self-review gap check

Spec requirements → task mapping:

| Spec section | Covered by |
|---|---|
| Semantic CSS-variable tokens | Task 1.2 |
| Tailwind integration w/ semantic names | Task 1.3 |
| Font loading via Google Fonts link | Task 1.1 |
| Theme application (`applyTheme`, auto OS listener) | Task 1.5 |
| Three theme presets (Midnight/Paper/Aperture) | Task 1.2 |
| `auto` theme + `resolveThemeId` | Task 1.4 |
| Legacy theme migration | Task 1.4 + test coverage |
| Settings modal card picker w/ live previews | Task 6.1 |
| Command palette Theme: commands | Task 6.3 |
| Header + tab nav repaint | Task 3.1 |
| Status bar repaint + LIVE pulse | Task 3.2, 7.1 |
| Diff surface repaint | Task 4.1 |
| Shiki theme swap per preset | Task 4.3 |
| Blame gutter repaint | Task 4.2 |
| Aperture's struck-through-gray removals | Task 4.3 step 6 (CSS rule) |
| File list / tree repaint w/ active accent border | Task 5.1 |
| Tab views repaint | Task 5.2 |
| Pane splitters w/ grip indicator | Task 5.3 |
| Command palette / picker / toasts / shortcuts / open-in-editor repaint | Task 6.2 |
| Global 150ms transition layer + opt-out | Task 7.1 |
| Focus rings | Task 7.1 |
| Cleanup sweep for `dark:*` and `neutral-*` | Task 8.1 |
| Typecheck / lint / build / test verification | Tasks 4-8 |

**Out-of-scope items from spec** (correctly not in plan):
- Sliding active-tab underline — noted as cut in Phase 7
- Reduced-motion media query — deferred
- Print stylesheet — deferred
- Accessibility audit — deferred

**Open questions** (deferred to implementation-time decisions with recommendations):
- Theme cycle keybinding: palette-only (Task 6.3) with recommendation to skip direct bind
- Aperture removals: struck-through-gray shipped (Task 4.3 step 6)
- Midnight shiki theme: `vitesse-dark` (Task 1.4)
- Sliding underline: cut (Phase 7)

All spec requirements have explicit task coverage. Plan complete.
