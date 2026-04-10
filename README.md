# diffscope

A local, read-only, live git diff viewer. Point it at any repo on your machine and watch changes stream in as they happen — a microscope for your working tree.

## Requirements

- [Bun](https://bun.sh) ≥ 1.2
- `git` on your PATH

## Install (from source)

```bash
git clone https://github.com/BaruchEric/diffscope.git
cd diffscope
bun install
bun run build:web
bun link            # registers the `diffscope` command globally
```

## Run

```bash
diffscope                  # open the enclosing repo of CWD
diffscope /path/to/repo    # open an explicit repo
diffscope --help           # usage
diffscope --version        # version
```

If you point it at a directory that's not inside a git repo, the browser opens to a picker UI that lists recent repos and lets you browse the filesystem to find one.

## Environment

| Variable             | Effect                                                  |
|----------------------|---------------------------------------------------------|
| `DIFFSCOPE_DEV_PORT` | Pin a fixed backend port (otherwise random free port).  |

## Features

- **Working Tree** — staged / unstaged / untracked groups, live-updated as you edit, stage, or commit
- **File explorer** — "Explore" mode in the Working Tree sidebar shows the full repo tree, not just changed files. Click any file to view its contents (syntax-highlighted via Shiki) or its diff if it's changed. Toggle with `e` or the segmented control. "Hide ignored files" toggle is sticky across sessions.
- **History** — commit list with click-to-view full commit diffs
- **Branches** — local + remote branches with current branch indicator and tip preview
- **Stashes** — list of stashes with full diff view
- **Diff view** — Shiki syntax highlighting, unified or split mode, large-file collapsing, image side-by-side, binary file summary
- **Integrated terminal** — VSCode-style bottom drawer with multiple tabs, backed by a real PTY. Run any shell command, `vim`, `htop`, dev servers, etc. Predefined scripts dropdown pulls from `package.json` scripts, built-ins, and an optional `.diffscope/scripts.json`. Toggle with `` Ctrl/Cmd+` ``. Terminals survive browser reloads.
- **Live updates** — reacts to filesystem edits, `git add` / `git commit` / `git checkout` / `git stash`, and `.gitignore` changes
- **Keyboard shortcuts** — `j/k` between files, `Tab` between tabs, `u` toggle unified/split, `t` flat/tree, `e` Changes/Explore, `/` filter, `p` pause, `` Ctrl/Cmd+` `` toggle terminal, `?` help

## Custom terminal scripts

Create `.diffscope/scripts.json` in your repo to add custom entries to the terminal's `+` dropdown:

```json
{
  "scripts": [
    { "name": "dev + watcher", "command": "bun run dev & bun run watch" },
    { "name": "lint staged", "command": "bunx lint-staged" }
  ]
}
```

User scripts override `package.json` scripts and built-ins if names collide.

## Development

```bash
# Terminal 1 — backend on a fixed port (matches the Vite proxy target)
DIFFSCOPE_DEV_PORT=41111 bun run --hot src/server/cli.ts /path/to/test-repo

# Terminal 2 — Vite dev server with HMR (proxies /api → 41111)
bun run dev:web
```

Open <http://localhost:5173> for the live-reloading frontend. The Vite proxy in `vite.config.ts` targets `http://localhost:41111`, so always start the backend with `DIFFSCOPE_DEV_PORT=41111` during dev.

## Test

```bash
bun test
```

20 tests covering parser fixtures, repo subprocess wrappers, and watcher integration.

## Scope

- **Viewer is read-only.** The diff / history / branches / stashes UI never stages, commits, or performs destructive actions.
- **The integrated terminal is a real shell.** Anything you can run in your terminal you can run in diffscope's terminal drawer, including destructive commands. This is an explicit opt-in: on first use, the drawer shows a one-time notice. If you want diffscope to stay purely observational, don't open the terminal.
- Works on any local git repo.
- Live updates via filesystem watcher — file edits, staging, commits, branch checkouts, stashes, `.gitignore` changes.
