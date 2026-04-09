# diffscope — Frontend Polish & Theme System

**Status:** draft
**Date:** 2026-04-09
**Author:** brainstorm pair (eric + claude)

## Summary

Elevate diffscope from its current "functional neutral" look to a distinctive, polished developer tool with a pluggable theme system. Three themes ship on day one: **Midnight** (default, dark), **Paper** (light editorial), **Aperture** (light premium). Users swap themes live from the settings modal via a card picker. The change is visual only — layout, interactions, keyboard shortcuts, responsive breakpoints, and the recently-modified files' in-progress work are preserved.

## Motivation

diffscope has strong bones: zustand store, live SSE updates, resizable panes, command palette, blame gutter, split diff. Every interaction has been considered. The skin has not. Every component uses raw Tailwind neutrals with `dark:` conditional classes, no typography point-of-view, no accent color, no visual hierarchy beyond size and weight. The tool reads as "a utility" when it could read as "a tool someone chose to use."

The polish pass also unlocks future theme contributions — once the token system exists, adding a fourth preset (e.g., solarized, high-contrast accessibility, terminal-green) becomes a CSS-only change.

## Architecture

### Semantic design tokens via CSS variables

Current state: every component hardcodes color pairs like `bg-neutral-50 dark:bg-neutral-900`. This cannot cleanly support N themes.

Target state: a flat, semantic token set defined as CSS custom properties per `[data-theme]` block in `src/web/index.css`. The tokens are consumed through Tailwind's `theme.extend` mapping so components use names like `bg-surface text-fg-muted` instead of raw values.

```css
/* src/web/index.css */
:root, [data-theme="midnight"] {
  --bg:           #0b0d10;
  --bg-elevated:  #0d1016;
  --surface:      #12151a;
  --surface-hover:#1a2230;
  --border:       #1a2230;
  --border-strong:#2a3441;

  --fg:           #e2e8f0;
  --fg-muted:     #64748b;
  --fg-subtle:    #475569;

  --accent:       #67e8f9;
  --accent-fg:    #0b0d10;
  --accent-soft:  rgba(103, 232, 249, 0.12);

  --diff-add-bg:  rgba(34, 197, 94, 0.08);
  --diff-add-fg:  #86efac;
  --diff-add-sign:#22c55e;
  --diff-del-bg:  rgba(239, 68, 68, 0.09);
  --diff-del-fg:  #fca5a5;
  --diff-del-sign:#ef4444;

  --hunk-bg:      rgba(103, 232, 249, 0.06);
  --hunk-fg:      #67e8f9;

  --shadow-soft:  0 1px 2px rgba(0,0,0,0.4), 0 8px 24px -12px rgba(0,0,0,0.5);
  --ring:         0 0 0 2px var(--accent);

  --font-sans:    "IBM Plex Sans", ui-sans-serif, system-ui, sans-serif;
  --font-display: "JetBrains Mono", ui-monospace, monospace;
  --font-mono:    "JetBrains Mono", ui-monospace, monospace;

  --radius:       6px;
  --radius-lg:    10px;

  color-scheme: dark;
}

[data-theme="paper"]    { /* full block — see Theme Inventory */ color-scheme: light; }
[data-theme="aperture"] { /* full block — see Theme Inventory */ color-scheme: light; }
```

### Tailwind integration

`tailwind.config.ts` extends with semantic names referencing the variables. Dark mode classes are removed entirely; `data-theme` is the single switch, each theme declares its own mode internally.

```ts
// tailwind.config.ts
import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/web/**/*.{ts,tsx}"],
  // darkMode removed — no more `dark:` modifiers in components
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
        sans: "var(--font-sans)",
        display: "var(--font-display)",
        mono: "var(--font-mono)",
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

Tailwind's default `border-border` utility (used by shadcn projects) is re-created automatically via the semantic `border` color mapping above.

### Font loading

Single `<link>` block in `index.html`, preconnected to Google Fonts:

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600&family=JetBrains+Mono:wght@400;500&family=Fraunces:ital,wght@0,400;0,600;1,400&family=Instrument+Serif:ital@0;1&family=Geist:wght@400;500;600&display=swap">
```

- All five font families in one request, `display=swap` to avoid FOIT.
- Total uncompressed weight ≈ 180KB across the Plex Sans, JBM, Fraunces, Instrument Serif, Geist subsets. Served from Google's CDN, cached cross-origin by the browser, no impact on the Vite build.
- Fallback stacks in the `--font-*` variables ensure readable chrome during the swap window.
- Rejected alternative: `@fontsource/*` packages bundled into the build. Would inflate the Vite chunk by 150–200KB gzipped and require explicit imports per family. Not worth it for a locally-run dev tool.

### Theme application

`src/web/theme.ts` is rewritten to apply a named preset instead of a light/dark binary:

```ts
// theme.ts
import type { ThemeId } from "./settings";
import { THEMES } from "./settings";

export function applyTheme(id: ThemeId): void {
  if (typeof document === "undefined") return;
  const resolved = id === "auto" ? resolveAuto() : id;
  document.documentElement.setAttribute("data-theme", resolved);
}

function resolveAuto(): Exclude<ThemeId, "auto"> {
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  return prefersDark ? "midnight" : "paper";
}
```

`"auto"` preserves the existing "follow OS" behavior by mapping to midnight or paper at runtime. When `auto` is selected, the same `matchMedia` listener from the current implementation re-runs `applyTheme("auto")` on OS changes.

## Theme Inventory

### Midnight (default, dark)

| Token | Value |
|---|---|
| `--bg` / `--surface` | `#0b0d10` / `#12151a` |
| `--fg` / `--fg-muted` / `--fg-subtle` | `#e2e8f0` / `#64748b` / `#475569` |
| `--border` | `#1a2230` |
| `--accent` | `#67e8f9` (cyan) |
| `--diff-add-bg` / `--diff-add-fg` | `rgba(34,197,94,.08)` / `#86efac` |
| `--diff-del-bg` / `--diff-del-fg` | `rgba(239,68,68,.09)` / `#fca5a5` |
| Display | JetBrains Mono 500 (wordmark, small-caps chrome) |
| Body | IBM Plex Sans 400/500 |
| Mono | JetBrains Mono 400 |
| Shiki theme | `vitesse-dark` |
| Radius | 6px |

Active tab: 2px accent underline. Focus ring: 2px accent outset. Brand dot on "LIVE" status: cyan with soft glow.

### Paper (light, editorial)

| Token | Value |
|---|---|
| `--bg` / `--surface` | `#faf7f1` (cream) / `#fffefa` |
| `--fg` / `--fg-muted` / `--fg-subtle` | `#1c1917` / `#78716c` / `#a8a29e` |
| `--border` | `#ede5d2` |
| `--accent` | `#c2410c` (terracotta) |
| `--diff-add-bg` / `--diff-add-fg` | `#ecfdf5` / `#15803d` |
| `--diff-del-bg` / `--diff-del-fg` | `#fef2f2` / `#b91c1c` |
| Display | **Fraunces 400 italic** (wordmark) + Fraunces 600 (headings) |
| Body | IBM Plex Sans 400/500 |
| Mono | JetBrains Mono 400 |
| Shiki theme | `catppuccin-latte` |
| Radius | 8px (9999px on tabs) |

Tabs are hard pills with a black active state. Wordmark uses Fraunces italic. Diff rows read like pale marginalia (sage/rose), not alarms.

### Aperture (light, premium)

| Token | Value |
|---|---|
| `--bg` / `--surface` | `#f7f7f5` / `#ffffff` |
| `--fg` / `--fg-muted` / `--fg-subtle` | `#0c0a09` / `#57534e` / `#a8a29e` |
| `--border` | `#e7e5e4` |
| `--accent` | `#b45309` (amber) |
| `--diff-add-bg` / `--diff-add-fg` / `--diff-add-sign` | `#fefce8` / `#713f12` / `#b45309` |
| `--diff-del-bg` / `--diff-del-fg` | `#fafaf9` / `#a8a29e` (struck-through) |
| Display | **Instrument Serif 400 + italic** (wordmark, italic `·`) |
| Body | **Geist** 400/500/600 |
| Mono | JetBrains Mono 400 |
| Shiki theme | `rose-pine-dawn` |
| Radius | 6px |

Signature: **removals are struck-through gray, not red.** Tabs are small caps with a 2px amber underline and 0.06em letter-spacing. Status bar uses small caps throughout.

### Common to all presets

- Same DOM, same layout, same responsive breakpoints.
- Each preset declares `mode: "light" | "dark"` for the small number of components that need to adjust shadows/backdrop-blur intensity. Nothing else branches on mode.
- Adding a fourth preset = one new `[data-theme="name"]` block in `index.css` + one entry in `THEMES` table. Zero component changes.

## Settings & Persistence

### `settings.ts` changes

```ts
// settings.ts
export type ThemeId = "auto" | "midnight" | "paper" | "aperture";

export interface ThemeMeta {
  id: ThemeId;
  label: string;
  mode: "light" | "dark";
  accent: string;       // display swatch in the picker
  shikiTheme: string;
  description: string;  // short tagline for picker
}

// `auto` carries no visual metadata of its own — it is a pointer to
// whichever concrete preset `applyTheme` resolves to. Code that wants to
// render a swatch or decide a mode for `auto` must resolve it first via
// `resolveThemeId(id)`.
export const THEMES: ThemeMeta[] = [
  { id: "auto",     label: "Auto (follow OS)", mode: "dark",  accent: "#67e8f9", shikiTheme: "vitesse-dark",    description: "Matches your system" },
  { id: "midnight", label: "Midnight",          mode: "dark",  accent: "#67e8f9", shikiTheme: "vitesse-dark",    description: "Dark · refined editor" },
  { id: "paper",    label: "Paper",             mode: "light", accent: "#c2410c", shikiTheme: "catppuccin-latte",description: "Light · editorial" },
  { id: "aperture", label: "Aperture",          mode: "light", accent: "#b45309", shikiTheme: "rose-pine-dawn", description: "Light · premium" },
];

export function resolveThemeId(id: ThemeId): Exclude<ThemeId, "auto"> {
  if (id !== "auto") return id;
  const prefersDark = typeof window !== "undefined"
    && window.matchMedia("(prefers-color-scheme: dark)").matches;
  return prefersDark ? "midnight" : "paper";
}

// Settings.theme: Theme → ThemeId
interface Settings {
  theme: ThemeId;
  // ... rest unchanged
}
```

### Migration

`load()` migrates legacy theme values on read:

| Legacy value | New value |
|---|---|
| `"system"` | `"auto"` |
| `"dark"` | `"midnight"` |
| `"light"` | `"paper"` |
| anything else | `"auto"` |

Migration runs once, writes the migrated value back to localStorage, and is idempotent on subsequent reads. No user data is lost.

### Theme picker UI (settings modal)

The Theme row in `settings-modal.tsx` becomes a 2×2 card grid (auto + three presets). Each card is a 120×80 preview rendered using the target theme's tokens — a miniature header bar, one diff-add row, one diff-del row, a status dot. Clicking applies instantly; no "Save" button.

```tsx
// Shape only — full markup in implementation
<div className="grid grid-cols-2 gap-3">
  {THEMES.map((t) => (
    <button
      key={t.id}
      data-theme={t.id}
      onClick={() => set({ theme: t.id })}
      className={
        "group relative rounded-lg border-2 p-0 text-left transition " +
        (theme === t.id ? "border-accent shadow-soft" : "border-border hover:border-border-strong")
      }
    >
      <MiniPreview themeId={t.id} />
      <div className="p-3">
        <div className="font-display text-sm">{t.label}</div>
        <div className="text-xs text-fg-muted">{t.description}</div>
      </div>
    </button>
  ))}
</div>
```

`MiniPreview` renders its content inside a container with `data-theme={resolveThemeId(id)}` so each preview uses its own tokens — and the "Auto" card shows whichever concrete preset it currently points at. This is the entire reason tokens are scoped to `[data-theme]` blocks rather than `:root` alone.

Keyboard nav in the picker: `←/→/↑/↓` move focus, `Enter`/`Space` applies, `Esc` closes (handled by existing shortcuts priority chain).

### Command palette additions

```
Theme: Midnight
Theme: Paper
Theme: Aperture
Theme: Auto (follow OS)
Theme: Cycle
```

"Cycle" rotates `auto → midnight → paper → aperture → auto`.

### Keybinding for theme cycling — **OPEN QUESTION**

`T` is already bound to "Toggle flat / tree file list" (see `src/web/components/shortcuts.tsx:20`). Options:

1. **Skip direct keybinding.** Palette-only (`Cmd+K` → type "theme"). Lowest friction, no conflict.
2. **`Shift+T`.** Available, discoverable via the help overlay.
3. **`g t` chord.** Fits the existing g-leader pattern (see recent commit `f2c1928`).

**Recommendation: Option 1 (palette-only) unless Eric has a strong preference for a dedicated key.**

## Component Repaint Scope

All files in `src/web/` that render chrome. Mechanical substitution — each `bg-neutral-N dark:bg-neutral-M` becomes a semantic token. Approximate counts assume one pass per file.

### Top-level chrome

- `src/web/app.tsx` — bootstrap only, no visual change
- `src/web/index.css` — token definitions for all themes, body font, scrollbar styling per theme, global transition layer
- `src/web/theme.ts` — rewrite to apply `ThemeId`
- `src/web/components/layout.tsx` — header, wordmark, tab nav (active underline), diff-mode toggle, pause button
- `src/web/components/status-bar.tsx` — repaint to surface/border tokens, "LIVE" dot pulse animation

### Diff surface

- `src/web/components/diff-view.tsx` — sticky file header, hunk header bar, add/del row tints, blame column styling, large-diff collapse banner, binary file notice, image diff chrome
- `src/web/components/blame-gutter.tsx` — gutter tokens
- `src/web/lib/highlight.ts` — read active theme's `shikiTheme`, pass to `getHighlighter({ themes })`. Re-highlight on theme change by invalidating the highlighter cache.

### Lists & panes

- `src/web/components/file-list.tsx` — active row accent bar, hover wash
- `src/web/components/file-tree.tsx` — same pattern, tree indent guides use border token
- `src/web/components/pane-split.tsx` — divider hairline, drag handle grip on hover
- `src/web/components/pane-split-vertical.tsx` — same
- `src/web/tabs/history.tsx` — commit row, filter input, focused commit highlight
- `src/web/tabs/working-tree.tsx` — status row
- `src/web/tabs/branches.tsx` — branch row
- `src/web/tabs/stashes.tsx` — stash row

### Modals & floating

- `src/web/components/settings-modal.tsx` — full rewrite around the theme picker grid; other rows get minor token swaps
- `src/web/components/command-palette.tsx` — backdrop blur, result row hover, accent chevron for selected result
- `src/web/components/picker.tsx` — repo picker chrome
- `src/web/components/toasts.tsx` — success/warn/error variants use `accent` / `diff-add-bg` / `diff-del-bg`
- `src/web/components/shortcuts.tsx` — help overlay repaint
- `src/web/components/open-in-editor.tsx` — button variants

### Config

- `tailwind.config.ts` — semantic extension shown above, `darkMode` line removed
- `index.html` — Google Fonts preconnect + stylesheet link
- `src/web/settings.ts` — `Theme → ThemeId`, `THEMES` table, migration in `load()`

**Approximate scope:** ~22 files touched, ~90% of edits are className substitutions with no logic change.

## Interactions ("reactive" polish)

### Global transition layer

In `index.css`:

```css
*,
*::before,
*::after {
  transition:
    background-color 150ms ease-out,
    border-color 150ms ease-out,
    color 150ms ease-out,
    box-shadow 150ms ease-out;
}

/* Opt out where motion is noise or perf matters */
pre, code, .diff-row, .no-transition {
  transition: none;
}
```

Making theme swaps feel like a crossfade rather than a snap. The `pre`/`code` opt-out keeps shiki's syntax-highlighted spans from animating individually on theme change (that would be O(tokens) repaints).

### Focus rings

2px outset `var(--accent)` ring on buttons, inputs, list items. Drops the browser default. Keyboard navigation reads immediately.

### Hover affordances

- Buttons: subtle `translateY(-0.5px)` + elevated `--shadow-soft` on hover. 80ms transform duration (faster than color).
- List rows: `bg-surface-hover` background only — no transform, too much motion when scanning.
- Diff rows: no hover effect. Too much visual churn during review.

### "LIVE" dot pulse

`@keyframes pulse-accent` — 2s loop, box-shadow-only, no layout reflow:

```css
@keyframes pulse-accent {
  0%, 100% { box-shadow: 0 0 0 0 var(--accent-soft); }
  50%      { box-shadow: 0 0 0 4px transparent; }
}
```

Only active when the status bar reports `LIVE` (watcher up, not paused).

### Sliding active tab underline — NICE TO HAVE

A persistent `<span>` underlines the active tab and moves between tabs via `transform: translateX()`. If the existing flex-wrap header layout makes this costly (measuring tab positions on resize/wrap), **we cut it** and leave a static 2px underline on the active tab. Not a hill to die on.

## Out of Scope

Preserved as-is:
- Layout and DOM structure
- Component APIs and prop shapes
- Keyboard shortcuts (except the theme cycle open question)
- Responsive breakpoints (recent commit `8aaae96` nailed these)
- Diff parsing, shiki highlighting logic, blame, open-in-editor, SSE wiring
- Zustand store shape
- The four in-progress modified files — `diff-view.tsx`, `settings.ts`, `history.tsx`, `pane-split-vertical.tsx` — their pending changes are the baseline the polish rebases on top of

Not added in this pass:
- New features, new tabs, new settings beyond theme
- Accessibility audit (separate concern — structural, not cosmetic)
- Print stylesheet
- Reduced-motion media query wiring (add in a follow-up if needed; current transitions are subtle enough that motion-sensitive users won't be distressed)

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Font swap FOUT creates a layout jolt | `display=swap` plus system-font fallbacks in every `--font-*` variable, chosen to have close metrics |
| Global transition on `background-color` hurts perf on large diffs | `.diff-row`, `pre`, `code` are in the opt-out selector |
| Shiki theme swap on live theme change flashes unhighlighted code | `lib/highlight.ts` preloads all three shiki themes on first highlighter init; swap is a `highlighter.codeToHtml` with the new theme name, no refetch |
| `dark:*` removal breaks unused-but-imported components | Grep sweep for any remaining `dark:` modifier after refactor; CI-enforceable via oxlint rule |
| Tailwind `darkMode` removal changes semantics for anything I missed | The only consumer was `dark:*` class generation — removing both together is consistent |
| `data-theme` on `<html>` conflicts with user browser extensions | Low risk; already used by the current implementation |

## Open Questions

1. **Theme cycle keybinding** — palette-only, `Shift+T`, or `g t` chord? (Recommendation: palette-only.)
2. **Aperture's struck-through-gray removals** — distinctive signature, but reviewers scanning for dangers may find it less immediate than red. Keep as spec'd or fall back to muted amber-brown?
3. **Shiki theme for Midnight** — `vitesse-dark` chosen for its restrained palette that harmonizes with cyan accent. Alternative: `github-dark-dimmed`, `rose-pine`.
4. **Sliding active-tab underline** — build or cut? Depends on whether measuring positions on wrap is cheap enough to feel worth it.

## Implementation Handoff

This spec gets decomposed into an implementation plan via the `superpowers:writing-plans` skill. Expected plan shape:

1. Token system foundation (index.css, tailwind config, fonts, settings type)
2. Theme bootstrap + migration (theme.ts, app.tsx)
3. Top-level chrome repaint (layout, status-bar)
4. Diff surface repaint (diff-view, blame, highlight)
5. Lists & panes repaint (file-list, file-tree, tabs/*, pane-split*)
6. Modals repaint (settings-modal with picker, command-palette, picker, toasts, shortcuts)
7. Interaction layer (transitions, focus rings, LIVE pulse, optional sliding underline)
8. Verification sweep (grep for leftover `dark:*`, `neutral-N`, `text-white`, etc.)
