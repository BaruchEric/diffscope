# diffscope

A local, read-only, live git diff viewer — point it at any repo on your machine and watch staged, unstaged, and untracked changes stream into your browser as you edit, stage, and commit.

## TL;DR

- **What:** A `diffscope` CLI that opens a browser-based viewer for a local git repo's working tree, history, branches, and stashes. The diff UI is read-only; an opt-in integrated terminal adds a real shell.
- **How:** A Bun HTTP server scrapes git via subprocess, serves a prebuilt React SPA, pushes live updates over Server-Sent Events (driven by a filesystem watcher), and backs the terminal drawer with a real PTY over WebSocket.
- **Stack:** Bun (server + runtime) · React 19 + Zustand + Shiki + xterm.js (web) · Vite 8 + Tailwind 3 + oxlint (tooling) · `node-pty` + `@parcel/watcher` (native helpers).
- **Run it:** `bun add -g diffscope` then `diffscope` (in any repo), or `diffscope /path/to/repo`.
- **Deploy target:** None — it's a locally-run developer CLI distributed via the package registry, not a hosted service.

## Overview

diffscope is a "microscope for your working tree." Instead of `git diff` in a terminal, you get a live browser view that updates the moment files change, get staged, committed, checked out, or stashed.

It opens to four tabs:

- **Working Tree** — staged / unstaged / untracked groups, live-updated. An "Explore" mode shows the full repo tree (not just changed files); click any file to view its contents (Shiki-highlighted) or its diff if changed. A sticky "Hide ignored files" toggle persists across sessions.
- **History** — commit list with click-to-view full commit diffs.
- **Branches** — local + remote branches with the current-branch indicator and tip preview.
- **Stashes** — stash list with full diff view.

The **diff view** supports unified/split modes, large-file collapsing, side-by-side images, binary-file summaries, and per-line blame. An optional **integrated terminal** (VSCode-style bottom drawer, multiple tabs, real PTY) survives browser reloads and can run any shell command; its `+` dropdown pulls scripts from `package.json`, built-ins, and an optional `.diffscope/scripts.json`.

## Architecture

```
        diffscope CLI (bin/diffscope.ts → src/server/cli.ts)
                          │
                          ▼
            Bun HTTP server (src/server/http.ts)
   ┌──────────────────────┼───────────────────────────────┐
   │                      │                                │
git subprocess       SSE /api/stream                 WebSocket
(diff/log/branches/  ◄── fs watcher                  /api/terminal/ws
 stashes/blame/tree) (@parcel/watcher)               ◄── PTY (node-pty)
   │                      │                                │
   └──────────────► serves prebuilt SPA ◄──────────────────┘
                    (dist/web, built by Vite)
                          │
                          ▼
            React 19 SPA in the browser
       (Zustand state, Shiki highlight, xterm.js terminal)
```

- **Server** (`src/server/`) — `cli.ts` resolves the repo root (or falls back to the picker), picks a port, and starts `http.ts`. `http.ts` is a single `Bun.serve` instance routing the JSON API, the SSE stream, the terminal WebSocket, and static SPA assets. `repo.ts` / `git.ts` / `parser.ts` wrap git; `watcher.ts` + `events.ts` drive live updates; `blame.ts`, `tree.ts`, `recents.ts` add blame, file-tree, and recent-repo features; `terminal/` hosts the PTY.
- **Web** (`src/web/`) — React app (`app.tsx`, tabs in `tabs/`, components in `components/`), Zustand stores, an SSE client (`lib/sse-client.ts`), Shiki highlighting, and the xterm.js terminal drawer.
- **Shared** (`src/shared/`) — types and the terminal wire protocol shared between server and web.

**API surface** (`/api/*`): `status`, `diff`, `log`, `commit/:hash`, `branches`, `stashes`, `blame`, `blob`, `file`, `tree`, `browse`, `recents`, `settings`, `info`, `open`, plus the SSE `stream` and the `terminal/ws` WebSocket.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime / server | Bun (`Bun.serve`), git via subprocess |
| Live updates | Server-Sent Events backed by `@parcel/watcher` |
| Terminal | `node-pty` over WebSocket, `@xterm/xterm` (+ fit / web-links addons) |
| Frontend | React 19, React DOM, Zustand, Shiki (syntax highlight) |
| Build / tooling | Vite 8, Tailwind CSS 3, PostCSS / Autoprefixer, oxlint, TypeScript 5 |
| Tests | `bun test` |

## Getting Started

### Requirements

- [Bun](https://bun.sh) ≥ 1.2
- `git` on your `PATH`

### Install

```bash
bun add -g diffscope     # or: npm install -g diffscope
```

A `postinstall` step (`scripts/postinstall-node-pty.sh`) sets up the native `node-pty` helper used by the terminal.

### From source

```bash
git clone https://github.com/BaruchEric/diffscope.git
cd diffscope
bun install
bun run build:web        # builds the SPA into dist/web
bun link                 # registers the `diffscope` command globally
```

### Run

```bash
diffscope                  # open the enclosing repo of the current directory
diffscope /path/to/repo    # open an explicit repo
diffscope --help           # usage
diffscope --version        # version
```

If the target isn't inside a git repo, diffscope opens a picker UI that lists recent repos and lets you browse the filesystem to pick one. It tries port **4111** first (so browser localStorage settings persist across runs) and falls back to a random free port if that's taken.

### Environment variables

| Variable | Effect |
|----------|--------|
| `DIFFSCOPE_DEV_PORT` | Pin a fixed backend port (default `4111`). Used in dev so the Vite proxy target stays stable. |

Machine-global settings persist to `~/.config/diffscope/settings.json`.

## Scripts

| Script | Command | What it does |
|--------|---------|--------------|
| `dev` | runs `dev:server` (port 41111) + `dev:web` together | Full dev environment |
| `dev:server` | `bun run --hot src/server/cli.ts` | Hot-reloading backend |
| `dev:web` | `vite` | Vite dev server with HMR (proxies `/api` → `:41111`) |
| `build:web` | `vite build` | Build the SPA into `dist/web` |
| `start` | `bun run src/server/cli.ts` | Run the server directly |
| `test` | `bun test` | Run the test suite |
| `typecheck` | `tsc --noEmit` (root + `tsconfig.web.json`) | Type-check server and web |
| `lint` | `oxlint` | Lint |

### Development

```bash
# Terminal 1 — backend on the fixed dev port (matches the Vite proxy target)
DIFFSCOPE_DEV_PORT=41111 bun run --hot src/server/cli.ts /path/to/test-repo

# Terminal 2 — Vite dev server with HMR (proxies /api → 41111)
bun run dev:web
```

Open <http://localhost:5173> for the live-reloading frontend.

## Custom terminal scripts

Add a `.diffscope/scripts.json` to any repo to extend the terminal's `+` dropdown:

```json
{
  "scripts": [
    { "name": "dev + watcher", "command": "bun run dev & bun run watch" },
    { "name": "lint staged", "command": "bunx lint-staged" }
  ]
}
```

User scripts override `package.json` scripts and built-ins on name collisions.

## Keyboard shortcuts

`j`/`k` move between files · `Tab` between tabs · `u` unified/split · `t` flat/tree · `e` Changes/Explore · `/` filter · `p` pause · `` Ctrl/Cmd+` `` toggle terminal · `?` help.

## Scope & safety

- **The viewer is read-only.** The diff / history / branches / stashes UI never stages, commits, or performs destructive actions.
- **The integrated terminal is a real shell.** Anything you can run in your terminal you can run in diffscope's terminal drawer, including destructive commands. This is an explicit opt-in — a one-time notice shows on first use. To keep diffscope purely observational, don't open the terminal.
- Works on any local git repo; runs entirely on your machine.

## Testing

```bash
bun test
```

The suite (under `test/`) covers diff/parser fixtures, the git repo subprocess wrappers, the file/tree HTTP endpoints, the filesystem-watcher event stream, blame, editor-URL building, fuzzy matching, settings migration, and the terminal module.

## Status

Version `0.1.0` (early but functional). MIT licensed. The web client must be built (`bun run build:web`) before the global CLI can serve it — `prepublishOnly` handles this for published packages, and `bun link` from source requires running it manually first. This is a local developer tool with **no hosted deployment**.
