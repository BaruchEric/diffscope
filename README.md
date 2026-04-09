# diffscope

A local, read-only, live git diff viewer. Point it at any repo on your machine and watch changes stream in as they happen — a microscope for your working tree.

## Requirements

- [Bun](https://bun.sh) ≥ 1.2
- `git` on your PATH

## Install (from source)

```bash
git clone <this-repo> diffscope
cd diffscope
bun install
bun run build:web
```

## Run

```bash
bun run src/server/cli.ts                  # open the enclosing repo of CWD
bun run src/server/cli.ts /path/to/repo    # open an explicit repo
```

Once published, `bunx diffscope [path]` will work the same way.

If you point it at a directory that's not inside a git repo, the browser opens to a picker UI that lists recent repos and lets you browse the filesystem to find one.

## Features

- **Working Tree** — staged / unstaged / untracked groups, live-updated as you edit, stage, or commit
- **History** — commit list with click-to-view full commit diffs
- **Branches** — local + remote branches with current branch indicator and tip preview
- **Stashes** — list of stashes with full diff view
- **Diff view** — Shiki syntax highlighting, unified or split mode, large-file collapsing, image side-by-side, binary file summary
- **Live updates** — reacts to filesystem edits, `git add` / `git commit` / `git checkout` / `git stash`, and `.gitignore` changes
- **Keyboard shortcuts** — `j/k` between files, `Tab` between tabs, `u` toggle unified/split, `/` filter, `p` pause, `?` help

## Development

```bash
# Terminal 1 — backend, watching a scratch repo
bun run --hot src/server/cli.ts /path/to/test-repo

# Terminal 2 — Vite dev server with HMR (proxies /api → backend)
bun run dev:web
```

The Vite dev server lives on port 5173. Note: the proxy in `vite.config.ts` is hard-coded to `http://localhost:41111`, so set the backend's port accordingly during dev (or update the proxy target).

## Test

```bash
bun test
```

20 tests covering parser fixtures, repo subprocess wrappers, and watcher integration.

## Scope

- Read-only. No staging, committing, or destructive actions.
- Works on any local git repo.
- Live updates via filesystem watcher — file edits, staging, commits, branch checkouts, stashes, `.gitignore` changes.
