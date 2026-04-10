# File Explorer — Design

**Date:** 2026-04-09
**Status:** Approved for planning
**Scope:** Frontend + backend — new "Explore" mode for the Working Tree sidebar

## Summary

Add an "Explore" mode to the Working Tree sidebar so users can browse the entire
working directory, not just changed files. Clicking any file shows its content
in the existing diff pane (as a diff if changed, as plain syntax-highlighted
content if unchanged). Live updates, sticky settings, and reuse of the existing
`DiffView`, watcher, and `buildTree` primitives.

## Goals

- Browse the entire working directory from inside diffscope.
- View any file's content, not just changed files.
- Keep one sidebar, one selection model, one diff pane.
- Reuse existing infrastructure wherever possible: `DiffView`, watcher, SSE
  stream, `buildTree`, `fuzzyFilter`, shortcuts chain, settings store.

## Non-goals

- No new top-level tab and no Explorer on History / Branches / Stashes tabs.
  Explore is Working-Tree-only.
- No file editing, renaming, or deletion. Diffscope remains read-only (the
  integrated terminal is the existing escape hatch for writes).
- No lazy-loaded tree. V1 is eager. Revisit only if monorepo users hit pain.
- No activity bar / VSCode-style multi-column sidebar. Existing left sidebar
  keeps its shape.

## Layout

The Working Tree sidebar gets a segmented toggle at the top of its header:

```
[ Changes | Explore ]   ＋  −
```

- **Changes** — unchanged. Renders the current `FileTree` of changed files.
- **Explore** — new. Renders a new `FileExplorer` that shows the full working
  directory tree.

Only one mode is visible at a time. The existing `＋` / `−` expand-all /
collapse-all buttons sit to the right of the toggle and operate on whichever
tree is currently shown.

Shortcut `e` toggles modes when the Working Tree tab is focused.

History, Branches, and Stashes tabs are unchanged.

## Settings

Two new sticky fields in `src/web/settings.ts`:

- `workingTreeMode: 'changes' | 'explore'` — default `'changes'`.
- `hideIgnored: boolean` — default `true`. Controls whether Explore mode hides
  files covered by `.gitignore` (and `.git/info/exclude`, and global excludes).

Both persist through the existing settings mechanism.

## Backend

### New module: `src/server/tree.ts`

Two exported functions:

```ts
export type FsEntry = {
  path: string;       // repo-relative, POSIX separators
  isDir: boolean;
  size?: number;      // files only
};

export function listTree(
  repoRoot: string,
  opts: { hideIgnored: boolean },
): Promise<FsEntry[]>;

export type FileContents =
  | { kind: 'text'; content: string }
  | { kind: 'image'; mime: string; bytes: Uint8Array }
  | { kind: 'binary'; size: number }
  | { kind: 'tooLarge'; size: number };

export function readFile(
  repoRoot: string,
  relPath: string,
): Promise<FileContents>;
```

**`listTree`:**
- When `hideIgnored === true`: run
  `git ls-files --cached --others --exclude-standard` to get the file list,
  then synthesize directory entries from the path prefixes (no separate
  directory walk — directories are implied, mirroring how `buildTree` already
  works for changes).
- When `hideIgnored === false`: walk the working directory via
  `fs.promises.readdir({ withFileTypes: true })`, skipping only `.git`.
  Use `lstat` for symlink detection; symlinks are returned as entries at their
  link location but are never followed.
- Output is sorted the same way `buildTree` already sorts (directories first,
  alphabetical within each level) — but sorting is client-side in `buildTree`,
  so `listTree` can return unsorted and let the tree builder sort.

**`readFile`:**
- Path safety — resolve `path.join(repoRoot, relPath)` to absolute, confirm it
  still starts with the resolved repo root, reject `..`, reject absolute paths
  in `relPath`, reject symlinks whose target escapes the repo root.
- Size check — if `size > LARGE_FILE_LIMIT` (reuse the existing DiffView
  threshold), return `{ kind: 'tooLarge', size }`.
- Image detection — by extension: `.png .jpg .jpeg .gif .webp .svg .bmp .ico`.
  Return `{ kind: 'image', mime, bytes }`.
- Binary detection — read the first 8KB, if any NUL byte is present treat as
  binary, return `{ kind: 'binary', size }`.
- Otherwise — read as UTF-8 text and return `{ kind: 'text', content }`.

### New endpoints in `src/server/http.ts`

- `GET /api/tree?hideIgnored=1|0` → `{ entries: FsEntry[] }`
- `GET /api/file?path=<repo-relative-path>` → `FileContents` JSON (for
  `kind: 'image'`, bytes are base64-encoded in the JSON response so the
  frontend gets a single response shape).

Both endpoints validate inputs and return 400 on malformed queries, 403 on
path-safety violations, 404 on missing files.

### Live updates via `src/server/events.ts`

Reuse the existing watcher. On any create / delete / rename event inside the
working directory, re-run `listTree` with the currently active `hideIgnored`
flag and emit a new SSE message:

```ts
type TreeUpdatedEvent = { type: 'tree-updated'; entries: FsEntry[] };
```

The server tracks the `hideIgnored` flag per connected client (sent as a query
parameter when the client subscribes or sent via a new control message — the
simpler choice is a query parameter on the initial SSE connect, bumped by
reopening the stream when the user toggles the setting).

**Decision:** re-send the full entry list rather than a delta. The JSON is
small even for repos with `node_modules` hidden; delta reconciliation would
add bugs without meaningful payload savings. This matches how the Changes
view already re-sends full status on updates.

### Path safety tests

- Reject `../etc/passwd`
- Reject absolute paths (`/etc/passwd`, `C:\\...`)
- Reject symlinks pointing outside the repo root
- Accept normal nested paths (`src/web/app.tsx`)

## Shared types

Add to `src/shared/types.ts`:

```ts
export type FsEntry = { path: string; isDir: boolean; size?: number };
export type FileContents =
  | { kind: 'text'; content: string }
  | { kind: 'image'; mime: string; base64: string }
  | { kind: 'binary'; size: number }
  | { kind: 'tooLarge'; size: number };
```

The on-the-wire shape for images uses `base64` instead of `Uint8Array` to keep
JSON serialization clean. Server converts.

## Frontend

### New shared primitive: `src/web/lib/tree.ts`

Extract the path-to-tree logic currently inline in `file-tree.tsx`:

```ts
export interface TreeNode<T> {
  name: string;
  fullPath: string;
  isDir: boolean;
  children: TreeNode<T>[];
  data?: T;
}

export function buildTreeFromPaths<T extends { path: string }>(
  items: T[],
): TreeNode<T>;

export function flattenVisible<T>(
  node: TreeNode<T>,
  isExpanded: (dir: string) => boolean,
): Array<{ node: TreeNode<T>; depth: number }>;

export function collectAncestorDirs(paths: string[]): Set<string>;
export function collectAllDirs<T>(node: TreeNode<T>): string[];
```

Both `FileTree` (Changes) and `FileExplorer` consume this. The existing
WeakMap-based reference-identity cache in `file-tree.tsx` moves into
`tree.ts` and becomes generic.

**`file-tree.tsx` keeps** its change-count badges and
"default-expand-ancestors-of-changed-files" rule — both are Changes-specific.
It just loses the local `buildTreeUncached`, `flattenVisible`, and
`collectAllDirs` helpers, which move to `tree.ts`.

### New component: `src/web/components/file-explorer.tsx`

Structurally very similar to `FileTree`:

- Takes `entries: FsEntry[]`, `focusedPath: string | null`,
  `onFileClick: (path: string) => void`.
- Builds a tree via `buildTreeFromPaths(entries)`.
- Tracks expand/collapse overrides in a `Map<string, boolean>`, default
  collapsed (not "expand ancestors of changed files" — Explore has no
  "interesting" signal, so start collapsed and let the user expand).
- No change-count badges.
- No staged/unstaged/untracked coloring.
- Same keyboard-friendly row layout as `FileTree`, same Tailwind classes.

### `src/web/tabs/working-tree.tsx`

Above the tree, render the segmented toggle:

```tsx
<header className="flex items-center gap-1 border-b border-border px-2 py-1">
  <div role="tablist" className="flex rounded bg-surface-hover p-0.5">
    <button role="tab" aria-selected={mode === 'changes'} onClick={...}>
      Changes
    </button>
    <button role="tab" aria-selected={mode === 'explore'} onClick={...}>
      Explore
    </button>
  </div>
  <div className="ml-auto flex items-center gap-1">
    <button onClick={expandAll} title="Expand all">＋</button>
    <button onClick={collapseAll} title="Collapse all">−</button>
    {mode === 'explore' && (
      <button
        onClick={toggleHideIgnored}
        title={hideIgnored ? "Show ignored files" : "Hide ignored files"}
      >
        {/* text glyph matching existing ＋ / − header vocabulary, not emoji */}
        {hideIgnored ? '◐' : '◑'}
      </button>
    )}
  </div>
</header>
```

Below the header, conditionally render `<FileTree>` or `<FileExplorer>`.

### Store additions: `src/web/store.ts`

```ts
type Store = {
  // ...existing fields...
  workingTreeMode: 'changes' | 'explore';          // hydrated from settings
  hideIgnored: boolean;                             // hydrated from settings
  exploreEntries: FsEntry[];
  exploreFocusedPath: string | null;
  viewingFile:
    | { path: string; contents: FileContents }
    | null;
};

// Actions
setWorkingTreeMode(mode): void;      // persists to settings
setHideIgnored(value): void;         // persists to settings + reopens SSE with new flag
setExploreEntries(entries): void;    // called from SSE tree-updated handler
setExploreFocusedPath(path): void;
setViewingFile(payload): void;
clearViewingFile(): void;
```

### SSE client: `src/web/lib/sse-client.ts`

Add handling for `type: 'tree-updated'` messages; call
`store.setExploreEntries(entries)`. When `hideIgnored` flips, reopen the SSE
connection with the new query parameter.

### Click behavior in Explore mode

When the user clicks a row in `FileExplorer`:

1. If `entry.path` is present in the existing `status` changed-files set →
   dispatch the existing "focus a changed file" action. The diff pane shows
   the diff exactly as it does today. `exploreFocusedPath` is updated.
2. Otherwise → `GET /api/file?path=<entry.path>`, populate
   `viewingFile` in the store, clear the Changes-mode selection, and let the
   diff pane render in `fileViewMode`. `exploreFocusedPath` is updated.

### Selection sharing across modes (Q8 decision)

When the user toggles `workingTreeMode`:

```ts
function switchMode(next: 'changes' | 'explore') {
  if (next === 'changes') {
    // If current Explore selection exists in changed files, focus it there.
    // Otherwise, restore the last remembered Changes selection.
  } else {
    // If current Changes selection exists in the Explore entries, focus it.
    // Otherwise, restore the last remembered Explore selection.
  }
}
```

Each mode keeps its last selection in its own store field. Cross-mode handoff
only happens on the exact match.

### Filter input (`/`)

Existing filter wiring in `working-tree.tsx` gets a small switch: when in
Explore mode, apply `fuzzyFilter` to the `exploreEntries` list before building
the tree. Same keystroke, same fuzzy-matching logic, same dim-non-matches
rendering pattern.

## DiffView changes

Add one prop to `src/web/components/diff-view.tsx`:

```ts
type DiffViewProps = {
  // ...existing props...
  fileViewMode?: {
    path: string;
    contents: FileContents;
  };
};
```

When `fileViewMode` is set:
- Hide the `+/-` gutter columns; render text as plain Shiki-highlighted lines
  using the existing highlight pipeline.
- Reuse the existing large-file collapse affordance for
  `kind: 'tooLarge'` — show "file too large — click to load" exactly as diffs
  do today.
- For `kind: 'image'`, render a single image (object URL from base64 →
  `Blob`), not side-by-side.
- For `kind: 'binary'`, render the existing binary summary — filename, size,
  "open in editor" button.
- Header row shows just the path and a "read-only" badge; no "staged" /
  "unstaged" / "untracked" badges.

No other DiffView behavior changes. All existing props still work. When both
`fileViewMode` and the normal diff props are set, `fileViewMode` wins (but the
store should guarantee they're never both set at once).

## Shortcuts

`src/web/components/shortcuts.tsx` gets:

- **`e`** — new binding. When the Working Tree tab is focused, toggles
  `workingTreeMode`. No-op on other tabs.
- **`j` / `k`** — already delegate to `visibleFilePathsForTree` for Changes.
  Generalize that helper (or add a sibling) so it accepts the current mode's
  tree source. In Explore mode, `j/k` navigate the visible Explore tree;
  pressing Enter opens the focused file.
- **`/`, `u`, `p`, `?`** — unchanged.
- **Command palette** — add an "Explorer: toggle Changes / Explore" entry and
  a "Explorer: hide ignored files" toggle entry.

## Status bar

When `viewingFile` is set, `src/web/components/status-bar.tsx` shows:

```
viewing: <path> · <size> · read-only
```

When a normal diff is selected, the existing stats text is unchanged.

## Edge cases

- **Empty directories** — shown in the tree (matches VSCode).
- **Symlinks** — shown as entries, never followed.
- **Very large files** — server returns `{ kind: 'tooLarge', size }`; DiffView
  shows its existing affordance.
- **Binary files** — NUL-byte heuristic server-side; DiffView shows existing
  binary summary.
- **Images** — base64 bytes server-side, object URL client-side.
- **File deleted while being viewed** — SSE `tree-updated` drops it; if the
  `viewingFile.path` is no longer present, clear `viewingFile` and show an
  empty state in the diff pane.
- **Tree still loading on first Explore entry** — show a skeleton for ~300ms.
  Subsequent toggles are instant (cached in the store).
- **`hideIgnored` toggled** — reopen SSE with the new flag; the next
  `tree-updated` message replaces the tree.
- **Huge trees (hide-ignored off + repo with `node_modules`)** — out of scope
  for v1. Eager load is accepted. Revisit only if users hit real pain.

## Testing

### Backend unit tests (`test/tree.test.ts`)

- `listTree` with `hideIgnored: true` on a temp repo with ignored files —
  verifies gitignored paths are absent.
- `listTree` with `hideIgnored: false` on the same repo — verifies ignored
  paths are present.
- `listTree` never returns `.git/*`.
- `listTree` treats symlinks as entries without following.
- `readFile` path safety: rejects `..`, absolute paths, and symlinks escaping
  the repo root.
- `readFile` returns `tooLarge` above the size threshold.
- `readFile` returns `binary` for a fixture with a NUL byte in the first 8KB.
- `readFile` returns `image` for `.png` / `.jpg` fixtures.
- `readFile` returns `text` for normal text files.

### HTTP integration tests (extend `test/http.test.ts` or similar)

- `GET /api/tree?hideIgnored=1` returns expected entries.
- `GET /api/file?path=...` returns expected contents.
- Malformed query → 400.
- Path-safety violation → 403.
- Missing file → 404.

### Frontend unit tests (`src/web/lib/tree.test.ts`)

- `buildTreeFromPaths` on synthetic path lists: correct nesting, sorting,
  empty input, single-file input.
- `flattenVisible` with various expand sets.
- `collectAncestorDirs` on a flat list.

### Manual smoke (verification step)

- Toggle modes via `[ Changes | Explore ]` and via `e` shortcut.
- Click a changed file in Explore — confirm diff appears.
- Click an unchanged file in Explore — confirm content view.
- Click an image — confirm image renders.
- Click a binary — confirm binary summary.
- Click a large file — confirm "too large" affordance.
- Delete a file on disk — confirm tree updates live.
- Create a file on disk — confirm tree updates live.
- Toggle "hide ignored" — confirm tree rebuild and setting persists across
  reload.
- Confirm `workingTreeMode` persists across reload.
- Confirm `j` / `k` / `Enter` navigate and open files in Explore mode.
- Confirm Working Tree is the only tab affected.

## File-change inventory

**New:**
- `src/server/tree.ts`
- `src/web/components/file-explorer.tsx`
- `src/web/lib/tree.ts`
- `test/tree.test.ts`
- `src/web/lib/tree.test.ts` (or co-located)

**Modified:**
- `src/shared/types.ts` — add `FsEntry`, `FileContents`.
- `src/server/http.ts` — add `/api/tree` and `/api/file` routes.
- `src/server/events.ts` — emit `tree-updated` on watcher events.
- `src/web/components/file-tree.tsx` — consume shared `buildTreeFromPaths` /
  `flattenVisible` / `collectAllDirs`; remove the inlined versions.
- `src/web/components/diff-view.tsx` — add `fileViewMode` prop and its
  rendering branches.
- `src/web/tabs/working-tree.tsx` — add segmented toggle, conditional tree
  render, filter mode switch.
- `src/web/store.ts` — add the new fields and actions.
- `src/web/settings.ts` — persist `workingTreeMode`, `hideIgnored`.
- `src/web/lib/sse-client.ts` — handle `tree-updated` messages; reopen on
  `hideIgnored` flip.
- `src/web/components/shortcuts.tsx` — add `e` binding and generalize
  `j` / `k` source.
- `src/web/components/command-palette.tsx` — add Explorer entries.
- `src/web/components/status-bar.tsx` — read-only "viewing" line.
- `README.md` — document Explore mode in the Features list.

## Risks and open questions

- **Eager load on huge trees.** Accepted risk per Q6; revisit if real users
  complain. Mitigation: `hideIgnored` defaults to `true`.
- **DiffView prop complexity.** Adding `fileViewMode` to an already rich
  component. Mitigation: keep it strictly additive; when `fileViewMode` is
  set, all other diff-rendering branches are bypassed at the top of the
  component.
- **Cache warmth of `buildTreeFromPaths`.** The existing WeakMap cache in
  `file-tree.tsx` depends on reference identity. Moving it to `tree.ts`
  preserves that. `exploreEntries` is re-created on every SSE `tree-updated`
  message, so the cache misses on every update — **accepted for v1**: rebuild
  cost for the ~1000s of entries a typical hide-ignored repo has is
  negligible. Only revisit if profiling shows real cost.
- **Watcher noise.** Live updates on a repo with `hideIgnored: false` may fire
  constantly during `bun install`. Accepted — matches the "live microscope"
  identity. Debounce is already handled upstream.

## Out of scope

- Lazy / per-directory tree loading.
- File editing, rename, delete.
- Multi-select.
- Drag-and-drop.
- "Open in editor" for unchanged files (the existing `open-in-editor` button
  still works when a file is `viewingFile`, since the path is known — but no
  new affordances are added beyond that).
- Global filesystem navigation outside the repo root.
