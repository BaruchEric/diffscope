# diffscope — Design

**Status:** Draft
**Date:** 2026-04-08
**One-liner:** A local, read-only, live git diff viewer. Point it at any repo on your Mac and watch changes stream in as they happen.

## Goal

Build a browser-based diff viewer, launched via `bunx diffscope`, that:

1. Opens a git repo from a CLI arg, the current working directory, or a picker UI.
2. Shows the working tree (staged / unstaged / untracked), commit history, branches, and stashes.
3. Updates the UI live in response to filesystem and git events — edits, stages, commits, checkouts, rebases, `.gitignore` changes — within ~100ms.
4. Is read-only: no staging, committing, or destructive actions. Users keep using their existing git tools for those.

## Non-goals

- No write operations (stage, commit, checkout, discard). Upgradable later, but out of scope for v1.
- No multi-repo-in-one-window UX. Multiple repos = multiple `diffscope` processes.
- No packaged `.app` bundle. Web-only. Tauri wrap is a future consideration.
- No telemetry, crash reporting, or cloud sync.
- No custom ignore rules beyond what `.gitignore` already provides.

## User experience

### Launch

```bash
bunx diffscope                    # open the enclosing repo of CWD
bunx diffscope /path/to/repo      # open an explicit repo
bunx diffscope ~/code             # directory is not a repo → open the picker UI
```

Launch behavior:

1. If an explicit path is provided and contains a `.git` directory (or is inside one), open that repo.
2. Else, walk upward from CWD looking for `.git`. If found, open the enclosing repo.
3. Else, start the server with no repo loaded and open the browser to the picker UI.
4. Pick a free localhost port, start the Bun HTTP server, open the default browser to `http://localhost:<port>`.

### Picker UI

Shown when no repo is loaded. Two sections:

- **Recents** — clickable list of recently opened repo paths, loaded from `~/.diffscope/recents.json`. Entries that no longer exist on disk are shown grayed out with a "remove" affordance.
- **Open folder…** — a path input with a simple server-backed directory browser. The server exposes a read-only `GET /api/browse?path=...` that lists subdirectories of a given path (starting at `$HOME`). The UI is a column-style browser: click a directory to descend, a breadcrumb shows the current path, and an "Open this repo" button is enabled when the selected path contains a `.git` directory (or is inside one). After opening, diffscope walks upward to find the enclosing `.git`. Successful opens are added to recents. Typed paths are also accepted directly for power users.

Note: because this is a browser-based UI, we deliberately avoid `window.showDirectoryPicker()` — it returns a sandboxed handle, not a filesystem path, which the server cannot act on. The server-backed browser is simpler and more honest given that the server already has full filesystem access.

### Main view — layout

Top tabs: **Working Tree** · **History** · **Branches** · **Stashes**

Each tab is a two-pane view: file/commit list on the left, diff pane on the right.

- **Working Tree tab** — the "live" surface. Left pane groups files into **Staged**, **Unstaged**, **Untracked** subheadings with counts. Right pane shows the diff for the focused file.
- **History tab** — left pane is a scrollable commit list. Focused commit's diff renders on the right.
- **Branches tab** — left pane lists local and remote branches. Focused branch shows a summary (last commit, ahead/behind HEAD) and lets you view its tip commit diff.
- **Stashes tab** — left pane lists stashes. Focused stash shows its diff.

A small **"⏸ Live updates"** toggle sits in the header. When paused, SSE events are still received but UI updates are queued; when resumed, the latest snapshot is applied.

### Diff rendering

- **Syntax highlighting** via Shiki, loaded lazily per language.
- **Word-level intra-line highlighting** on changed lines.
- **Unified / Split toggle** at the top of the diff pane. Preference persisted to `localStorage`.
- **Large files** (>500KB or >5000 lines) collapsed by default with a "Large diff — click to expand" affordance.
- **Binary files** show `"Binary file changed (12KB → 18KB)"`.
- **Images** (`.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`, `.svg`) render as a side-by-side before/after thumbnail, with new-file and deleted-file states handled.
- **Virtualized file list** past 100 files. Only the currently focused file's diff is rendered in the diff pane.

### Theming

- Follow `prefers-color-scheme` by default, dark if no preference.
- Manual override in a small settings menu, stored in `localStorage`.

### Keyboard shortcuts

- `j` / `k` — move between files in the list
- `↓` / `↑` / `PageDown` / `PageUp` — scroll the diff pane
- `/` — focus the file-list filter input
- `Tab` / `Shift+Tab` — switch between top tabs
- `u` — toggle unified / split
- `?` — shortcut cheat sheet

## Architecture

One `bunx diffscope` invocation = one Bun process = at most one open repo.

The server can start in two states:

1. **Repo loaded** — repo path was resolved at launch (explicit arg, or walked upward from CWD). The watcher is attached immediately. This is the normal path.
2. **No repo loaded** — server starts with an empty state and serves only the picker UI + `/api/recents`, `/api/browse`, `/api/open`. When `POST /api/open` succeeds, the repo is loaded and the watcher attaches. Once loaded, the repo is fixed for the lifetime of the process. To switch repos, the process restarts itself (or the user opens a new tab from the picker, which launches a new process).

```
┌────────────────────────────────────────────────────────┐
│  bunx diffscope [repo-path]                             │
│         │                                               │
│         ▼                                               │
│  ┌─────────────────────────────────────────────────┐   │
│  │  Bun HTTP server (localhost:RANDOM_PORT)         │   │
│  │                                                   │   │
│  │  ┌────────────┐  ┌─────────────┐  ┌───────────┐ │   │
│  │  │ Git worker │  │ Fs watcher  │  │ SSE hub   │ │   │
│  │  │  (child    │  │ (@parcel/   │  │ (fans out │ │   │
│  │  │  process)  │  │  watcher)   │  │  events)  │ │   │
│  │  └─────┬──────┘  └──────┬──────┘  └─────┬─────┘ │   │
│  │        └────────┬───────┴────────────────┘       │   │
│  │                 ▼                                 │   │
│  │           REST + SSE endpoints                    │   │
│  └─────────────────────────────────────────────────┘   │
│                    │                                    │
│                    ▼                                    │
│  ┌─────────────────────────────────────────────────┐   │
│  │  React + Vite SPA (served as static files)      │   │
│  │  - Top tabs, file list, diff pane                │   │
│  │  - SSE client, Zustand store, Shiki, Tailwind    │   │
│  └─────────────────────────────────────────────────┘   │
└────────────────────────────────────────────────────────┘
```

### Approach: shell out to `git`

All git operations invoke the `git` binary via `child_process`, parsing stable plumbing output (`git status --porcelain=v2`, `git diff --patch`, `git log --format=…`). Rationale:

- The user already has `git` installed; no library dependency.
- Plumbing commands are designed to be parsed.
- Full fidelity for edge cases (submodules, LFS, worktrees) the real git handles.
- Parser lives in one file, tested against recorded fixtures.

Alternatives considered and rejected: `isomorphic-git` (slower on real repos, weaker edge cases, heavy dep); `simple-git` (wrapper quirks, lags real git's flags).

### Transport: SSE

Server-Sent Events, not WebSocket. All traffic is server→client push plus client-pulled REST; there is no client→server real-time channel. `EventSource` auto-reconnects natively; on reconnect the client refetches `/api/status` to rebuild fresh truth.

## Components

### Backend — `src/server/`

1. **`cli.ts`** — entry point. Parses argv, resolves the repo path (argv → walk up from CWD → picker flow), picks a free port, starts the server, opens the default browser.

2. **`repo.ts`** — one-shot repo operations. Wraps `git` subprocess calls and returns typed objects. Sole owner of git output parsing's caller surface. Exports:
   - `getStatus(): Promise<FileStatus[]>`
   - `getFileDiff(path, {staged}): Promise<ParsedDiff>`
   - `getLog({limit, offset}): Promise<Commit[]>`
   - `getCommit(sha): Promise<CommitDetail>`
   - `getBranches(): Promise<Branch[]>`
   - `getStashes(): Promise<Stash[]>`
   - `getRepoRoot(): Promise<string>` (used at launch to validate)

3. **`parser.ts`** — pure functions only. Turns raw `git` CLI text into typed objects. No I/O, no subprocess. Extensive unit tests live against recorded fixtures.

4. **`watcher.ts`** — wraps `@parcel/watcher`. Watches the working tree (`.gitignore`-aware) and `.git/`. Debounces events at 50ms, coalesces, and emits high-level events: `workingTreeChanged`, `indexChanged`, `headChanged`, `refsChanged`, `watcherDown`.

5. **`events.ts`** — SSE hub. On any watcher event, recomputes relevant state via `repo.ts`, diffs against the previous in-memory snapshot, and emits only deltas to connected clients. Sole owner of snapshot state.

6. **`http.ts`** — Bun HTTP server. Mounts REST routes, SSE route, and static SPA files via `Bun.serve`. No framework; ~10 routes.

### Frontend — `src/web/`

7. **`app.tsx`** — React root. Top-level tabs, connects to `/api/stream` once on mount, routes events into a Zustand store.

8. **`diff-view.tsx`** — diff renderer. Takes a parsed patch + unified/split toggle, renders with Shiki and word-level highlighting. Virtualized for huge files.

### Shared

- **`types.ts`** — shared TypeScript types imported from both server and client (`FileStatus`, `ParsedDiff`, `Commit`, `Branch`, `Stash`, `SseEvent`). Single source of truth for the wire format.

## Data flow

### Initial load

1. User runs `bunx diffscope`.
2. `cli.ts` resolves repo path, starts the server, opens the browser to `http://localhost:<port>`.
3. Browser requests `/` → server sends the built SPA HTML + assets.
4. SPA requests `GET /api/status` → server calls `repo.getStatus()` → returns `FileStatus[]`.
5. SPA opens `GET /api/stream` (SSE) — held open.
6. Focused file (if any) triggers `GET /api/diff?path=...&staged=...` → parsed patch.

### Live update (user saves a file)

1. OS emits fs event for `foo.ts`.
2. `watcher.ts` debounces 50ms, emits `workingTreeChanged { paths: ["foo.ts"] }`.
3. `events.ts` calls `repo.getStatus()` → new snapshot. Diffs against previous in-memory snapshot → changed entries.
4. For each changed file, calls `repo.getFileDiff(path)`.
5. Pushes `{type: "file-updated", path, status, diff}` over SSE.
6. Client's store applies the delta. React re-renders the affected file row; if that file is focused in the diff pane, the diff pane re-renders too.

### Live update (user runs `git commit` elsewhere)

1. `.git/HEAD` and `.git/refs/heads/...` change.
2. Watcher emits `headChanged` + `refsChanged`.
3. `events.ts` re-queries `getStatus()` (working tree empties) + `getLog({limit: 50})` (history tab) + `getBranches()`.
4. Pushes `{type: "head-changed", status, branches, newCommits}`.

### REST API

- `GET /api/status` — current `FileStatus[]` snapshot
- `GET /api/diff?path=...&staged=...` — parsed diff for a single file
- `GET /api/log?limit=50&offset=0` — commit page
- `GET /api/commit/:sha` — commit metadata + full diff
- `GET /api/branches` — branches
- `GET /api/stashes` — stashes
- `GET /api/stream` — SSE event stream
- `GET /api/recents` / `POST /api/recents` — manage recent repos list (no-repo-loaded state only)
- `GET /api/browse?path=...` — list subdirectories of a given path; used by the picker's folder browser (no-repo-loaded state only)
- `POST /api/open` — load a repo at a given path into this server instance (used by the picker)

### SSE event types

```ts
type SseEvent =
  | { type: "snapshot"; status: FileStatus[] }         // sent once on connect
  | { type: "file-updated"; path: string; status: FileStatus; diff?: ParsedDiff }
  | { type: "file-removed"; path: string }
  | { type: "head-changed"; headSha: string; status: FileStatus[]; branches: Branch[] }
  | { type: "refs-changed"; branches: Branch[] }
  | { type: "stashes-changed"; stashes: Stash[] }
  | { type: "watcher-down" }
  | { type: "watcher-up" }
  | { type: "repo-error"; reason: string }
  | { type: "warning"; message: string }
```

## Error handling

Four buckets, each with one clear policy.

**1. Repo-level failures.** At launch, `cli.ts` runs `git rev-parse --show-toplevel` before starting the server; on failure it falls through to the picker UI. At runtime, if git commands start reporting "not a git repository" (e.g., user deleted `.git`), the server emits `{type: "repo-error"}` and the UI shows a full-pane error card with "Re-open…".

**2. Git command failures.** Every `repo.ts` function wraps its subprocess in try/catch. On failure it logs stderr to the server console and throws a typed `GitError(code, stderr)`. REST handlers turn `GitError` into HTTP 500 with `{error: stderr}`. Watcher-triggered failures in `events.ts` emit `{type: "warning"}` and do not tear down the SSE stream.

**3. Watcher failures.** `watcher.ts` attaches an error handler that logs, emits `{type: "watcher-down"}`, and attempts to restart after 1s backoff for up to 3 tries. During downtime, the UI shows a "⚠ Live updates paused — reconnecting" pill. If retries exhaust, the pill becomes "⚠ Live updates off. Click to retry." REST endpoints continue working — the app degrades to a non-live viewer, still useful.

**4. Client-side failures.** `EventSource` reconnects natively. On reconnect the client refetches `/api/status` to rebuild state — we do not replay missed events. If the server is entirely gone, the reconnect loop backs off and the UI shows "Server disconnected. Restart `bunx diffscope` to continue."

Explicitly not doing: panic-on-first-failure, event replay protocols, custom `EventSource` retry logic, telemetry.

## Testing

Three layers, weighted by risk.

**Layer 1 — `parser.ts` unit tests (heavy).** Pure functions, no I/O. Fixtures for every case: `git status --porcelain=v2` with staged/unstaged/untracked/renamed/copied/submodule/conflict; `git diff` patches with adds/deletes/renames/binary/empty/no-newline-at-eof; `git log --format=...` output; filenames with spaces, quotes, unicode. Each fixture pinned to an expected typed object. Target: ~80% of testing effort.

**Layer 2 — `repo.ts` integration tests (spot).** Real git binary against a temp scratch repo. Helper creates a temp dir, `git init`, seeds known commits/files, cleans up. ~10 tests proving the subprocess layer wires up correctly. Does not re-cover parser edge cases.

**Layer 3 — `events.ts` watcher integration (a few scenarios).**

- Write to a file → `file-updated` event within 200ms
- Rapid 10x write to one file → exactly one coalesced event
- Edit `.gitignore` to ignore an existing untracked file → untracked list updates
- `git commit` in the temp repo → `head-changed` event fires
- Delete `.git/` → `repo-error` event fires, watcher does not crash the process

**Skipped for v1:** end-to-end browser tests, React snapshot tests, load/perf benchmarks. UI is a thin projection of server state; adding browser tests is worth it once interactivity (staging, committing) arrives.

**Tooling:** `bun test`, `node:fs/promises` `mkdtemp` for scratch repos. No test-only dependencies beyond what bun ships.

## Project layout

```
diffscope/
├── package.json
├── tsconfig.json
├── vite.config.ts
├── bin/
│   └── diffscope                    # shebang entry → src/server/cli.ts
├── src/
│   ├── server/
│   │   ├── cli.ts
│   │   ├── http.ts
│   │   ├── repo.ts
│   │   ├── parser.ts
│   │   ├── watcher.ts
│   │   └── events.ts
│   ├── web/
│   │   ├── app.tsx
│   │   ├── main.tsx                 # Vite entry
│   │   ├── tabs/
│   │   │   ├── working-tree.tsx
│   │   │   ├── history.tsx
│   │   │   ├── branches.tsx
│   │   │   └── stashes.tsx
│   │   ├── components/
│   │   │   ├── diff-view.tsx
│   │   │   ├── file-list.tsx
│   │   │   ├── picker.tsx
│   │   │   └── ...
│   │   └── store.ts                 # Zustand store + SSE wiring
│   └── shared/
│       └── types.ts
├── test/
│   ├── fixtures/
│   │   ├── status/
│   │   └── diff/
│   ├── parser.test.ts
│   ├── repo.test.ts
│   └── events.test.ts
└── docs/
    └── superpowers/
        └── specs/
            └── 2026-04-08-diffscope-design.md
```

## Dependencies

Runtime (server): `@parcel/watcher`.
Runtime (shared): none beyond Bun + React.
Frontend: `react`, `react-dom`, `zustand`, `shiki`, `tailwindcss`, `@radix-ui/*` via shadcn as needed.
Build: `vite`, `@vitejs/plugin-react`, TypeScript.
Dev/test: `bun test` built-in.

No other runtime dependencies. Specifically: no `simple-git`, no `isomorphic-git`, no `express`/`hono`, no `socket.io`.

## Open questions

None blocking. Possible v2 directions documented for later: interactive staging (Scope B), commit UI (Scope C), Tauri wrap for a real `.app`, multi-repo tabs.
