# Power-User Polish — Design Spec

**Date:** 2026-04-09
**Status:** Approved for planning
**Scope:** 7 frontend features + 1 small backend endpoint. Tauri packaging (item 8 of the original request) is explicitly deferred to a separate brainstorm and out of scope here.

## Motivation

diffscope has reached the point where the happy path (open a repo, watch the diff) works well. The next round of work is quality-of-life for frequent users: more ways to navigate, more places to configure, more ways to leave the app and come back to the code itself. None of the features are architecturally risky on their own, but several of them share state, so they are being designed together so the storage and shortcut plumbing is built once.

## Features in scope

1. **Resizable panes** — drag the divider between the file list and the diff view.
2. **Cmd+K command palette** — actions + contextual items (files / commits / branches / stashes).
3. **File-tree view** — alternative rendering of the file list, client-side only, mode toggle persisted.
4. **Inline blame in diff view** — lazy, per-file, HEAD-only.
5. **Open in editor** — vscode://, cursor://, zed://, idea://, subl:// URIs. Per-line hover affordance plus a header button.
6. **Settings panel** — centered modal, triggered by `,` / gear / palette.
7. **More keyboard shortcuts** — context-sensitive Esc/Enter, `b` / `t` / `g{whbs}` / `[]` / `Cmd+K` / `,`, updated `?` help.

Out of scope: Tauri wrap, whitespace-diff toggle, backend settings file, custom editor URL templates, persisting file-tree collapse state, blame on working-tree files.

## Architecture

### Centralized settings store

New module `src/web/settings.ts`. A small Zustand store that owns all user-persisted preferences and writes through to `localStorage` under a single prefix.

```ts
type Theme = "system" | "light" | "dark";
type Editor = "none" | "vscode" | "cursor" | "zed" | "idea" | "subl";
type FileListMode = "flat" | "tree";

interface Settings {
  theme: Theme;
  defaultTab: Tab | "last-used";
  fileListMode: FileListMode;
  editor: Editor;
  blameStickyOn: boolean;      // does turning blame on for one file carry to the next?
  fileListWidthPx: number;     // pane split width
}
```

Initial defaults: `{ theme: "system", defaultTab: "last-used", fileListMode: "flat", editor: "none", blameStickyOn: false, fileListWidthPx: 320 }`.

- One storage key: `diffscope:settings:v1` → JSON-encoded `Settings`.
- One setter: `useSettings.getState().set(partial)` writes to the store and flushes to `localStorage` in a single call.
- One boot call: `useSettings.getState().load()` reads once on app start, migrates legacy keys `diffscope:tab` / `diffscope:diffMode` into the new store, then deletes them.
- `useStore.setTab` and `useStore.setDiffMode` remain as the UI-facing mutators but delegate persistence to `useSettings` so there is no longer any direct `localStorage.setItem` call in `store.ts`.
- No React Context; all components read via `useSettings` hook calls.

### Theme application

New module `src/web/theme.ts`. A single `applyTheme(theme)` function that:

- Sets `data-theme="light"` or `data-theme="dark"` on `document.documentElement`.
- For `system`, reads `matchMedia('(prefers-color-scheme: dark)')` and subscribes to its `change` event so the UI follows the OS at runtime.
- Is called once at boot (from `app.tsx`) and again from `useSettings.set` whenever `theme` changes.

The existing Tailwind config uses class-based dark mode (`darkMode: "class"`). If it turns out to be `"media"`, switch to `"class"` as part of step 1 of the plan — this is a trivial config change and a one-line update to the dark-mode selector pattern the components already use.

### UI component map

| Component | Status | Responsibility |
|---|---|---|
| `src/web/components/layout.tsx` | Modified | Wrap file-list + diff-view in `<PaneSplit>`; keep tab bar and status bar outside it so they span the full width. |
| `src/web/components/pane-split.tsx` | New | 4px draggable divider; clamps width to `[180, 0.4 * window.innerWidth]`; double-click resets to `320`; writes through to `useSettings.fileListWidthPx` with a `requestAnimationFrame` throttle. |
| `src/web/components/file-list.tsx` | Modified | Header row with list/tree icon toggle bound to `useSettings.fileListMode`; picks `<FileList flat />` or `<FileTree />`. The two renderers emit the same ordered flat array of focusable paths so `j/k` keeps working unchanged. |
| `src/web/components/file-tree.tsx` | New | Pure function of `FileStatus[]` → nested render. Directories collapsible; change-count badge per directory; files look identical to the flat mode. Collapse state is React-local (resets on reload). First render and every subsequent update seeds the `expanded` set with all ancestor directories of every changed path. Header has `Expand all` / `Collapse all`. |
| `src/web/components/diff-view.tsx` | Modified | Three additions: blame toggle in header; `<BlameGutter>` column on the left of each diff line when blame is on; per-line `↗` hover icon when `settings.editor !== "none"` plus header "Open in editor" button for the first hunk line. Blame button disabled with tooltip on working-tree/unstaged diffs. |
| `src/web/components/blame-gutter.tsx` | New | Renders `<sha7> <author-initials> <relative-time>` per line; popover with full commit message + date on hover; click dispatches `focusCommit(sha)` + `setTab('history')`. Lines with no blame (uncommitted, added hunks) render a muted `—`. |
| `src/web/components/open-in-editor.tsx` | New | Small hover-triggered `↗` icon in the diff gutter, plus the header button. Both call `editorUrl(settings.editor, absPath, line, col)` and set `window.location = url`. Entire feature is hidden when `settings.editor === "none"`. |
| `src/web/lib/editor-urls.ts` | New | Pure function: `editorUrl(editor, absPath, line, col) → string`. Covers the 5 known schemes. Unit-testable. |
| `src/web/components/command-palette.tsx` | New | Mounted at app root. Open state is transient (not persisted). Fuzzy input + Actions section + contextual Items section (files / commits / branches / stashes, chosen by current tab). Arrow keys move, Enter activates, Esc closes. |
| `src/web/lib/fuzzy.ts` | New | ~20 LOC substring + acronym scorer. No external library. |
| `src/web/components/settings-modal.tsx` | New | Centered modal with one labeled row per `Settings` field, plus a "Reset pane widths" button. Every control calls `useSettings.set({...})` directly — no local form state, no apply/cancel. |
| `src/web/components/shortcuts.tsx` | Modified | New bindings; Esc/Enter become context-sensitive priority chains (settings > palette > filter > file); `?` help overlay updated. |
| `src/web/components/status-bar.tsx` | Modified | Add a small gear icon that opens the settings modal. |
| `src/web/app.tsx` | Modified | Call `useSettings.load()` + `applyTheme(...)` at boot; mount `<CommandPalette />` and `<SettingsModal />` at root. |
| `src/web/store.ts` | Modified | Remove inline `localStorage.setItem` calls. Add transient UI state: `paletteOpen: boolean`, `settingsOpen: boolean`, `blameOnFor: Set<string>`, `blameCache: Map<string, BlameLine[]>` keyed by `${path}@${headSha}`. New actions: `openPalette`, `closePalette`, `openSettings`, `closeSettings`, `toggleBlame(path)`, `focusBlameCommit(sha)`. |
| `src/shared/types.ts` | Modified | Add `BlameLine` type. |
| `src/server/blame.ts` | New | `blameFile(repo, path) → Promise<BlameLine[]>` — runs `git blame --porcelain HEAD -- <path>`, parses the porcelain format, returns a per-line array. In-memory LRU cache keyed by `(path, headSha)`; invalidated on `head-changed`. |
| `src/server/http.ts` | Modified | Register `GET /api/blame?path=<p>` route; same path-safety validation as `/api/diff`; 404 for untracked/new files with no HEAD version. |
| `test/blame.test.ts` | New | Uses the existing repo-fixture helper: seeds a repo, creates and commits a file, modifies it, calls `blameFile`, asserts the returned lines match. Plus one parser edge case (multi-commit file). |

### Backend — blame endpoint

One endpoint: `GET /api/blame?path=<p>` → `BlameLine[]`.

```ts
interface BlameLine {
  lineNumber: number;    // 1-based, in the HEAD version of the file
  sha: string;           // full 40-char
  shaShort: string;      // first 7
  author: string;        // "Eric Baruch"
  authorTimeIso: string; // "2026-04-02T14:31:08Z"
  summary: string;       // one-line commit summary
}
```

- Implemented in `src/server/blame.ts` via the existing subprocess helper in `repo.ts`.
- Command: `git blame --porcelain HEAD -- <path>`.
- Parses the porcelain format: for each `<sha> <orig-line> <final-line> [<group>]` header, carries forward the sha, author, author-time, and summary; associates each content line with its sha.
- Validates `path` with the same check used by `/api/diff` so arbitrary paths can't be passed in.
- In-memory cache keyed by `${path}@${headSha}`; invalidated in the same hook that already fires a `head-changed` SSE event. Bounded LRU (e.g. 256 entries) so large histories don't grow memory unboundedly.
- Returns `404` if the file has no HEAD version (untracked or newly added).

### Data flow — blame

1. User clicks blame toggle on a diff view (or presses `b`).
2. `store.toggleBlame(path)` flips `path` in `blameOnFor`.
3. Diff view reads `blameOnFor.has(path)`. If on and no cache entry, it fires a fetch to `/api/blame?path=<p>` and stores the result in `blameCache[${path}@${headSha}]`.
4. `<BlameGutter>` reads the cached array; re-renders when the fetch resolves.
5. When `settings.blameStickyOn` is true, focusing a new file copies `blameOnFor` membership from the previously focused file.
6. On `head-changed` SSE event, the store clears matching `blameCache` entries for files whose blame was on and refetches them.

### Keyboard shortcuts — complete list after this work

Existing: `j/k`, `Tab`, `u` (unified/split), `/` (filter), `p` (pause), `?` (help).

New:

- `Cmd+K` / `Ctrl+K` — open command palette.
- `,` — open settings modal.
- `b` — toggle blame on the currently focused file.
- `t` — toggle flat / tree file list.
- `g` then `w` / `h` / `b` / `s` — go to Working Tree / History / Branches / Stashes (vim-style leader; 1500ms window for the follow-up key, then cleared).
- `[` / `]` — previous / next item in the currently active tab's list (files, commits, branches, stashes).
- **Esc** — priority chain: if settings modal is open, close it; else if palette is open, close it; else if filter input is focused, clear and blur it; else if a file is focused in the diff view, unfocus it (empty state).
- **Enter** — priority chain: if palette is open, activate the selected item; else if a file is highlighted in the list but not yet focused, focus it; else if the diff view is showing a "too big" collapsed placeholder, expand it.

The `shortcuts.tsx` module restructures from a flat `if/else` chain into a small ordered handler list that checks UI state before dispatching. The `?` help overlay is updated to document every key above.

## Error handling and edge cases

- **Blame fetch failure** → toast "Blame failed: <reason>"; blame stays off for that file; no retry loop.
- **Blame on a file with no HEAD version** → endpoint returns 404; UI shows a one-line muted banner in the gutter ("No HEAD version") and does not retry.
- **Very large files with blame on** → rendering is virtualized by the existing diff-view collapsing; blame gutter follows the same collapsed/expanded state and only renders for visible lines.
- **Editor URL with missing config** → not reachable: the hover icon and header button are hidden when `settings.editor === "none"`.
- **Pane drag past window edge** → clamp to `[180, 0.4 * window.innerWidth]`; on window resize, if the stored width exceeds the new max, clamp on next render (no immediate write).
- **Command palette with empty contextual section** (e.g. no commits yet in a fresh repo) → render just the Actions section and a muted empty-state row under the Items header.
- **Settings `defaultTab` set to a tab but URL/route says otherwise** → `defaultTab` only applies on initial mount; it does not override the user once they click a tab during a session.
- **Theme flash on first load** → `applyTheme` runs synchronously in `app.tsx` before the first render; no `useEffect` deferral.
- **Legacy localStorage migration** → one-time read of `diffscope:tab` / `diffscope:diffMode` if the new key is absent; after migration both legacy keys are removed.

## Testing

- **Backend**: `test/blame.test.ts` covers (a) basic blame of a committed file, (b) multi-commit file with lines attributed to different shas, (c) 404 for an untracked file.
- **Parser**: the porcelain parser is covered by the same tests (it's the implementation of `blameFile`).
- **Frontend**: no automated tests added (the project currently has no frontend test harness; adding one is out of scope). A manual smoke-check list will be part of the implementation plan covering: pane drag + reset, palette open/close with every trigger, palette navigation on each tab, file tree expand/collapse + mode toggle, blame toggle + sticky mode + cache hit path, open-in-editor for each of the 5 schemes, settings modal for each field, every new keyboard shortcut in each relevant context, theme override (system follows OS, light/dark override).

## Implementation phasing

Each phase is independently mergeable and leaves the app in a working state.

1. **Settings store + theme plumbing.** New `settings.ts` and `theme.ts`. Migrate legacy keys. No visible features; verify existing UX is unchanged.
2. **Resizable panes.** Validates the store round-trip.
3. **Settings modal.** All fields except the ones the palette will add. Gear in status bar + `,` shortcut.
4. **File-tree view.** Mode toggle in file-list header, `t` shortcut wired.
5. **Command palette.** Actions registry + contextual items per tab. `Cmd+K` shortcut.
6. **Backend blame endpoint + tests.** Fully standalone.
7. **Diff-view blame gutter + open-in-editor.** Depends on 3 (editor setting) and 6 (endpoint).
8. **Remaining shortcuts + updated help overlay.** Esc/Enter priority chain, `b`, `g{whbs}`, `[`/`]`, and rewrite of `?` content.

## Risks and open questions

- **Tailwind dark-mode config.** If the project is on `darkMode: "media"`, step 1 has to flip it to `"class"` and audit the existing components for any `@media (prefers-color-scheme: dark)` references. Impact is small but the plan should call it out as a verification task.
- **`git blame --porcelain` output stability.** This format is part of git's documented plumbing interface and hasn't changed in years; parser should still be defensive about unknown header lines (skip them).
- **Relative-time formatting.** The blame gutter uses relative times ("2h ago") that already have a formatter in the recents list (`main.tsx` / `history.tsx`). Reuse it; don't add a second implementation.
- **`Cmd+K` on macOS vs `Ctrl+K` on Linux/Windows.** Handler matches on `e.metaKey || e.ctrlKey` + `k`. Both map to the same action.
