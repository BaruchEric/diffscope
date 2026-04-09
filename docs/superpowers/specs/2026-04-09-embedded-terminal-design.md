# Embedded Terminal (VSCode-style) — Design

**Status:** Draft
**Date:** 2026-04-09
**Scope:** A single sub-project. Three related ideas — a standalone TUI frontend, expanded non-interactive CLI subcommands, and a free-form command-bar — are explicitly out of scope and will get their own specs later.

## 1. Problem and goals

diffscope is currently a browser-only read-only git diff viewer. Working in a repo almost always involves running commands alongside reading diffs: `bun run dev`, `bun test`, `git status`, ad-hoc shell exploration. Today users have to leave diffscope for that, which fragments focus and makes diffscope feel like a passive observer rather than part of the dev loop.

**Goal:** give diffscope a real, VSCode-style integrated terminal — a resizable bottom drawer with multiple terminal tabs, backed by a full PTY so `vim`, `htop`, `lazygit`, and any TUI app work the way they do in VSCode — plus a discoverable dropdown of predefined scripts merged from `package.json`, a small hardcoded built-in set, and an optional per-repo user config file.

**Non-goals**
- Standalone TUI alternative to the web frontend.
- Non-interactive CLI subcommands (`diffscope status`, `diffscope diff`, …).
- Free-form command-bar parser inside the existing command palette.
- Windows support (diffscope already excludes it).
- Remote / multi-machine terminals.
- Sessions that survive backend restarts.

**Explicit trade-off:** the README's "read-only, no destructive actions" guarantee applies to the *viewer*. The terminal drawer is a real shell and can run anything the user's account can run. A one-time inline notice makes this change honest to users who came in expecting the read-only promise.

## 2. Summary of design decisions

| # | Decision |
|---|---|
| 1 | Bottom drawer, resizable, with a tab strip — multiple terminals per session. |
| 2 | Real PTY via `node-pty`. An install-time spike is the first step of the implementation plan; if `node-pty` can't build under Bun on macOS + Linux, we stop and redesign rather than falling back. |
| 3 | Session lifecycle: persist across browser reloads (via an attach+replay protocol and a scrollback buffer on the server), die with the diffscope backend process. |
| 4 | Predefined scripts: merge built-ins ∪ `package.json` scripts ∪ `.diffscope/scripts.json`, user config wins on name collision. |
| 5 | Scripts surface as a dropdown on the `+` button in the tab strip. |
| 6 | Exited processes keep their tab visible with an "exited" marker until the user closes it. |
| 7 | Scrollback cap: 1 MiB per session, ring-buffered. |
| 8 | Transport: one dedicated WebSocket at `/api/terminal/ws`, not the existing SSE channel. |
| 9 | Default shell: `$SHELL -l` (login shell), falls back to `/bin/zsh`. |
| 10 | Session IDs: `crypto.randomUUID()` — no new dependency. |
| 11 | First-time opening the drawer shows a dismissable inline notice that the read-only guarantee doesn't apply to this pane. |

## 3. Architecture

A new `terminal` subsystem added on both sides of the app, wiring a real PTY on the backend to `xterm.js` on the frontend over a WebSocket, slotted into the existing layout as a resizable bottom drawer.

### 3.1 Backend (`src/server/terminal/`)

- **`pty.ts`** — wraps `node-pty` spawns, owns a `Map<terminalId, PtySession>`, handles write / resize / kill, keeps a rolling scrollback buffer per session for replay.
- **`ws.ts`** — WebSocket handler mounted on the existing HTTP server. One multiplexed connection per browser tab, framed as `{op, termId, payload}` JSON (binary PTY output gets base64-encoded in `data` frames; if that proves hot we can switch to binary frames later).
- **`scripts.ts`** — resolves the merged predefined-script list on demand.
- **`http.ts`** (modified) — registers the WebSocket route and a `GET /api/terminal/scripts` endpoint for the dropdown.

### 3.2 Frontend (`src/web/terminal/`)

- **`terminal-drawer.tsx`** — the bottom drawer container, resizable via the existing `pane-split` primitive, toggled by a keybinding and a status-bar button.
- **`terminal-tab-strip.tsx`** — the tab row inside the drawer: tabs, `+` dropdown, close buttons.
- **`terminal-pane.tsx`** — one `xterm.js` instance per terminal, bound to a single `termId`. Kept mounted even when its tab isn't active (hidden via `display: none`) so live output continues to stream to its scrollback.
- **`use-terminal-ws.ts`** — singleton WebSocket client hook, routes frames to the correct terminal pane, handles reconnect + replay.
- **`terminal-store.ts`** — zustand slice holding `{ terminals, activeId, drawerOpen, drawerHeight }`, persisted via the existing settings pattern.

### 3.3 Layout integration

The main content area (file list + diff view) gets wrapped in a vertical split: top = current content, bottom = `<TerminalDrawer />`. The existing `src/web/components/pane-split.tsx` primitive handles the resize handle with `direction="vertical"`. When the drawer is closed it collapses to zero height and a small terminal-count badge appears at the right end of the status bar.

### 3.4 Folder layout rationale

`src/server/terminal/` and `src/web/terminal/` group everything terminal-related into clearly bounded units. The server module exports its public surface through an `index.ts` so `http.ts` only needs a single import line, matching how the other server modules are wired today.

## 4. Backend: PTY lifecycle and session state

### 4.1 PtySession shape

```ts
type PtySession = {
  id: string;                          // crypto.randomUUID()
  title: string;                       // "bun dev" | "zsh" | ...
  scriptName?: string;                 // set if spawned from a predefined script
  proc: IPty;                          // node-pty handle
  cwd: string;                         // repo root
  cols: number;
  rows: number;
  scrollback: RingBuffer<Uint8Array>;  // ~1 MiB cap
  createdAt: number;
  exitCode: number | null;
  subscribers: Set<WSClient>;
};
```

### 4.2 Protocol (WebSocket frames)

All frames are JSON, shape `{op, ...}`:

| Direction | `op` | Payload fields | Meaning |
|---|---|---|---|
| client → server | `attach` | `ids: string[]` | On connect: reattach known session IDs. Server responds with `replay` for each live id and `gone` for each unknown one. |
| client → server | `spawn` | `kind: "shell" \| "script"`, `scriptName?`, `cols`, `rows` | Start a new PTY. Server responds with `spawned`. |
| client → server | `data` | `id`, `payload: string` (base64) | User keystrokes. Piped straight to `pty.write`. |
| client → server | `resize` | `id`, `cols`, `rows` | Forwards to `pty.resize`. |
| client → server | `kill` | `id` | `SIGHUP`, then `SIGKILL` after 1s. |
| client → server | `close` | `id` | Free the session. Equivalent to `kill` if still running. |
| server → client | `spawned` | `id`, `title` | Spawn acknowledged. |
| server → client | `replay` | `id`, `data: string` (base64) | Scrollback dump on attach. |
| server → client | `data` | `id`, `payload: string` (base64) | Live PTY output. |
| server → client | `exit` | `id`, `code` | Process exited. Session stays in the map for scrollback replay until `close`. |
| server → client | `gone` | `id` | Attach failed — client should drop it. |

### 4.3 Spawn flow

1. Client sends `{op: "spawn", kind, scriptName?, cols, rows}`.
2. Server resolves the command:
   - `shell` → `process.env.SHELL || "/bin/zsh"`, args `["-l"]`.
   - `script` → looks up `scriptName` in the merged script list from `scripts.ts`.
3. `node-pty.spawn(cmd, args, { cwd: repoRoot, cols, rows, env: {...process.env, TERM: "xterm-256color"} })`.
4. Assigns an id, stores the `PtySession`, pipes `pty.onData` to all subscribers, wires `pty.onExit` to emit an `exit` frame and set `exitCode`.
5. Replies with `{op: "spawned", id, title}`.

### 4.4 Attach flow (reconnect / browser reload)

1. Client sends `{op: "attach", ids}` with the IDs from `localStorage`.
2. For each known id: server sends `{op: "replay", id, data}` with the concatenated scrollback, then adds the client to that session's `subscribers` so live data resumes seamlessly.
3. For each unknown id: server sends `{op: "gone", id}`; client drops it from the store.

### 4.5 Scrollback

Ring-buffer implementation capped at 1 MiB per session, discarding oldest chunks. The cap lives at the top of `pty.ts` as a constant. Rationale for 1 MiB: enough for several screens of scrollback on long-running `bun dev` / `bun test` output, while keeping worst-case memory bounded at `N_terminals × 1 MiB`.

### 4.6 Shutdown

On normal diffscope shutdown, iterate sessions and send `SIGHUP` to each. `kill -9` of the diffscope process reparents children to init — this is accepted and not mitigated.

### 4.7 Safety notice

On startup, if the terminal subsystem initializes successfully, log:
`terminal: enabled (read-only guarantee suspended for terminal sessions)`
This makes the change visible in the same place users watch for other backend startup signals.

## 5. Frontend: state, wiring, and replay

### 5.1 Zustand slice (`terminal-store.ts`)

```ts
type TerminalMeta = {
  id: string;
  title: string;
  scriptName?: string;
  status: "running" | "exited";
  exitCode?: number;
};

type TerminalSlice = {
  terminals: TerminalMeta[];
  activeId: string | null;
  drawerOpen: boolean;
  drawerHeight: number;
  openDrawer(): void;
  closeDrawer(): void;
  toggleDrawer(): void;
  setActive(id: string): void;
  addTerminal(meta: TerminalMeta): void;
  removeTerminal(id: string): void;
  updateTerminal(id: string, patch: Partial<TerminalMeta>): void;
};
```

**Persisted** (via the existing settings pattern): `terminals[].id`, `terminals[].title`, `terminals[].scriptName`, `activeId`, `drawerOpen`, `drawerHeight`.
**Not persisted** (server-owned, re-derived on attach): `status`, `exitCode`.

### 5.2 `use-terminal-ws.ts`

- Opens a single WebSocket to `/api/terminal/ws` on first mount of the drawer.
- On open, immediately sends `{op: "attach", ids: store.terminals.map(t => t.id)}`.
- Dispatches incoming frames to per-`termId` handlers registered by `terminal-pane.tsx`.
- Reconnect: exponential backoff 250 ms → 4 s cap; on reconnect, re-attach all known IDs.

### 5.3 `terminal-pane.tsx`

- Owns a single `Terminal` instance from `@xterm/xterm` with `FitAddon` and `WebLinksAddon`.
- Mounted once per `termId`; survives tab switches by rendering hidden (`display: none`) rather than unmounting, so its xterm keeps consuming incoming frames.
- On mount:
  - If the id is brand-new (just created via the `+` dropdown), sends `{op: "spawn", kind, scriptName?, cols, rows}`.
  - If the id already existed in the store (it was persisted across a reload), relies on the attach/replay flow the WS hook already ran.
- On `xterm.onData` (user keystrokes) → sends `{op: "data", id, payload}`.
- On container resize via `ResizeObserver` → `fit()` → sends `{op: "resize", id, cols, rows}`.
- On unmount (tab closed) → `store.removeTerminal(id)` → WS hook sends `{op: "close", id}`.

### 5.4 `terminal-tab-strip.tsx`

Tab row: title, small spinner when `status === "running"`, dim/strikethrough when `exited`, `×` to close. The `+` button is a dropdown that fetches `/api/terminal/scripts` (cached for the current drawer session, refetched on each drawer open) and renders:

```
New shell
─────────────────────
package.json scripts
  dev         bun run dev
  dev:server  bun run --hot src/server/cli.ts
  dev:web     vite
  test        bun test
  typecheck   tsc --noEmit && tsc --noEmit -p tsconfig.web.json
  lint        oxlint
─────────────────────
Built-ins
  git status
  git log --oneline -20
  git diff --stat
  git fetch --all --prune
─────────────────────
User scripts                (only if .diffscope/scripts.json exists)
  ...
```

Selecting an entry calls `spawn`, opens the drawer if closed, and switches to the new tab.

### 5.5 `terminal-drawer.tsx`

- Wraps contents in the existing resizable pane primitive with a top drag handle.
- When `drawerOpen === false`, renders nothing in the layout slot (content area reclaims the space). A small terminal-count badge appears at the right end of the status bar, hidden when the count is 0.
- First-time opening shows the dismissable safety banner above the tab strip.

### 5.6 Command palette integration (minimal)

The existing command palette gets one new command: `Terminal: Toggle Drawer`. The bigger "run free-form commands from the palette" idea belongs to a separate later spec and is out of scope here.

## 6. Predefined scripts: resolution and merge order

### 6.1 Source (`src/server/terminal/scripts.ts`)

```ts
type ScriptEntry = {
  name: string;
  command: string;
  group: "package" | "builtin" | "user";
  cwd?: string;
};

async function resolveScripts(repoRoot: string): Promise<ScriptEntry[]>;
```

Called on demand by `GET /api/terminal/scripts`. Not cached on the server — it's cheap (one file read + a small constant list) and we want edits to `package.json` / `.diffscope/scripts.json` to be picked up without restarting diffscope.

### 6.2 Merge order (lowest → highest precedence)

1. **Built-ins** — hardcoded:
   - `git status`
   - `git log --oneline -20`
   - `git diff --stat`
   - `git fetch --all --prune`
2. **package.json scripts** — read `package.json` at repo root; each entry becomes `{name, command: "bun run <name>", group: "package"}`. Missing `package.json` → silently skip.
3. **User config** — read `.diffscope/scripts.json` if present:
   ```json
   {
     "scripts": [
       { "name": "Open dev + watcher", "command": "bun run dev & bun run watch" },
       { "name": "Lint staged",         "command": "bunx lint-staged" }
     ]
   }
   ```

Later sources **override** earlier ones on name collision. The overridden entry is dropped entirely.

### 6.3 Presentation

The dropdown groups entries back by `group` with section headers, but the resolved command is what runs. This gives predictable "what does this button do" semantics.

### 6.4 Error handling

- Malformed `package.json` or `.diffscope/scripts.json` → log a warning, return the rest of the merged list, surface a small inline notice at the top of the dropdown: `⚠ .diffscope/scripts.json: parse error (line 4)`. The dropdown still works — the user can always open a shell.
- Script with empty `name` or `command` → skipped and logged.
- The resolver never executes anything; it only lists.

### 6.5 Hot-reload

Not implemented. Clients refetch on each `+` dropdown open.

## 7. Keybindings and UX details

### 7.1 Keybindings

Registered through the existing `shortcuts.tsx` priority chain and added to the `?` help overlay.

| Key | Action | Scope |
|---|---|---|
| `` Ctrl+` `` / `` Cmd+` `` | Toggle terminal drawer | global |
| `` Ctrl+Shift+` `` / `` Cmd+Shift+` `` | New shell terminal (opens drawer, spawns `$SHELL`) | global |
| `Ctrl+Tab` / `Ctrl+Shift+Tab` | Next / previous terminal tab | when drawer focused |
| `Ctrl+Shift+W` | Close active terminal tab | when drawer focused |

### 7.2 Focus model

Opening the drawer focuses the active terminal pane. Clicking in the main content area returns focus to the main content. The terminal never steals keystrokes unless it has focus, so existing file-level shortcuts (`j`/`k`/`u`/`/`) keep working elsewhere.

### 7.3 Drawer defaults

`drawerOpen` defaults to `false`. `drawerHeight` defaults to `280px`. Both persist.

### 7.4 Status bar badge

A small badge at the right end of the existing status bar: terminal icon + count of running terminals. Click to toggle the drawer. Hidden when count is 0 and drawer is closed.

### 7.5 First-time safety notice

Rendered as a dismissable banner at the top of the drawer the first time it opens:

> **Heads up:** Terminals in diffscope run real shell commands. The read-only guarantee in the README applies to the viewer, not this pane. *\[Got it]*

Persisted via settings key `terminalNoticeAcknowledged: boolean`.

### 7.6 Theming

The xterm.js theme object is derived from the existing theme CSS variables and re-applied on theme change (subscribe to the existing theme store). Monospace font inherits from settings' `monoFont`.

## 8. Dependencies and bundle impact

### 8.1 New runtime dependencies

- `node-pty` — native PTY backend.
- `@xterm/xterm` — terminal emulator.
- `@xterm/addon-fit` — resize helper.
- `@xterm/addon-web-links` — clickable links in output.

No new dev dependencies. No `nanoid` — `crypto.randomUUID()` is used for session IDs.

### 8.2 Bundle impact

`@xterm/xterm` + addons are ~200 KB gzipped. Mitigation: dynamic-import the entire `src/web/terminal/` entry point only when the drawer is first opened, so users who never touch the terminal don't pay for it.

## 9. Risks and mitigations

### 9.1 `node-pty` under Bun (highest risk)

`node-pty` compiles native code at install time. Three scenarios:
1. Build fails on install — blocks the feature entirely.
2. Builds locally but fails on a user's machine with older Xcode / missing headers — works for us, breaks users.
3. Builds cleanly everywhere — fine.

**Mitigation:** the implementation plan's first step is a 30-minute spike: fresh environment, `bun add node-pty`, import and spawn a shell, write + read. If the spike fails we stop and redesign rather than partial-building the feature. No fallback to a pipe-based backend — we already committed to a real PTY.

### 9.2 Zombie processes on `kill -9`

`node-pty` children may outlive a hard-killed diffscope process. Mitigation: `SIGHUP` all sessions on normal shutdown. `kill -9` is accepted as untestable — the OS reparents to init.

### 9.3 Memory under many terminals

1 MiB × N terminals. Mitigation: log a warning when `N > 10`, but no hard cap.

### 9.4 WebSocket inside the existing HTTP server

`src/server/http.ts` is a Bun `serve()` with route-style handlers. Bun supports `websocket:` on the same server — no new port, no proxy reconfiguration in dev (Vite can proxy WebSockets to the existing port). If `http.ts`'s current shape makes the WS route awkward, we'll refactor it minimally as part of this work.

## 10. Testing strategy

### 10.1 Unit / module tests (Bun test, `test/terminal/`)

- **`scripts.test.ts`** — merge order, collision resolution, missing `package.json`, malformed `.diffscope/scripts.json`, empty-name/empty-command dropping. Uses the existing `test/helpers/temp-repo.ts`.
- **`pty.test.ts`** — integration test against real `node-pty`: spawn `echo`, assert scrollback; spawn `cat`, write input, assert echoed output, kill; spawn shell, resize, run `stty size`, assert reflected dimensions; generate >1 MiB output, assert scrollback stays at cap and holds the tail; attach replay round-trip. Gated on `node-pty` loading successfully; if it fails to load in CI, these tests `skip` with a clear message.
- **`ws.test.ts`** — protocol only: start the HTTP server on an ephemeral port, connect a raw WebSocket client, exercise `spawn → data → resize → kill → exit`, `attach` round-trip with replay, `close` for running vs exited sessions, `gone` for unknown ids.
- **`terminal-store.test.ts`** — plain zustand unit test for add/remove/setActive/toggleDrawer. No DOM.

### 10.2 No frontend component tests

Matches existing repo convention (tests are server-side). Xterm.js rendering is not something we need to cover.

### 10.3 Manual verification plan

Documented here so we can run it at the end of implementation:

1. Open diffscope on a repo, hit `` Cmd+` `` → drawer opens with a fresh shell → `pwd` returns repo root.
2. `+ → dev` → new tab runs `bun run dev`, output streams live.
3. Resize drawer via the drag handle → `stty size` reflects the new dimensions.
4. Reload the browser tab → drawer reopens, both tabs reattach, scrollback replays, `bun run dev` is still running.
5. `Ctrl+C` the dev server → tab stays visible with an "exited" marker, scrollback still scrollable.
6. Close that tab via `×` → it disappears from the strip.
7. `vim README.md` in a shell tab → full-screen editor draws correctly, arrow keys work, `:q` returns cleanly. (Real PTY smoke test.)
8. Switch themes → terminal colors update to match.
9. Quit diffscope (`Ctrl+C` in the launching terminal) → all child processes die, verified with `ps`.

## 11. Implementation order (high-level)

This isn't the plan — the plan comes from writing-plans — but these are the natural sequencing constraints:

1. **`node-pty` spike.** Blocks everything. If it fails we stop.
2. **Backend PTY layer** (`pty.ts`, tests).
3. **Scripts resolver** (`scripts.ts`, tests).
4. **WebSocket handler + HTTP wiring** (`ws.ts`, `http.ts`, tests).
5. **Frontend terminal store + WS hook.**
6. **`terminal-pane.tsx`** wired to a hardcoded test id — smoke test end-to-end.
7. **`terminal-drawer.tsx`** + layout integration in `app.tsx`.
8. **`terminal-tab-strip.tsx`** + `+` dropdown + `/api/terminal/scripts` fetch.
9. **Keybindings, status-bar badge, theming subscription, safety notice.**
10. **Manual verification plan (§10.3).**
11. **README update** noting the terminal feature and the read-only caveat.
