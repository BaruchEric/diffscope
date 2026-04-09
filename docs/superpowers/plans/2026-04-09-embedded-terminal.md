# Embedded Terminal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a VSCode-style integrated terminal drawer to diffscope — resizable bottom drawer, multi-tab, backed by a real `node-pty` PTY, with a dropdown of predefined scripts (built-ins + `package.json` + `.diffscope/scripts.json`) and sessions that survive browser reloads.

**Architecture:** A new `terminal` subsystem on both sides of the existing app. Backend (`src/server/terminal/`) owns a `Map<id, PtySession>` with rolling scrollback and streams I/O over a dedicated WebSocket at `/api/terminal/ws`. Frontend (`src/web/terminal/`) renders xterm.js in a drawer integrated via the existing `PaneSplit` primitive, with lazy-loaded xterm code so users who never open the terminal don't pay the bundle cost. The drawer toggle/height live in the existing settings store; terminal metadata lives in a new dedicated zustand store persisted to its own `localStorage` key.

**Tech Stack:** Bun, TypeScript, React 19, zustand, Vite, `node-pty`, `@xterm/xterm`, `@xterm/addon-fit`, `@xterm/addon-web-links`. Existing conventions: path aliases `@/` (web), `@shared/` (cross-boundary types), `bun test`, `oxlint`, `tsc --noEmit` for both `tsconfig.json` (server/test) and `tsconfig.web.json` (web).

**Spec:** `docs/superpowers/specs/2026-04-09-embedded-terminal-design.md`

> **Architectural pivot (applied during Task 1):** The Task 1 spike found that `node-pty@1.1.0` fails under Bun 1.2.17 with `ENXIO` on the PTY master read (Bun's I/O loop and `node-pty`'s internal read path disagree). It works perfectly under Node.js. **The workaround:** `pty.ts` does NOT import `node-pty` directly. Instead it spawns `src/server/terminal/pty-host.mjs` as a Node.js child process and drives it over a line-delimited JSON protocol on stdin/stdout. Everything upstream of `pty.ts` is unchanged — the `PtyRegistry` interface is identical. The only new runtime requirement is that `node` is on `PATH` (a reasonable assumption for a developer tool). See Task 5 for the updated implementation.
>
> **Also applied during Task 1:** Bun's install strips the execute bit from native helper binaries. `node-pty`'s `spawn-helper` needs `+x` or spawns fail with `posix_spawnp failed`. A `postinstall` script (`scripts/postinstall-node-pty.sh`) re-applies the bit after every `bun install`.

---

## File Structure Overview

### Backend (new)

| File | Responsibility |
|---|---|
| `src/server/terminal/pty.ts` | `PtySession` type, `PtyRegistry` owning `Map<id, PtySession>`, scrollback ring buffer, subscribers. Spawns and drives a Node.js helper child over stdin/stdout JSON. |
| `src/server/terminal/pty-host.mjs` | Node.js helper: imports `node-pty`, reads JSON commands from stdin, emits JSON events on stdout. Runs under `node`, not `bun`. |
| `src/server/terminal/scripts.ts` | Pure-ish script resolver: merges built-ins + `package.json` scripts + `.diffscope/scripts.json`. Returns `ScriptEntry[]`. |
| `src/server/terminal/ws.ts` | Bun `ServerWebSocket` handler: protocol framing, multiplexes many `termId`s over one connection, wires PTY data fan-out. |
| `src/server/terminal/index.ts` | Barrel that exports `createTerminalModule()` — a factory returning `{ registry, websocket, handleScriptsRequest, shutdown }` for `http.ts` to consume. |

### Backend (modified)

| File | Change |
|---|---|
| `src/server/http.ts` | Register WS upgrade for `/api/terminal/ws`, add `GET /api/terminal/scripts` route, wire `createTerminalModule()`, call its shutdown on stop. |

### Shared (new)

| File | Responsibility |
|---|---|
| `src/shared/terminal-protocol.ts` | `TerminalClientFrame` / `TerminalServerFrame` discriminated unions and `ScriptEntry` type. Consumed by both the server handler and the web client. |

### Frontend (new)

| File | Responsibility |
|---|---|
| `src/web/terminal/terminal-store.ts` | Tiny always-loaded zustand store: `{ terminals, activeId }` and actions. Persists `terminals[].{id,title,scriptName}` and `activeId` to `localStorage:diffscope:terminals:v1`. |
| `src/web/terminal/use-terminal-ws.ts` | Singleton WebSocket client hook — opens connection on first call, handles attach/replay/reconnect, exposes `send(frame)` and `subscribe(id, handler)`. |
| `src/web/terminal/terminal-pane.tsx` | Single xterm instance bound to one `termId`. Handles spawn-on-mount vs attach-replay branch, `onData` → send, `ResizeObserver` → resize. |
| `src/web/terminal/terminal-tab-strip.tsx` | Tab row + `+` button dropdown (fetches `/api/terminal/scripts`, groups by `package`/`builtin`/`user`). |
| `src/web/terminal/terminal-drawer.tsx` | Lazy-loaded drawer body: renders the tab strip, the active pane, and the safety notice. Everything xterm-related lives here or imports through here so Vite code-splits it. |
| `src/web/terminal/terminal-drawer-slot.tsx` | Always-loaded shell using `React.lazy` to import `terminal-drawer.tsx` only when `drawerOpen === true`. Also owns the resize handle via `usePaneDrag`. |
| `src/web/terminal/terminal-api.ts` | `fetch`-based wrapper for `GET /api/terminal/scripts`. |

### Frontend (modified)

| File | Change |
|---|---|
| `src/web/settings.ts` | Add `terminalDrawerOpen`, `terminalDrawerHeightPx`, `terminalNoticeAcknowledged` to `Settings`. |
| `src/web/components/layout.tsx` | Wrap `<main>`-area children in a vertical `PaneSplit` with the terminal drawer as the `b` pane when drawer is open. |
| `src/web/components/shortcuts.tsx` | Add `` Ctrl/Cmd+` `` (toggle drawer), `` Ctrl/Cmd+Shift+` `` (new shell), `Ctrl+Shift+W` (close active tab when drawer focused). Add rows to `SHORTCUT_HELP`. |
| `src/web/lib/actions.ts` | Add `terminal.toggle-drawer` palette action. |
| `src/web/components/status-bar.tsx` | Add terminal-count badge button at the right end. |
| `vite.config.ts` | Flip `/api` proxy to `ws: true`. |
| `README.md` | Add "Terminal" section and note the read-only caveat. |

### Tests (new)

| File | Covers |
|---|---|
| `test/terminal/scripts.test.ts` | Merge order, missing `package.json`, malformed user config, empty-entry drop. |
| `test/terminal/pty.test.ts` | Real `node-pty` spawn/write/resize/scrollback-cap/replay — skipped with clear message if native module fails to load. |
| `test/terminal/ws.test.ts` | Full frame protocol round-trip against an ephemeral Bun server. |
| `test/terminal/terminal-store.test.ts` | `addTerminal`/`removeTerminal`/`setActive` + persistence round-trip. |

### Config

| File | Change |
|---|---|
| `package.json` | Add `node-pty`, `@xterm/xterm`, `@xterm/addon-fit`, `@xterm/addon-web-links` to `dependencies`. |

---

## Task 0: Read the spec

- [ ] **Step 1: Read the design spec end-to-end**

Open `docs/superpowers/specs/2026-04-09-embedded-terminal-design.md` and read it front to back. Re-reading it during implementation is free insurance against drift.

Expected: you can answer, from memory, (1) what the 11 decisions are in §2, (2) the full WebSocket frame vocabulary in §4.2, (3) why `§9.1` makes Task 1 a hard gate.

---

## Task 1: `node-pty` under Bun spike (HARD GATE)

This task is explicitly a go/no-go. If it fails, stop and escalate — **do not fall back to a pipe-based backend.** The spec committed to a real PTY.

**Files:**
- Create: `scripts/spike-node-pty.ts`

- [ ] **Step 1: Add `node-pty` to dependencies**

Run: `bun add node-pty`
Expected: `package.json` gains `"node-pty": "^<version>"` under `dependencies`, `bun.lock` updates, native module builds without errors. If the native build fails, **stop** — capture the full build log, raise it, and wait for guidance.

- [ ] **Step 2: Write the spike script**

Create `scripts/spike-node-pty.ts`:

```ts
// scripts/spike-node-pty.ts
// Minimum viable proof that node-pty works under Bun on this OS.
// Spawn `echo hello` through a PTY, collect stdout, assert it contains
// "hello", exit cleanly. Run via `bun run scripts/spike-node-pty.ts`.
import * as pty from "node-pty";

const shell = process.env.SHELL || "/bin/sh";
const proc = pty.spawn(shell, ["-c", "echo hello"], {
  name: "xterm-256color",
  cols: 80,
  rows: 24,
  cwd: process.cwd(),
  env: { ...process.env, TERM: "xterm-256color" } as Record<string, string>,
});

let buf = "";
proc.onData((d) => {
  buf += d;
});

proc.onExit(({ exitCode, signal }) => {
  if (!buf.includes("hello")) {
    console.error(`FAIL: expected "hello" in output, got ${JSON.stringify(buf)}`);
    process.exit(1);
  }
  if (exitCode !== 0) {
    console.error(`FAIL: exitCode=${exitCode} signal=${signal}`);
    process.exit(1);
  }
  console.log("SPIKE OK");
  process.exit(0);
});
```

- [ ] **Step 3: Run the spike**

Run: `bun run scripts/spike-node-pty.ts`
Expected: exit code 0, prints `SPIKE OK`. If it fails with a native import error, ABI mismatch, or any runtime error — **stop**. Do not proceed to Task 2. Capture the error and escalate.

- [ ] **Step 4: Delete the spike script**

Once the spike passes, remove `scripts/spike-node-pty.ts` — it's served its purpose. The real tests in Task 5 will exercise node-pty in a permanent place.

Run: `rm scripts/spike-node-pty.ts`
Expected: file gone.

- [ ] **Step 5: Commit**

```bash
git add package.json bun.lock
git commit -m "chore: add node-pty dependency (verified under Bun)"
```

---

## Task 2: Install xterm.js and tsconfig adjustments

**Files:**
- Modify: `package.json` (via `bun add`)

- [ ] **Step 1: Install xterm.js packages**

Run: `bun add @xterm/xterm @xterm/addon-fit @xterm/addon-web-links`
Expected: `package.json` gains all three under `dependencies`, `bun.lock` updates, no build errors.

- [ ] **Step 2: Verify the package exports load in a dry-run**

Create a throwaway file `scripts/verify-xterm.ts`:

```ts
// scripts/verify-xterm.ts — throwaway: just checks imports resolve.
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";

console.log(typeof Terminal, typeof FitAddon, typeof WebLinksAddon);
```

Run: `bun run scripts/verify-xterm.ts`
Expected: prints `function function function`. (This is just an import sanity check — we're in Bun, not the browser, so we can't instantiate Terminal here, but resolving the module is enough.)

- [ ] **Step 3: Delete the verify script**

Run: `rm scripts/verify-xterm.ts`
Expected: file gone.

- [ ] **Step 4: Commit**

```bash
git add package.json bun.lock
git commit -m "chore: add xterm.js + fit + web-links addons"
```

---

## Task 3: Shared protocol types

**Files:**
- Create: `src/shared/terminal-protocol.ts`

- [ ] **Step 1: Create the protocol file**

```ts
// src/shared/terminal-protocol.ts
// Wire protocol for the terminal WebSocket at /api/terminal/ws.
// Both sides import from this file so frame shapes can't drift.

/** A single predefined script surfaced in the + dropdown. */
export interface ScriptEntry {
  name: string;
  command: string;
  group: "package" | "builtin" | "user";
  cwd?: string;
}

export interface ScriptsResponse {
  entries: ScriptEntry[];
  /** Non-fatal parse warning surfaced at the top of the dropdown. */
  warning?: string;
}

/** Client → server frames. */
export type TerminalClientFrame =
  | { op: "attach"; ids: string[] }
  | {
      op: "spawn";
      /** Client-allocated id so the client can pre-create the pane UI. */
      id: string;
      kind: "shell" | "script";
      scriptName?: string;
      cols: number;
      rows: number;
      /** Title shown in the tab strip; falls back to the resolved command. */
      title?: string;
    }
  | { op: "data"; id: string; b64: string }
  | { op: "resize"; id: string; cols: number; rows: number }
  | { op: "kill"; id: string }
  | { op: "close"; id: string };

/** Server → client frames. */
export type TerminalServerFrame =
  | { op: "spawned"; id: string; title: string }
  | { op: "replay"; id: string; b64: string }
  | { op: "data"; id: string; b64: string }
  | { op: "exit"; id: string; code: number | null }
  | { op: "gone"; id: string }
  | { op: "error"; id?: string; message: string };
```

- [ ] **Step 2: Typecheck**

Run: `bun run typecheck`
Expected: passes — the file has no dependencies and the types are self-contained.

- [ ] **Step 3: Commit**

```bash
git add src/shared/terminal-protocol.ts
git commit -m "feat(shared): add terminal WS protocol types"
```

---

## Task 4: Scripts resolver

**Files:**
- Create: `src/server/terminal/scripts.ts`
- Create: `test/terminal/scripts.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// test/terminal/scripts.test.ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createTempRepo, type TempRepo } from "../helpers/temp-repo";
import { resolveScripts } from "../../src/server/terminal/scripts";

describe("terminal scripts resolver", () => {
  let temp: TempRepo;
  beforeEach(() => {
    temp = createTempRepo();
  });
  afterEach(() => {
    temp.cleanup();
  });

  test("returns only built-ins when no package.json and no user config", async () => {
    const entries = await resolveScripts(temp.root);
    expect(entries.every((e) => e.group === "builtin")).toBe(true);
    expect(entries.find((e) => e.name === "git status")).toBeTruthy();
  });

  test("adds package.json scripts as `bun run <name>`", async () => {
    writeFileSync(
      join(temp.root, "package.json"),
      JSON.stringify({ scripts: { dev: "vite", test: "bun test" } }),
    );
    const entries = await resolveScripts(temp.root);
    const pkg = entries.filter((e) => e.group === "package");
    expect(pkg.find((e) => e.name === "dev")?.command).toBe("bun run dev");
    expect(pkg.find((e) => e.name === "test")?.command).toBe("bun run test");
  });

  test("user scripts override package scripts on name collision", async () => {
    writeFileSync(
      join(temp.root, "package.json"),
      JSON.stringify({ scripts: { test: "bun test" } }),
    );
    mkdirSync(join(temp.root, ".diffscope"));
    writeFileSync(
      join(temp.root, ".diffscope/scripts.json"),
      JSON.stringify({
        scripts: [{ name: "test", command: "bun test --coverage" }],
      }),
    );
    const entries = await resolveScripts(temp.root);
    const tests = entries.filter((e) => e.name === "test");
    expect(tests).toHaveLength(1);
    expect(tests[0]?.group).toBe("user");
    expect(tests[0]?.command).toBe("bun test --coverage");
  });

  test("user scripts override built-ins on name collision", async () => {
    mkdirSync(join(temp.root, ".diffscope"));
    writeFileSync(
      join(temp.root, ".diffscope/scripts.json"),
      JSON.stringify({
        scripts: [{ name: "git status", command: "git status -sb" }],
      }),
    );
    const entries = await resolveScripts(temp.root);
    const gs = entries.filter((e) => e.name === "git status");
    expect(gs).toHaveLength(1);
    expect(gs[0]?.group).toBe("user");
    expect(gs[0]?.command).toBe("git status -sb");
  });

  test("malformed package.json logs a warning and still returns other groups", async () => {
    writeFileSync(join(temp.root, "package.json"), "{ this is not json");
    const { entries, warning } = await resolveScripts(temp.root, {
      withWarning: true,
    });
    expect(entries.some((e) => e.group === "builtin")).toBe(true);
    expect(entries.some((e) => e.group === "package")).toBe(false);
    expect(warning).toMatch(/package\.json/);
  });

  test("malformed user config surfaces a warning but keeps package + builtin", async () => {
    writeFileSync(
      join(temp.root, "package.json"),
      JSON.stringify({ scripts: { dev: "vite" } }),
    );
    mkdirSync(join(temp.root, ".diffscope"));
    writeFileSync(join(temp.root, ".diffscope/scripts.json"), "{broken");
    const { entries, warning } = await resolveScripts(temp.root, {
      withWarning: true,
    });
    expect(entries.find((e) => e.name === "dev")?.group).toBe("package");
    expect(entries.some((e) => e.group === "user")).toBe(false);
    expect(warning).toMatch(/scripts\.json/);
  });

  test("empty name or empty command entries are dropped", async () => {
    mkdirSync(join(temp.root, ".diffscope"));
    writeFileSync(
      join(temp.root, ".diffscope/scripts.json"),
      JSON.stringify({
        scripts: [
          { name: "", command: "echo no name" },
          { name: "no command", command: "" },
          { name: "good", command: "echo yes" },
        ],
      }),
    );
    const entries = await resolveScripts(temp.root);
    const user = entries.filter((e) => e.group === "user");
    expect(user).toHaveLength(1);
    expect(user[0]?.name).toBe("good");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/terminal/scripts.test.ts`
Expected: FAIL — `Cannot find module '../../src/server/terminal/scripts'`.

- [ ] **Step 3: Implement `scripts.ts`**

```ts
// src/server/terminal/scripts.ts
// Merges built-in, package.json, and .diffscope/scripts.json entries.
// Later sources override earlier ones on name collision.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ScriptEntry } from "../../shared/terminal-protocol";

const BUILTINS: ScriptEntry[] = [
  { name: "git status", command: "git status", group: "builtin" },
  { name: "git log --oneline -20", command: "git log --oneline -20", group: "builtin" },
  { name: "git diff --stat", command: "git diff --stat", group: "builtin" },
  { name: "git fetch --all --prune", command: "git fetch --all --prune", group: "builtin" },
];

interface UserConfig {
  scripts?: { name?: unknown; command?: unknown; cwd?: unknown }[];
}

interface PackageJson {
  scripts?: Record<string, unknown>;
}

async function readJsonWithError<T>(
  path: string,
): Promise<{ value: T | null; parseError: boolean }> {
  try {
    const raw = await readFile(path, "utf8");
    try {
      return { value: JSON.parse(raw) as T, parseError: false };
    } catch {
      return { value: null, parseError: true };
    }
  } catch {
    return { value: null, parseError: false };
  }
}

function fromPackageJson(pkg: PackageJson | null): ScriptEntry[] {
  if (!pkg || typeof pkg.scripts !== "object" || pkg.scripts === null) return [];
  const out: ScriptEntry[] = [];
  for (const name of Object.keys(pkg.scripts)) {
    if (!name) continue;
    out.push({
      name,
      command: `bun run ${name}`,
      group: "package",
    });
  }
  return out;
}

function fromUserConfig(cfg: UserConfig | null): ScriptEntry[] {
  if (!cfg || !Array.isArray(cfg.scripts)) return [];
  const out: ScriptEntry[] = [];
  for (const entry of cfg.scripts) {
    if (typeof entry?.name !== "string" || entry.name.length === 0) continue;
    if (typeof entry?.command !== "string" || entry.command.length === 0) continue;
    out.push({
      name: entry.name,
      command: entry.command,
      group: "user",
      cwd: typeof entry.cwd === "string" ? entry.cwd : undefined,
    });
  }
  return out;
}

function mergeByName(groups: ScriptEntry[][]): ScriptEntry[] {
  // Later groups win. Build a map, then emit in the order the last write
  // occurred so later groups replace earlier ones in-place rather than
  // shuffling them to the end.
  const map = new Map<string, ScriptEntry>();
  for (const group of groups) {
    for (const entry of group) {
      map.set(entry.name, entry);
    }
  }
  return [...map.values()];
}

export interface ResolveOptions {
  withWarning?: boolean;
}

export async function resolveScripts(
  repoRoot: string,
): Promise<ScriptEntry[]>;
export async function resolveScripts(
  repoRoot: string,
  opts: { withWarning: true },
): Promise<{ entries: ScriptEntry[]; warning?: string }>;
export async function resolveScripts(
  repoRoot: string,
  opts?: ResolveOptions,
): Promise<ScriptEntry[] | { entries: ScriptEntry[]; warning?: string }> {
  const pkgResult = await readJsonWithError<PackageJson>(join(repoRoot, "package.json"));
  const userResult = await readJsonWithError<UserConfig>(
    join(repoRoot, ".diffscope/scripts.json"),
  );

  const entries = mergeByName([
    BUILTINS,
    fromPackageJson(pkgResult.value),
    fromUserConfig(userResult.value),
  ]);

  let warning: string | undefined;
  if (pkgResult.parseError) warning = "package.json: parse error";
  if (userResult.parseError) {
    warning = warning
      ? `${warning}; .diffscope/scripts.json: parse error`
      : ".diffscope/scripts.json: parse error";
  }

  if (opts?.withWarning) {
    return warning ? { entries, warning } : { entries };
  }
  return entries;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test test/terminal/scripts.test.ts`
Expected: all 7 tests PASS.

- [ ] **Step 5: Typecheck + lint**

Run: `bun run typecheck && bun run lint`
Expected: both pass.

- [ ] **Step 6: Commit**

```bash
git add src/server/terminal/scripts.ts test/terminal/scripts.test.ts
git commit -m "feat(terminal): add predefined scripts resolver"
```

---

## Task 5: PTY session layer

**Files:**
- Create: `src/server/terminal/pty.ts`
- Create: `test/terminal/pty.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// test/terminal/pty.test.ts
// Integration tests against real node-pty. If the native module fails to
// load (unlikely after Task 1 but possible on a mismatched host), the whole
// suite skips with a clear message rather than exploding.
import { afterAll, describe, expect, test } from "bun:test";
import { createPtyRegistry, type PtyRegistry } from "../../src/server/terminal/pty";

let ptyAvailable = true;
try {
  await import("node-pty");
} catch (err) {
  ptyAvailable = false;
  console.warn("pty tests skipped — node-pty unavailable:", err);
}

const d = ptyAvailable ? describe : describe.skip;

d("PTY registry", () => {
  let registry: PtyRegistry;

  afterAll(async () => {
    if (registry) await registry.shutdown();
  });

  test("spawn and receive output", async () => {
    registry = createPtyRegistry();
    const { id } = registry.spawn({
      command: "/bin/sh",
      args: ["-c", "echo diffscope-hello"],
      cwd: process.cwd(),
      cols: 80,
      rows: 24,
      title: "echo",
    });

    // Wait for exit + let scrollback drain.
    const code = await registry.waitForExit(id, 2000);
    expect(code).toBe(0);

    const scrollback = registry.readScrollback(id);
    expect(new TextDecoder().decode(scrollback)).toContain("diffscope-hello");
  });

  test("write forwards input to the PTY", async () => {
    registry = createPtyRegistry();
    const { id } = registry.spawn({
      command: "/bin/sh",
      args: ["-c", "read line; echo got:$line"],
      cwd: process.cwd(),
      cols: 80,
      rows: 24,
      title: "read",
    });

    registry.write(id, new TextEncoder().encode("ping\n"));
    const code = await registry.waitForExit(id, 2000);
    expect(code).toBe(0);

    const out = new TextDecoder().decode(registry.readScrollback(id));
    expect(out).toContain("got:ping");
  });

  test("resize updates cols/rows", async () => {
    registry = createPtyRegistry();
    const { id } = registry.spawn({
      command: "/bin/sh",
      args: ["-c", "stty size; sleep 0.2"],
      cwd: process.cwd(),
      cols: 80,
      rows: 24,
      title: "stty",
    });
    registry.resize(id, 120, 40);
    const code = await registry.waitForExit(id, 2000);
    expect(code).toBe(0);
    // stty size ran before the resize, so we're really just asserting the
    // resize call itself didn't throw and the session still records its
    // final dimensions.
    const session = registry.get(id);
    expect(session?.cols).toBe(120);
    expect(session?.rows).toBe(40);
  });

  test("scrollback is capped at ~1 MiB", async () => {
    registry = createPtyRegistry();
    // Generate well over 1 MiB of output (2048 × 1024 = 2 MiB of "A"s).
    const { id } = registry.spawn({
      command: "/bin/sh",
      args: [
        "-c",
        "for i in $(seq 1 2048); do head -c 1024 /dev/zero | tr '\\0' 'A'; echo; done",
      ],
      cwd: process.cwd(),
      cols: 80,
      rows: 24,
      title: "flood",
    });
    await registry.waitForExit(id, 5000);
    const sb = registry.readScrollback(id);
    // Cap is 1 MiB = 1_048_576 bytes; allow some slack for the last chunk
    // being appended before the cap check trims.
    expect(sb.byteLength).toBeLessThanOrEqual(1_200_000);
    expect(sb.byteLength).toBeGreaterThan(900_000);
  });

  test("subscribers receive live data until unsubscribe", async () => {
    registry = createPtyRegistry();
    const chunks: string[] = [];
    const { id } = registry.spawn({
      command: "/bin/sh",
      args: ["-c", "echo one; sleep 0.05; echo two"],
      cwd: process.cwd(),
      cols: 80,
      rows: 24,
      title: "stream",
    });
    const unsub = registry.subscribe(id, (data) => {
      chunks.push(new TextDecoder().decode(data));
    });
    const code = await registry.waitForExit(id, 2000);
    expect(code).toBe(0);
    unsub();
    const joined = chunks.join("");
    expect(joined).toContain("one");
    expect(joined).toContain("two");
  });

  test("kill sends SIGHUP to a running process", async () => {
    registry = createPtyRegistry();
    const { id } = registry.spawn({
      command: "/bin/sh",
      args: ["-c", "sleep 30"],
      cwd: process.cwd(),
      cols: 80,
      rows: 24,
      title: "sleep",
    });
    registry.kill(id);
    const code = await registry.waitForExit(id, 3000);
    // On SIGHUP the shell exits non-zero; the exact code depends on OS,
    // but anything non-null means the process is gone.
    expect(code).not.toBeNull();
  });

  test("close() after exit removes the session", async () => {
    registry = createPtyRegistry();
    const { id } = registry.spawn({
      command: "/bin/sh",
      args: ["-c", "true"],
      cwd: process.cwd(),
      cols: 80,
      rows: 24,
      title: "true",
    });
    await registry.waitForExit(id, 2000);
    registry.close(id);
    expect(registry.get(id)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/terminal/pty.test.ts`
Expected: FAIL — `Cannot find module '../../src/server/terminal/pty'`.

- [ ] **Step 3: Implement `pty.ts`**

```ts
// src/server/terminal/pty.ts
// Manages PTY sessions: spawn via node-pty, ring-buffered scrollback,
// subscriber fan-out, kill/close lifecycle.
import * as pty from "node-pty";
import { randomUUID } from "node:crypto";

const SCROLLBACK_CAP_BYTES = 1_048_576; // 1 MiB per session

export interface PtySpawnOptions {
  command: string;
  args: string[];
  cwd: string;
  cols: number;
  rows: number;
  title: string;
  scriptName?: string;
  env?: Record<string, string>;
  /** Pre-allocated id from the caller. If omitted, a UUID is generated. */
  id?: string;
}

export interface PtySession {
  id: string;
  title: string;
  scriptName?: string;
  cwd: string;
  cols: number;
  rows: number;
  createdAt: number;
  exitCode: number | null;
}

/** Subscriber callback receives raw bytes as they arrive from the PTY. */
export type PtyDataHandler = (data: Uint8Array) => void;
/** Called once when the process exits. */
export type PtyExitHandler = (code: number | null) => void;

interface InternalSession extends PtySession {
  proc: pty.IPty;
  // Ring buffer stored as a list of chunks with a rolling byte total.
  // Cheaper to trim than repeatedly concatenating one big Uint8Array.
  chunks: Uint8Array[];
  chunksBytes: number;
  dataHandlers: Set<PtyDataHandler>;
  exitHandlers: Set<PtyExitHandler>;
  exitPromise: Promise<number | null>;
  resolveExit: (code: number | null) => void;
}

export interface PtyRegistry {
  spawn(opts: PtySpawnOptions): PtySession;
  write(id: string, data: Uint8Array): void;
  resize(id: string, cols: number, rows: number): void;
  kill(id: string): void;
  close(id: string): void;
  get(id: string): PtySession | undefined;
  list(): PtySession[];
  readScrollback(id: string): Uint8Array;
  subscribe(id: string, handler: PtyDataHandler): () => void;
  onExit(id: string, handler: PtyExitHandler): () => void;
  waitForExit(id: string, timeoutMs?: number): Promise<number | null>;
  shutdown(): Promise<void>;
}

function concatScrollback(chunks: Uint8Array[], totalBytes: number): Uint8Array {
  const out = new Uint8Array(totalBytes);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

function appendWithCap(session: InternalSession, data: Uint8Array): void {
  session.chunks.push(data);
  session.chunksBytes += data.byteLength;
  // Drop oldest chunks until we're back under the cap.
  while (session.chunksBytes > SCROLLBACK_CAP_BYTES && session.chunks.length > 0) {
    const dropped = session.chunks.shift()!;
    session.chunksBytes -= dropped.byteLength;
  }
}

export function createPtyRegistry(): PtyRegistry {
  const sessions = new Map<string, InternalSession>();

  const spawn = (opts: PtySpawnOptions): PtySession => {
    const id = opts.id ?? randomUUID();
    if (sessions.has(id)) {
      throw new Error(`PTY id collision: ${id}`);
    }
    const proc = pty.spawn(opts.command, opts.args, {
      name: "xterm-256color",
      cols: opts.cols,
      rows: opts.rows,
      cwd: opts.cwd,
      env: {
        ...process.env,
        ...opts.env,
        TERM: "xterm-256color",
      } as Record<string, string>,
    });

    let resolveExit!: (code: number | null) => void;
    const exitPromise = new Promise<number | null>((res) => {
      resolveExit = res;
    });

    const session: InternalSession = {
      id,
      title: opts.title,
      scriptName: opts.scriptName,
      cwd: opts.cwd,
      cols: opts.cols,
      rows: opts.rows,
      createdAt: Date.now(),
      exitCode: null,
      proc,
      chunks: [],
      chunksBytes: 0,
      dataHandlers: new Set(),
      exitHandlers: new Set(),
      exitPromise,
      resolveExit,
    };
    sessions.set(id, session);

    proc.onData((d) => {
      // node-pty gives us a string — encode before storing so scrollback is
      // byte-accurate and binary-safe.
      const bytes = new TextEncoder().encode(d);
      appendWithCap(session, bytes);
      for (const h of session.dataHandlers) h(bytes);
    });

    proc.onExit(({ exitCode }) => {
      session.exitCode = exitCode ?? null;
      for (const h of session.exitHandlers) h(session.exitCode);
      session.resolveExit(session.exitCode);
    });

    return publicView(session);
  };

  const publicView = (s: InternalSession): PtySession => ({
    id: s.id,
    title: s.title,
    scriptName: s.scriptName,
    cwd: s.cwd,
    cols: s.cols,
    rows: s.rows,
    createdAt: s.createdAt,
    exitCode: s.exitCode,
  });

  const write = (id: string, data: Uint8Array): void => {
    const s = sessions.get(id);
    if (!s || s.exitCode !== null) return;
    s.proc.write(new TextDecoder().decode(data));
  };

  const resize = (id: string, cols: number, rows: number): void => {
    const s = sessions.get(id);
    if (!s) return;
    s.cols = cols;
    s.rows = rows;
    if (s.exitCode === null) {
      try {
        s.proc.resize(cols, rows);
      } catch {
        // Resize on a dying PTY can throw EIO — harmless, the next onExit handles it.
      }
    }
  };

  const kill = (id: string): void => {
    const s = sessions.get(id);
    if (!s || s.exitCode !== null) return;
    try {
      s.proc.kill("SIGHUP");
    } catch {
      // already dead
    }
    // Escalate after 1s if still running.
    setTimeout(() => {
      const still = sessions.get(id);
      if (still && still.exitCode === null) {
        try {
          still.proc.kill("SIGKILL");
        } catch {
          // already dead
        }
      }
    }, 1000);
  };

  const close = (id: string): void => {
    const s = sessions.get(id);
    if (!s) return;
    if (s.exitCode === null) {
      kill(id);
    }
    sessions.delete(id);
  };

  const get = (id: string) => {
    const s = sessions.get(id);
    return s ? publicView(s) : undefined;
  };

  const list = () => [...sessions.values()].map(publicView);

  const readScrollback = (id: string): Uint8Array => {
    const s = sessions.get(id);
    if (!s) return new Uint8Array(0);
    return concatScrollback(s.chunks, s.chunksBytes);
  };

  const subscribe = (id: string, handler: PtyDataHandler): (() => void) => {
    const s = sessions.get(id);
    if (!s) return () => {};
    s.dataHandlers.add(handler);
    return () => {
      s.dataHandlers.delete(handler);
    };
  };

  const onExit = (id: string, handler: PtyExitHandler): (() => void) => {
    const s = sessions.get(id);
    if (!s) return () => {};
    if (s.exitCode !== null) {
      // Already exited — call handler on next tick so subscribers who
      // register immediately after spawn don't miss the signal.
      queueMicrotask(() => handler(s.exitCode));
      return () => {};
    }
    s.exitHandlers.add(handler);
    return () => {
      s.exitHandlers.delete(handler);
    };
  };

  const waitForExit = async (id: string, timeoutMs = 10_000): Promise<number | null> => {
    const s = sessions.get(id);
    if (!s) return null;
    if (s.exitCode !== null) return s.exitCode;
    return await Promise.race([
      s.exitPromise,
      new Promise<number | null>((_, reject) =>
        setTimeout(() => reject(new Error(`PTY ${id} did not exit in ${timeoutMs}ms`)), timeoutMs),
      ),
    ]);
  };

  const shutdown = async (): Promise<void> => {
    for (const id of [...sessions.keys()]) {
      kill(id);
    }
    // Give processes a moment to die, then drop sessions.
    await new Promise((r) => setTimeout(r, 100));
    sessions.clear();
  };

  return {
    spawn,
    write,
    resize,
    kill,
    close,
    get,
    list,
    readScrollback,
    subscribe,
    onExit,
    waitForExit,
    shutdown,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test test/terminal/pty.test.ts`
Expected: all 7 tests PASS. If the native module fails to load, the suite is skipped with a clear message and the test run still succeeds — but that's a regression from Task 1 and should be investigated before continuing.

- [ ] **Step 5: Typecheck + lint**

Run: `bun run typecheck && bun run lint`
Expected: both pass.

- [ ] **Step 6: Commit**

```bash
git add src/server/terminal/pty.ts test/terminal/pty.test.ts
git commit -m "feat(terminal): add PTY session registry with scrollback"
```

---

## Task 6: WebSocket handler

**Files:**
- Create: `src/server/terminal/ws.ts`
- Create: `src/server/terminal/index.ts`
- Create: `test/terminal/ws.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// test/terminal/ws.test.ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Server } from "bun";
import { createTerminalModule } from "../../src/server/terminal";
import type {
  TerminalClientFrame,
  TerminalServerFrame,
} from "../../src/shared/terminal-protocol";

// Bun supports WebSocket on the same serve() instance. We mount just the
// terminal module here (no repo, no SSE) so the test is self-contained.
interface TestFixture {
  server: Server;
  port: number;
  shutdown: () => Promise<void>;
}

function startTestServer(): TestFixture {
  const mod = createTerminalModule({ repoRoot: process.cwd() });
  const server = Bun.serve({
    port: 0,
    fetch(req, srv) {
      const url = new URL(req.url);
      if (url.pathname === "/api/terminal/ws") {
        if (srv.upgrade(req)) return undefined as unknown as Response;
        return new Response("upgrade failed", { status: 400 });
      }
      return new Response("not found", { status: 404 });
    },
    websocket: mod.websocket,
  });
  return {
    server,
    port: server.port,
    async shutdown() {
      await mod.shutdown();
      server.stop(true);
    },
  };
}

async function openClient(port: number): Promise<{
  ws: WebSocket;
  frames: TerminalServerFrame[];
  nextFrame: (predicate?: (f: TerminalServerFrame) => boolean) => Promise<TerminalServerFrame>;
  send: (f: TerminalClientFrame) => void;
  close: () => void;
}> {
  const frames: TerminalServerFrame[] = [];
  const pending: ((f: TerminalServerFrame) => void)[] = [];
  const ws = new WebSocket(`ws://localhost:${port}/api/terminal/ws`);
  await new Promise<void>((resolve, reject) => {
    ws.onopen = () => resolve();
    ws.onerror = (e) => reject(e);
  });
  ws.onmessage = (evt) => {
    const frame = JSON.parse(String(evt.data)) as TerminalServerFrame;
    frames.push(frame);
    while (pending.length > 0) {
      const p = pending.shift()!;
      p(frame);
    }
  };
  return {
    ws,
    frames,
    send(f) {
      ws.send(JSON.stringify(f));
    },
    async nextFrame(predicate) {
      if (predicate) {
        const hit = frames.find(predicate);
        if (hit) return hit;
      } else if (frames.length > 0) {
        return frames[0]!;
      }
      return new Promise<TerminalServerFrame>((resolve) => {
        pending.push((f) => {
          if (!predicate || predicate(f)) resolve(f);
          else pending.unshift((nf) => resolve(nf));
        });
      });
    },
    close() {
      ws.close();
    },
  };
}

describe("terminal websocket protocol", () => {
  let fixture: TestFixture;
  beforeEach(() => {
    fixture = startTestServer();
  });
  afterEach(async () => {
    await fixture.shutdown();
  });

  test("spawn → data → exit round trip", async () => {
    const c = await openClient(fixture.port);
    const id = crypto.randomUUID();
    c.send({
      op: "spawn",
      id,
      kind: "shell",
      cols: 80,
      rows: 24,
      title: "echo",
    });

    // Wait for spawned ack
    const spawned = await c.nextFrame((f) => f.op === "spawned" && f.id === id);
    expect(spawned.op).toBe("spawned");

    // Send `echo hello\n` as a data frame (base64)
    const payload = new TextEncoder().encode("echo diffscope-ws; exit\n");
    c.send({
      op: "data",
      id,
      b64: Buffer.from(payload).toString("base64"),
    });

    // Wait for exit
    const exit = await c.nextFrame((f) => f.op === "exit" && f.id === id);
    expect(exit.op).toBe("exit");

    // Accumulate data frames for this id
    const out = c.frames
      .filter((f): f is Extract<TerminalServerFrame, { op: "data" }> =>
        f.op === "data" && f.id === id,
      )
      .map((f) => new TextDecoder().decode(Buffer.from(f.b64, "base64")))
      .join("");
    expect(out).toContain("diffscope-ws");

    c.close();
  });

  test("attach replays scrollback to a reconnecting client", async () => {
    const c1 = await openClient(fixture.port);
    const id = crypto.randomUUID();
    c1.send({
      op: "spawn",
      id,
      kind: "shell",
      cols: 80,
      rows: 24,
      title: "echo",
    });
    await c1.nextFrame((f) => f.op === "spawned" && f.id === id);

    const payload = new TextEncoder().encode("echo MARKER-123; exit\n");
    c1.send({ op: "data", id, b64: Buffer.from(payload).toString("base64") });
    await c1.nextFrame((f) => f.op === "exit" && f.id === id);
    c1.close();

    // New client attaches with the known id.
    const c2 = await openClient(fixture.port);
    c2.send({ op: "attach", ids: [id] });
    const replay = await c2.nextFrame((f) => f.op === "replay" && f.id === id);
    const replayText = new TextDecoder().decode(
      Buffer.from((replay as Extract<TerminalServerFrame, { op: "replay" }>).b64, "base64"),
    );
    expect(replayText).toContain("MARKER-123");
    c2.close();
  });

  test("attach with an unknown id sends `gone`", async () => {
    const c = await openClient(fixture.port);
    const bogus = crypto.randomUUID();
    c.send({ op: "attach", ids: [bogus] });
    const frame = await c.nextFrame((f) => f.op === "gone" && f.id === bogus);
    expect(frame.op).toBe("gone");
    c.close();
  });

  test("resize updates cols/rows", async () => {
    const c = await openClient(fixture.port);
    const id = crypto.randomUUID();
    c.send({ op: "spawn", id, kind: "shell", cols: 80, rows: 24, title: "r" });
    await c.nextFrame((f) => f.op === "spawned" && f.id === id);

    c.send({ op: "resize", id, cols: 120, rows: 30 });
    // No explicit ack; just verify the server didn't close the connection.
    c.send({ op: "kill", id });
    await c.nextFrame((f) => f.op === "exit" && f.id === id);
    c.close();
  });

  test("close on a running session kills it", async () => {
    const c = await openClient(fixture.port);
    const id = crypto.randomUUID();
    // Long-lived process — `sleep 30`.
    c.send({
      op: "spawn",
      id,
      kind: "shell",
      cols: 80,
      rows: 24,
      title: "sleep",
    });
    await c.nextFrame((f) => f.op === "spawned" && f.id === id);
    c.send({
      op: "data",
      id,
      b64: Buffer.from(new TextEncoder().encode("sleep 30\n")).toString("base64"),
    });
    c.send({ op: "close", id });
    const frame = await c.nextFrame((f) => f.op === "exit" && f.id === id);
    expect(frame.op).toBe("exit");
    c.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/terminal/ws.test.ts`
Expected: FAIL — `Cannot find module '../../src/server/terminal'`.

- [ ] **Step 3: Implement `ws.ts`**

```ts
// src/server/terminal/ws.ts
// Bun ServerWebSocket handler for the terminal channel.
// One connection multiplexes many terminal ids; frames are JSON
// TerminalClientFrame / TerminalServerFrame.
import type { ServerWebSocket, WebSocketHandler } from "bun";
import type {
  TerminalClientFrame,
  TerminalServerFrame,
  ScriptEntry,
} from "../../shared/terminal-protocol";
import type { PtyRegistry } from "./pty";

export interface WsDeps {
  registry: PtyRegistry;
  repoRoot: string;
  resolveScript: (name: string) => Promise<ScriptEntry | undefined>;
}

interface SocketData {
  /** termId → unsubscribe function for PTY data fan-out. */
  subscriptions: Map<string, () => void>;
}

function send(ws: ServerWebSocket<SocketData>, frame: TerminalServerFrame): void {
  ws.send(JSON.stringify(frame));
}

function toB64(bytes: Uint8Array): string {
  // Buffer.from is the fastest path in Bun and works for all byte values.
  return Buffer.from(bytes).toString("base64");
}

function fromB64(b64: string): Uint8Array {
  return new Uint8Array(Buffer.from(b64, "base64"));
}

function attachSubscribers(
  ws: ServerWebSocket<SocketData>,
  registry: PtyRegistry,
  id: string,
): void {
  if (ws.data.subscriptions.has(id)) return;
  const unsubData = registry.subscribe(id, (bytes) => {
    send(ws, { op: "data", id, b64: toB64(bytes) });
  });
  const unsubExit = registry.onExit(id, (code) => {
    send(ws, { op: "exit", id, code });
  });
  ws.data.subscriptions.set(id, () => {
    unsubData();
    unsubExit();
  });
}

function detachSubscribers(ws: ServerWebSocket<SocketData>, id: string): void {
  const unsub = ws.data.subscriptions.get(id);
  if (unsub) {
    unsub();
    ws.data.subscriptions.delete(id);
  }
}

export function createTerminalWsHandler(
  deps: WsDeps,
): WebSocketHandler<SocketData> {
  return {
    open(ws) {
      ws.data = { subscriptions: new Map() };
    },

    async message(ws, raw) {
      let frame: TerminalClientFrame;
      try {
        frame = JSON.parse(String(raw)) as TerminalClientFrame;
      } catch {
        send(ws, { op: "error", message: "malformed frame" });
        return;
      }

      switch (frame.op) {
        case "attach": {
          for (const id of frame.ids) {
            const session = deps.registry.get(id);
            if (!session) {
              send(ws, { op: "gone", id });
              continue;
            }
            const scrollback = deps.registry.readScrollback(id);
            send(ws, { op: "replay", id, b64: toB64(scrollback) });
            attachSubscribers(ws, deps.registry, id);
            if (session.exitCode !== null) {
              send(ws, { op: "exit", id, code: session.exitCode });
            }
          }
          return;
        }

        case "spawn": {
          let command: string;
          let args: string[];
          let title = frame.title ?? "terminal";
          let scriptName: string | undefined;

          if (frame.kind === "shell") {
            command = process.env.SHELL || "/bin/zsh";
            args = ["-l"];
            title = frame.title ?? command.split("/").pop() ?? "shell";
          } else {
            if (!frame.scriptName) {
              send(ws, { op: "error", id: frame.id, message: "scriptName required" });
              return;
            }
            const entry = await deps.resolveScript(frame.scriptName);
            if (!entry) {
              send(ws, { op: "error", id: frame.id, message: `unknown script: ${frame.scriptName}` });
              return;
            }
            // Run the command through the user's shell so features like
            // shell pipelines and env expansion work without quoting games.
            command = process.env.SHELL || "/bin/zsh";
            args = ["-l", "-c", entry.command];
            title = frame.title ?? entry.name;
            scriptName = entry.name;
          }

          // Honor the client-provided id so every subsequent data/exit
          // frame can be routed back to the pane that's already mounted
          // under that id on the client. If the id collides (e.g. a stale
          // reattach + spawn race) the registry throws; we surface it.
          try {
            const session = deps.registry.spawn({
              id: frame.id,
              command,
              args,
              cwd: deps.repoRoot,
              cols: frame.cols,
              rows: frame.rows,
              title,
              scriptName,
            });
            attachSubscribers(ws, deps.registry, session.id);
            send(ws, { op: "spawned", id: session.id, title: session.title });
          } catch (err) {
            send(ws, {
              op: "error",
              id: frame.id,
              message: err instanceof Error ? err.message : String(err),
            });
          }
          return;
        }

        case "data": {
          deps.registry.write(frame.id, fromB64(frame.b64));
          return;
        }

        case "resize": {
          deps.registry.resize(frame.id, frame.cols, frame.rows);
          return;
        }

        case "kill": {
          deps.registry.kill(frame.id);
          return;
        }

        case "close": {
          detachSubscribers(ws, frame.id);
          deps.registry.close(frame.id);
          return;
        }
      }
    },

    close(ws) {
      for (const unsub of ws.data.subscriptions.values()) unsub();
      ws.data.subscriptions.clear();
    },
  };
}
```

- [ ] **Step 4: Implement `index.ts`**

```ts
// src/server/terminal/index.ts
// Factory that bundles the registry, scripts resolver, HTTP handler, and
// WebSocket handler so http.ts can wire the whole subsystem in one import.
import type { WebSocketHandler } from "bun";
import { createPtyRegistry, type PtyRegistry } from "./pty";
import { resolveScripts } from "./scripts";
import { createTerminalWsHandler } from "./ws";
import type { ScriptsResponse } from "../../shared/terminal-protocol";

export interface TerminalModuleOptions {
  repoRoot: string;
}

export interface TerminalModule {
  registry: PtyRegistry;
  websocket: WebSocketHandler<{ subscriptions: Map<string, () => void> }>;
  handleScriptsRequest(): Promise<Response>;
  shutdown(): Promise<void>;
}

export function createTerminalModule(opts: TerminalModuleOptions): TerminalModule {
  const registry = createPtyRegistry();

  const resolveScript = async (name: string) => {
    const entries = await resolveScripts(opts.repoRoot);
    return entries.find((e) => e.name === name);
  };

  const websocket = createTerminalWsHandler({
    registry,
    repoRoot: opts.repoRoot,
    resolveScript,
  });

  const handleScriptsRequest = async (): Promise<Response> => {
    const result = await resolveScripts(opts.repoRoot, { withWarning: true });
    const body: ScriptsResponse = {
      entries: result.entries,
      warning: result.warning,
    };
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  const shutdown = async () => {
    await registry.shutdown();
  };

  return { registry, websocket, handleScriptsRequest, shutdown };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test test/terminal/ws.test.ts`
Expected: all 5 tests PASS.

- [ ] **Step 6: Typecheck + lint**

Run: `bun run typecheck && bun run lint`
Expected: both pass.

- [ ] **Step 7: Commit**

```bash
git add src/server/terminal/ws.ts src/server/terminal/index.ts test/terminal/ws.test.ts
git commit -m "feat(terminal): add WebSocket handler + module factory"
```

---

## Task 7: Wire the terminal module into http.ts

**Files:**
- Modify: `src/server/http.ts`

- [ ] **Step 1: Read the current top of `http.ts` to confirm its shape**

Already read in the prep phase — `startHttpServer` calls `serve({ port, fetch })` at line ~323, returns `{ server, stop }`. We'll add:
1. `createTerminalModule` next to `createEventHub` at the top of the function.
2. A `/api/terminal/ws` upgrade branch and `/api/terminal/scripts` route in the `handle` chain.
3. `websocket: terminalModule.websocket` on the `serve()` config.
4. `await terminalModule.shutdown()` in the returned `stop()`.

- [ ] **Step 2: Add the terminal import and module creation**

Edit `src/server/http.ts`, at the import block (after the existing `./blame` import):

```ts
import { createTerminalModule, type TerminalModule } from "./terminal";
```

Then inside `startHttpServer`, after the `hub` block (around line 87):

```ts
  // Terminal module. Created eagerly even if no repo is loaded — it just
  // starts with no active sessions. When the repo changes via /api/open,
  // the module stays attached to the first repo (sessions should not
  // survive repo swaps; see shutdown below).
  let terminalModule: TerminalModule | null = null;
  if (repo) {
    terminalModule = createTerminalModule({ repoRoot: repo.cwd });
  }
```

- [ ] **Step 3: Add routing inside `handle`**

Edit the `handle` function. Find the SSE stream block (`if (pathname === "/api/stream")`, around line 170) and insert BEFORE it:

```ts
    // Terminal: scripts list
    if (pathname === "/api/terminal/scripts") {
      if (!terminalModule) return json({ error: "no repo loaded" }, 400);
      return terminalModule.handleScriptsRequest();
    }
```

The WebSocket upgrade is handled inside `serve()`'s `fetch` wrapper, not here — see step 5.

- [ ] **Step 4: Handle the repo swap in `/api/open`**

In the `/api/open` POST handler (around line 253), after successfully swapping `nextHub` in, also swap the terminal module:

Find the block:

```ts
      const prevHub = hub;
      repo = nextRepo;
      hub = nextHub;
      invalidateBlameCache();
      if (prevHub) await prevHub.stop();
      return json({ ok: true, root: found });
```

Change to:

```ts
      const prevHub = hub;
      const prevTerminal = terminalModule;
      repo = nextRepo;
      hub = nextHub;
      terminalModule = createTerminalModule({ repoRoot: nextRepo.cwd });
      invalidateBlameCache();
      if (prevHub) await prevHub.stop();
      if (prevTerminal) await prevTerminal.shutdown();
      return json({ ok: true, root: found });
```

Rationale: when the user opens a new repo, existing terminal sessions become stale (wrong cwd, possibly running the old repo's dev server). Killing them and starting fresh is the least-surprising behavior and matches the session-ties-to-diffscope-lifetime decision from §2.

- [ ] **Step 5: Add WS upgrade handling in the `serve()` fetch wrapper**

Find the `serve({ port: opts.port, async fetch(req) { ... } })` block (around line 323). Replace it with:

```ts
  const server = serve({
    port: opts.port,
    async fetch(req, srv) {
      try {
        // Terminal WebSocket upgrade. Must run before the generic handler
        // since the handler would otherwise 404 the route.
        const url = new URL(req.url);
        if (url.pathname === "/api/terminal/ws") {
          if (!terminalModule) return json({ error: "no repo loaded" }, 400);
          if (srv.upgrade(req)) return undefined as unknown as Response;
          return new Response("upgrade failed", { status: 400 });
        }
        return await handle(req);
      } catch (err) {
        return errorResponse(err);
      }
    },
    websocket: {
      open(ws) {
        terminalModule?.websocket.open?.(ws);
      },
      async message(ws, data) {
        await terminalModule?.websocket.message?.(ws, data);
      },
      close(ws, code, reason) {
        terminalModule?.websocket.close?.(ws, code, reason);
      },
      drain(ws) {
        terminalModule?.websocket.drain?.(ws);
      },
    },
  });
```

The wrapper dispatches to the current `terminalModule` on every event so that a `/api/open` repo swap transparently routes subsequent messages to the new module (old sockets will have been forcibly closed when `prevTerminal.shutdown()` ran).

- [ ] **Step 6: Add terminal shutdown to `stop()`**

Find the `return { server, async stop() { ... } }` block at the bottom of `startHttpServer` (around line 334):

```ts
  return {
    server,
    async stop() {
      if (hub) await hub.stop();
      server.stop(true);
    },
  };
```

Change to:

```ts
  return {
    server,
    async stop() {
      if (hub) await hub.stop();
      if (terminalModule) await terminalModule.shutdown();
      server.stop(true);
    },
  };
```

- [ ] **Step 7: Run existing tests to confirm nothing regressed**

Run: `bun test`
Expected: all existing tests still pass + the new terminal/* tests pass. No new failures.

- [ ] **Step 8: Typecheck + lint**

Run: `bun run typecheck && bun run lint`
Expected: both pass.

- [ ] **Step 9: Smoke test the running server**

Run in one terminal: `DIFFSCOPE_DEV_PORT=41111 bun run src/server/cli.ts .`
Expected stdout: includes `diffscope: http://localhost:41111`.

In another terminal: `curl -s http://localhost:41111/api/terminal/scripts | bun run -e "const s = await Bun.stdin.text(); console.log(JSON.parse(s).entries.length, 'scripts')"`
Expected: prints a positive integer ≥ 4 (the built-ins) + however many package.json scripts diffscope itself has.

Kill the server with Ctrl+C.

- [ ] **Step 10: Commit**

```bash
git add src/server/http.ts
git commit -m "feat(terminal): wire terminal module into http server"
```

---

## Task 8: Settings additions for drawer state

**Files:**
- Modify: `src/web/settings.ts`

- [ ] **Step 1: Add the three new fields**

Edit `src/web/settings.ts`. Find the `Settings` interface (around line 121):

```ts
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
```

Add three new fields at the end:

```ts
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
  terminalDrawerOpen: boolean;
  terminalDrawerHeightPx: number;
  terminalNoticeAcknowledged: boolean;
}
```

Find `DEFAULTS` (around line 135):

```ts
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
```

Add defaults:

```ts
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
  terminalDrawerOpen: false,
  terminalDrawerHeightPx: 280,
  terminalNoticeAcknowledged: false,
};
```

- [ ] **Step 2: Typecheck**

Run: `bun run typecheck`
Expected: passes — the new fields are just additive.

- [ ] **Step 3: Commit**

```bash
git add src/web/settings.ts
git commit -m "feat(settings): add terminal drawer state fields"
```

---

## Task 9: Terminal store (frontend metadata)

**Files:**
- Create: `src/web/terminal/terminal-store.ts`
- Create: `test/terminal/terminal-store.test.ts`

Note: this test lives in `test/` but imports from `src/web/`. It can run under `bun test` because we're only testing plain TypeScript state, no React rendering, no DOM.

- [ ] **Step 1: Write the failing test**

```ts
// test/terminal/terminal-store.test.ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  createTerminalStore,
  type TerminalStore,
} from "../../src/web/terminal/terminal-store";

// A minimal localStorage stub — the store reads/writes this one key.
function makeLocalStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear() {
      map.clear();
    },
    getItem(k) {
      return map.get(k) ?? null;
    },
    key(i) {
      return [...map.keys()][i] ?? null;
    },
    removeItem(k) {
      map.delete(k);
    },
    setItem(k, v) {
      map.set(k, v);
    },
  } as Storage;
}

describe("terminal store", () => {
  let store: TerminalStore;
  let storage: Storage;

  beforeEach(() => {
    storage = makeLocalStorage();
    store = createTerminalStore({ storage });
  });

  afterEach(() => {
    storage.clear();
  });

  test("starts empty", () => {
    expect(store.getState().terminals).toEqual([]);
    expect(store.getState().activeId).toBeNull();
  });

  test("addTerminal appends and activates by default", () => {
    store.getState().addTerminal({
      id: "a",
      title: "shell",
      status: "running",
    });
    expect(store.getState().terminals).toHaveLength(1);
    expect(store.getState().activeId).toBe("a");
  });

  test("removeTerminal drops it and picks a new active if needed", () => {
    const { addTerminal, removeTerminal } = store.getState();
    addTerminal({ id: "a", title: "a", status: "running" });
    addTerminal({ id: "b", title: "b", status: "running" });
    addTerminal({ id: "c", title: "c", status: "running" });
    store.getState().setActive("b");
    removeTerminal("b");
    expect(store.getState().terminals.map((t) => t.id)).toEqual(["a", "c"]);
    // Active should fall back to the next neighbor — here `c`.
    expect(store.getState().activeId).toBe("c");
  });

  test("updateTerminal patches status and exitCode", () => {
    store.getState().addTerminal({ id: "a", title: "a", status: "running" });
    store.getState().updateTerminal("a", { status: "exited", exitCode: 0 });
    const t = store.getState().terminals[0]!;
    expect(t.status).toBe("exited");
    expect(t.exitCode).toBe(0);
  });

  test("persists metadata to localStorage and rehydrates", () => {
    store.getState().addTerminal({
      id: "abc",
      title: "bun dev",
      scriptName: "dev",
      status: "running",
    });
    store.getState().setActive("abc");

    // A fresh store sharing the same storage should rehydrate.
    const next = createTerminalStore({ storage });
    const terms = next.getState().terminals;
    expect(terms).toHaveLength(1);
    expect(terms[0]?.id).toBe("abc");
    expect(terms[0]?.title).toBe("bun dev");
    expect(terms[0]?.scriptName).toBe("dev");
    // Status is server-owned and NOT persisted — it comes back as "running"
    // (the optimistic default) and will be overwritten on attach.
    expect(terms[0]?.status).toBe("running");
    expect(next.getState().activeId).toBe("abc");
  });

  test("clearAll empties the store and storage", () => {
    store.getState().addTerminal({ id: "a", title: "a", status: "running" });
    store.getState().addTerminal({ id: "b", title: "b", status: "running" });
    store.getState().clearAll();
    expect(store.getState().terminals).toEqual([]);
    expect(store.getState().activeId).toBeNull();
    expect(storage.getItem("diffscope:terminals:v1")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/terminal/terminal-store.test.ts`
Expected: FAIL — `Cannot find module '../../src/web/terminal/terminal-store'`.

- [ ] **Step 3: Implement `terminal-store.ts`**

```ts
// src/web/terminal/terminal-store.ts
// Tiny always-loaded zustand store holding terminal metadata.
// Persistence is manual (write-through on every mutation) so we can inject
// a fake Storage in unit tests without needing the zustand/middleware/persist
// package.
import { create, type StoreApi } from "zustand";

export type TerminalStatus = "running" | "exited";

export interface TerminalMeta {
  id: string;
  title: string;
  scriptName?: string;
  status: TerminalStatus;
  exitCode?: number;
}

export interface TerminalState {
  terminals: TerminalMeta[];
  activeId: string | null;
  addTerminal(meta: TerminalMeta): void;
  removeTerminal(id: string): void;
  setActive(id: string): void;
  updateTerminal(id: string, patch: Partial<TerminalMeta>): void;
  clearAll(): void;
}

export type TerminalStore = StoreApi<TerminalState>;

const STORAGE_KEY = "diffscope:terminals:v1";

interface PersistShape {
  terminals: Pick<TerminalMeta, "id" | "title" | "scriptName">[];
  activeId: string | null;
}

function loadFromStorage(storage: Storage | undefined): PersistShape {
  if (!storage) return { terminals: [], activeId: null };
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return { terminals: [], activeId: null };
    const parsed = JSON.parse(raw) as PersistShape;
    if (!parsed || !Array.isArray(parsed.terminals)) {
      return { terminals: [], activeId: null };
    }
    return {
      terminals: parsed.terminals.filter(
        (t): t is PersistShape["terminals"][number] =>
          typeof t?.id === "string" && typeof t?.title === "string",
      ),
      activeId: typeof parsed.activeId === "string" ? parsed.activeId : null,
    };
  } catch {
    return { terminals: [], activeId: null };
  }
}

function writeToStorage(
  storage: Storage | undefined,
  state: Pick<TerminalState, "terminals" | "activeId">,
): void {
  if (!storage) return;
  try {
    const shape: PersistShape = {
      terminals: state.terminals.map((t) => ({
        id: t.id,
        title: t.title,
        scriptName: t.scriptName,
      })),
      activeId: state.activeId,
    };
    storage.setItem(STORAGE_KEY, JSON.stringify(shape));
  } catch {
    // quota / disabled storage — drop silently, matches settings.ts
  }
}

function clearStorage(storage: Storage | undefined): void {
  if (!storage) return;
  try {
    storage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

function pickNewActive(
  terminals: TerminalMeta[],
  removedId: string,
  previousActiveId: string | null,
): string | null {
  if (previousActiveId !== removedId) return previousActiveId;
  if (terminals.length === 0) return null;
  // Prefer the terminal that's now at the same index as the removed one.
  return terminals[0]?.id ?? null;
}

export interface CreateTerminalStoreOptions {
  storage?: Storage;
}

export function createTerminalStore(
  opts: CreateTerminalStoreOptions = {},
): TerminalStore {
  const storage = opts.storage;
  const initial = loadFromStorage(storage);

  const store = create<TerminalState>((set, get) => {
    const persist = () => {
      const { terminals, activeId } = get();
      writeToStorage(storage, { terminals, activeId });
    };

    return {
      terminals: initial.terminals.map((t) => ({
        ...t,
        // Persisted rows rehydrate as "running" — server attach will
        // overwrite with the real status.
        status: "running" as const,
      })),
      activeId: initial.activeId,

      addTerminal(meta) {
        set({
          terminals: [...get().terminals, meta],
          activeId: meta.id,
        });
        persist();
      },

      removeTerminal(id) {
        const before = get();
        const next = before.terminals.filter((t) => t.id !== id);
        const nextActive = pickNewActive(next, id, before.activeId);
        set({ terminals: next, activeId: nextActive });
        persist();
      },

      setActive(id) {
        if (!get().terminals.some((t) => t.id === id)) return;
        set({ activeId: id });
        persist();
      },

      updateTerminal(id, patch) {
        set({
          terminals: get().terminals.map((t) =>
            t.id === id ? { ...t, ...patch } : t,
          ),
        });
        // status/exitCode aren't persisted, so no persist() call here.
      },

      clearAll() {
        set({ terminals: [], activeId: null });
        clearStorage(storage);
      },
    };
  });

  return store;
}

// The singleton used by the real app. Tests that need isolation can build
// their own with `createTerminalStore({ storage: fakeStorage })`.
export const useTerminalStore: TerminalStore =
  typeof window === "undefined"
    ? createTerminalStore()
    : createTerminalStore({ storage: window.localStorage });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test test/terminal/terminal-store.test.ts`
Expected: all 6 tests PASS.

- [ ] **Step 5: Typecheck**

Run: `bun run typecheck`
Expected: passes for both `tsconfig.json` and `tsconfig.web.json`.

Note: `test/terminal/terminal-store.test.ts` imports from `src/web/`, which `tsconfig.json` excludes. Since `bun test` uses Bun's own resolver (not tsc), the import still works at runtime. The test file is covered by the `test/**/*` include in `tsconfig.json`, so tsc will report it as referencing excluded files — if this produces a typecheck error, move the test under `src/web/terminal/__tests__/terminal-store.test.ts` and add `src/web/**/__tests__/**/*` to `tsconfig.web.json`'s include. Make that adjustment inline if needed.

- [ ] **Step 6: Commit**

```bash
git add src/web/terminal/terminal-store.ts test/terminal/terminal-store.test.ts
git commit -m "feat(terminal): add frontend terminal metadata store"
```

---

## Task 10: WebSocket client hook

**Files:**
- Create: `src/web/terminal/use-terminal-ws.ts`

- [ ] **Step 1: Create the hook**

```ts
// src/web/terminal/use-terminal-ws.ts
// Singleton WebSocket client for /api/terminal/ws. The connection and
// subscriber registry live at module scope so every terminal-pane mount
// shares one socket — the protocol multiplexes by termId.
import { useEffect, useState } from "react";
import type {
  TerminalClientFrame,
  TerminalServerFrame,
} from "../../shared/terminal-protocol";

type PerIdHandler = (frame: TerminalServerFrame) => void;

let socket: WebSocket | null = null;
let connecting = false;
const handlersById = new Map<string, Set<PerIdHandler>>();
// Frames that arrived before a subscriber registered for their id. We buffer
// a small window so replay-on-attach doesn't lose data if the pane mounts a
// microtask after `attach` fires.
const pendingById = new Map<string, TerminalServerFrame[]>();
const MAX_PENDING_PER_ID = 64;
const openWaiters: (() => void)[] = [];
let reconnectDelay = 250;
const RECONNECT_MAX = 4000;

function wsUrl(): string {
  const loc = window.location;
  const protocol = loc.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${loc.host}/api/terminal/ws`;
}

function flushPending(id: string, handler: PerIdHandler): void {
  const queue = pendingById.get(id);
  if (!queue) return;
  for (const f of queue) handler(f);
  pendingById.delete(id);
}

function onMessage(evt: MessageEvent): void {
  let frame: TerminalServerFrame;
  try {
    frame = JSON.parse(String(evt.data)) as TerminalServerFrame;
  } catch {
    return;
  }
  const id = "id" in frame ? frame.id : undefined;
  if (!id) return;
  const set = handlersById.get(id);
  if (set && set.size > 0) {
    for (const h of set) h(frame);
    return;
  }
  // Buffer for a late subscriber.
  const queue = pendingById.get(id) ?? [];
  if (queue.length < MAX_PENDING_PER_ID) {
    queue.push(frame);
    pendingById.set(id, queue);
  }
}

function open(): Promise<void> {
  if (socket && socket.readyState === WebSocket.OPEN) return Promise.resolve();
  if (connecting) {
    return new Promise((resolve) => openWaiters.push(resolve));
  }
  connecting = true;
  return new Promise((resolve) => {
    const ws = new WebSocket(wsUrl());
    socket = ws;
    ws.onopen = () => {
      connecting = false;
      reconnectDelay = 250;
      resolve();
      while (openWaiters.length > 0) openWaiters.shift()!();
    };
    ws.onmessage = onMessage;
    ws.onclose = () => {
      connecting = false;
      socket = null;
      // Exponential backoff; rebroadcast attach will happen from the
      // useTerminalWs hook when the attach-on-reconnect effect below runs.
      setTimeout(() => {
        if (handlersById.size > 0 || pendingById.size > 0) void open();
      }, reconnectDelay);
      reconnectDelay = Math.min(reconnectDelay * 2, RECONNECT_MAX);
    };
    ws.onerror = () => {
      // onclose will handle the retry.
    };
  });
}

export function sendFrame(frame: TerminalClientFrame): void {
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(frame));
  } else {
    // Queue by opening first, then sending.
    void open().then(() => socket?.send(JSON.stringify(frame)));
  }
}

export function subscribe(id: string, handler: PerIdHandler): () => void {
  let set = handlersById.get(id);
  if (!set) {
    set = new Set();
    handlersById.set(id, set);
  }
  set.add(handler);
  flushPending(id, handler);
  return () => {
    const current = handlersById.get(id);
    if (!current) return;
    current.delete(handler);
    if (current.size === 0) handlersById.delete(id);
  };
}

/**
 * Opens the WebSocket (if not already open) and sends `attach` for the
 * given ids. Idempotent and safe to call from multiple components.
 */
export function attachIds(ids: string[]): void {
  if (ids.length === 0) {
    void open();
    return;
  }
  void open().then(() => {
    sendFrame({ op: "attach", ids });
  });
}

/**
 * React hook that exposes connection readiness and ensures the socket is
 * open. Components that only need to send/subscribe can import the module
 * functions directly; the hook is for re-rendering on connection state.
 */
export function useTerminalWs(): { ready: boolean } {
  const [ready, setReady] = useState(
    socket !== null && socket.readyState === WebSocket.OPEN,
  );
  useEffect(() => {
    let cancelled = false;
    void open().then(() => {
      if (!cancelled) setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return { ready };
}
```

- [ ] **Step 2: Typecheck**

Run: `bun run typecheck`
Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add src/web/terminal/use-terminal-ws.ts
git commit -m "feat(terminal): add singleton WebSocket client hook"
```

---

## Task 11: Terminal pane component

**Files:**
- Create: `src/web/terminal/terminal-pane.tsx`
- Create: `src/web/terminal/xterm-theme.ts`

- [ ] **Step 1: Create the theme helper**

```ts
// src/web/terminal/xterm-theme.ts
// Read xterm-friendly colors from the CSS variables the app already
// defines for each theme. We pull them once per theme change and hand
// them to each Terminal instance via .options.theme = ...
import type { ITheme } from "@xterm/xterm";

function readVar(name: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

export function currentXtermTheme(): ITheme {
  return {
    background: readVar("--bg", "#111"),
    foreground: readVar("--fg", "#eee"),
    cursor: readVar("--accent", "#22d3ee"),
    cursorAccent: readVar("--bg", "#111"),
    selectionBackground: readVar("--accent", "#22d3ee") + "40",
  };
}
```

- [ ] **Step 2: Create the pane component**

```tsx
// src/web/terminal/terminal-pane.tsx
// One xterm.js instance per terminal id. Mounted once per id, kept alive
// across tab switches (hidden via `hidden` prop from the parent drawer).
import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";
import { sendFrame, subscribe } from "./use-terminal-ws";
import { useTerminalStore } from "./terminal-store";
import { useSettings } from "../settings";
import { currentXtermTheme } from "./xterm-theme";
import type { TerminalServerFrame } from "../../shared/terminal-protocol";

interface TerminalPaneProps {
  id: string;
  /** True for brand-new panes (spawn on mount). False for rehydrated/persisted. */
  spawnOnMount: boolean;
  /** Present only when spawnOnMount is true. */
  spawnRequest?:
    | { kind: "shell" }
    | { kind: "script"; scriptName: string; title: string };
}

export function TerminalPane({ id, spawnOnMount, spawnRequest }: TerminalPaneProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const themeId = useSettings((s) => s.theme);

  // Mount once per id.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const term = new Terminal({
      cursorBlink: true,
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
      fontSize: 13,
      theme: currentXtermTheme(),
      scrollback: 5000,
      allowProposedApi: true,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon());
    term.open(container);
    termRef.current = term;
    fitRef.current = fit;
    try {
      fit.fit();
    } catch {
      // Container may not have layout yet; ResizeObserver below catches up.
    }

    const { cols, rows } = term;

    // Handle frames for this id. Single subscription — all server-frame
    // ops route through this handler since the WS client already fans
    // frames out by id.
    const unsub = subscribe(id, (frame: TerminalServerFrame) => {
      if (frame.op === "replay") {
        const bytes = Uint8Array.from(atob(frame.b64), (c) => c.charCodeAt(0));
        term.write(bytes);
        return;
      }
      if (frame.op === "data") {
        const bytes = Uint8Array.from(atob(frame.b64), (c) => c.charCodeAt(0));
        term.write(bytes);
        return;
      }
      if (frame.op === "spawned") {
        // Server may have picked a different title than the client requested
        // (e.g., inferred from the shell basename) — update the tab.
        useTerminalStore.getState().updateTerminal(id, { title: frame.title });
        return;
      }
      if (frame.op === "exit") {
        useTerminalStore.getState().updateTerminal(id, {
          status: "exited",
          exitCode: frame.code ?? undefined,
        });
        term.write(`\r\n\x1b[2m[process exited${
          frame.code !== null ? ` with code ${frame.code}` : ""
        }]\x1b[0m\r\n`);
        return;
      }
      if (frame.op === "gone") {
        useTerminalStore.getState().removeTerminal(id);
        return;
      }
    });

    // Spawn (brand-new pane) vs rely on attach/replay (already ran in the
    // ws hook's initial attach).
    if (spawnOnMount && spawnRequest) {
      if (spawnRequest.kind === "shell") {
        sendFrame({
          op: "spawn",
          id, // client-assigned id is only an intent; server returns its own
          kind: "shell",
          cols,
          rows,
          title: "shell",
        });
      } else {
        sendFrame({
          op: "spawn",
          id,
          kind: "script",
          scriptName: spawnRequest.scriptName,
          cols,
          rows,
          title: spawnRequest.title,
        });
      }
    }

    // Forward user keystrokes.
    const keyDisposable = term.onData((data) => {
      const bytes = new TextEncoder().encode(data);
      sendFrame({
        op: "data",
        id,
        b64: btoa(String.fromCharCode(...bytes)),
      });
    });

    // Resize on container changes.
    const observer = new ResizeObserver(() => {
      try {
        fit.fit();
        sendFrame({ op: "resize", id, cols: term.cols, rows: term.rows });
      } catch {
        // container may be hidden (display:none) — skip
      }
    });
    observer.observe(container);

    return () => {
      observer.disconnect();
      keyDisposable.dispose();
      unsub();
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
    // spawnOnMount/spawnRequest are only read on first mount; re-running this
    // effect would re-spawn, which we never want.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Re-apply theme when the theme setting changes.
  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    term.options.theme = currentXtermTheme();
  }, [themeId]);

  return <div ref={containerRef} className="h-full w-full bg-bg" />;
}
```

- [ ] **Step 3: Typecheck**

Run: `bun run typecheck`
Expected: passes. If the xterm-addon-fit types complain, check `node_modules/@xterm/addon-fit/typings` — the API should be `new FitAddon(); term.loadAddon(fit); fit.fit();`.

- [ ] **Step 4: Commit**

```bash
git add src/web/terminal/terminal-pane.tsx src/web/terminal/xterm-theme.ts
git commit -m "feat(terminal): add terminal pane component"
```

---

## Task 12: Terminal tab strip with `+` dropdown

**Files:**
- Create: `src/web/terminal/terminal-api.ts`
- Create: `src/web/terminal/terminal-tab-strip.tsx`

- [ ] **Step 1: Create `terminal-api.ts`**

```ts
// src/web/terminal/terminal-api.ts
// Fetch wrapper for terminal REST endpoints (just scripts, for now).
import type { ScriptsResponse } from "../../shared/terminal-protocol";

export async function fetchScripts(): Promise<ScriptsResponse> {
  const res = await fetch("/api/terminal/scripts");
  if (!res.ok) {
    throw new Error(`/api/terminal/scripts: ${res.status}`);
  }
  return (await res.json()) as ScriptsResponse;
}
```

- [ ] **Step 2: Create the tab strip component**

```tsx
// src/web/terminal/terminal-tab-strip.tsx
// Tab row for the terminal drawer. `+` button opens a dropdown of the
// merged predefined-script list (fetched on open, not cached across
// drawer openings).
import { useCallback, useEffect, useRef, useState } from "react";
import { useTerminalStore, type TerminalMeta } from "./terminal-store";
import { fetchScripts } from "./terminal-api";
import type { ScriptEntry, ScriptsResponse } from "../../shared/terminal-protocol";

interface PendingSpawn {
  id: string;
  kind: "shell" | "script";
  scriptName?: string;
  title: string;
}

export interface TerminalTabStripProps {
  /** Emitted when the user picks an entry from the + dropdown. The drawer
   *  is responsible for mounting a new <TerminalPane id=... spawnOnMount /> */
  onRequestSpawn(spawn: PendingSpawn): void;
}

export function TerminalTabStrip({ onRequestSpawn }: TerminalTabStripProps) {
  const terminals = useTerminalStore((s) => s.terminals);
  const activeId = useTerminalStore((s) => s.activeId);
  const setActive = useTerminalStore((s) => s.setActive);
  const removeTerminal = useTerminalStore((s) => s.removeTerminal);

  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [scripts, setScripts] = useState<ScriptsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const openDropdown = useCallback(() => {
    setDropdownOpen(true);
    setLoading(true);
    fetchScripts()
      .then((r) => setScripts(r))
      .catch(() =>
        setScripts({ entries: [], warning: "Failed to load scripts" }),
      )
      .finally(() => setLoading(false));
  }, []);

  // Close on outside click.
  useEffect(() => {
    if (!dropdownOpen) return;
    const onClick = (e: MouseEvent) => {
      if (!dropdownRef.current) return;
      if (!dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    window.addEventListener("mousedown", onClick);
    return () => window.removeEventListener("mousedown", onClick);
  }, [dropdownOpen]);

  const handleNewShell = () => {
    setDropdownOpen(false);
    onRequestSpawn({
      id: crypto.randomUUID(),
      kind: "shell",
      title: "shell",
    });
  };

  const handlePickScript = (entry: ScriptEntry) => {
    setDropdownOpen(false);
    onRequestSpawn({
      id: crypto.randomUUID(),
      kind: "script",
      scriptName: entry.name,
      title: entry.name,
    });
  };

  const closeTab = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    removeTerminal(id);
  };

  return (
    <div className="flex h-8 items-center border-b border-border bg-bg-elevated px-1 text-[12px]">
      <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto">
        {terminals.map((t) => (
          <TabButton
            key={t.id}
            terminal={t}
            active={t.id === activeId}
            onClick={() => setActive(t.id)}
            onClose={(e) => closeTab(e, t.id)}
          />
        ))}
      </div>
      <div className="relative shrink-0" ref={dropdownRef}>
        <button
          type="button"
          onClick={dropdownOpen ? () => setDropdownOpen(false) : openDropdown}
          className="rounded px-2 py-0.5 text-fg-muted hover:bg-surface-hover hover:text-fg"
          aria-label="New terminal"
          title="New terminal"
        >
          +
        </button>
        {dropdownOpen && (
          <Dropdown
            loading={loading}
            scripts={scripts}
            onNewShell={handleNewShell}
            onPickScript={handlePickScript}
          />
        )}
      </div>
    </div>
  );
}

function TabButton({
  terminal,
  active,
  onClick,
  onClose,
}: {
  terminal: TerminalMeta;
  active: boolean;
  onClick(): void;
  onClose(e: React.MouseEvent): void;
}) {
  const exited = terminal.status === "exited";
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group flex shrink-0 items-center gap-1.5 rounded px-2 py-0.5 ${
        active
          ? "bg-surface-hover text-fg"
          : "text-fg-muted hover:bg-surface-hover/50"
      } ${exited ? "opacity-60" : ""}`}
      title={exited ? `exited (${terminal.exitCode ?? "?"})` : terminal.title}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${
        exited ? "bg-fg-subtle" : "bg-accent"
      }`} />
      <span className={`truncate ${exited ? "line-through" : ""}`}>
        {terminal.title}
      </span>
      <span
        role="button"
        aria-label={`Close ${terminal.title}`}
        tabIndex={-1}
        onClick={onClose}
        className="rounded px-1 text-fg-subtle opacity-0 hover:text-fg group-hover:opacity-100"
      >
        ×
      </span>
    </button>
  );
}

function Dropdown({
  loading,
  scripts,
  onNewShell,
  onPickScript,
}: {
  loading: boolean;
  scripts: ScriptsResponse | null;
  onNewShell(): void;
  onPickScript(e: ScriptEntry): void;
}) {
  const byGroup = (group: ScriptEntry["group"]) =>
    (scripts?.entries ?? []).filter((e) => e.group === group);

  return (
    <div className="absolute right-0 top-full z-50 mt-1 min-w-[260px] max-w-[420px] overflow-hidden rounded-md border border-border bg-bg-elevated shadow-soft">
      {scripts?.warning && (
        <div className="border-b border-border px-3 py-1.5 text-[11px] text-accent">
          ⚠ {scripts.warning}
        </div>
      )}
      <button
        type="button"
        onClick={onNewShell}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-fg hover:bg-surface-hover"
      >
        <span>New shell</span>
      </button>
      {loading && (
        <div className="px-3 py-1.5 text-[11px] text-fg-muted">Loading…</div>
      )}
      <DropdownGroup
        label="package.json scripts"
        entries={byGroup("package")}
        onPick={onPickScript}
      />
      <DropdownGroup
        label="Built-ins"
        entries={byGroup("builtin")}
        onPick={onPickScript}
      />
      <DropdownGroup
        label="User scripts"
        entries={byGroup("user")}
        onPick={onPickScript}
      />
    </div>
  );
}

function DropdownGroup({
  label,
  entries,
  onPick,
}: {
  label: string;
  entries: ScriptEntry[];
  onPick(e: ScriptEntry): void;
}) {
  if (entries.length === 0) return null;
  return (
    <div className="border-t border-border">
      <div className="px-3 py-1 text-[10px] uppercase tracking-wider text-fg-subtle">
        {label}
      </div>
      {entries.map((entry) => (
        <button
          key={`${entry.group}:${entry.name}`}
          type="button"
          onClick={() => onPick(entry)}
          className="flex w-full flex-col gap-0.5 px-3 py-1 text-left hover:bg-surface-hover"
        >
          <span className="text-fg">{entry.name}</span>
          <span className="truncate font-mono text-[10px] text-fg-subtle">
            {entry.command}
          </span>
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Typecheck**

Run: `bun run typecheck`
Expected: passes.

- [ ] **Step 4: Commit**

```bash
git add src/web/terminal/terminal-api.ts src/web/terminal/terminal-tab-strip.tsx
git commit -m "feat(terminal): add terminal tab strip with scripts dropdown"
```

---

## Task 13: Terminal drawer (lazy) and slot

**Files:**
- Create: `src/web/terminal/terminal-drawer.tsx`
- Create: `src/web/terminal/terminal-drawer-slot.tsx`

- [ ] **Step 1: Create the drawer body (lazy-loaded)**

```tsx
// src/web/terminal/terminal-drawer.tsx
// Lazy-loaded drawer body. Imports xterm.js and the pane/tab-strip which
// transitively import @xterm/xterm, so this whole file lives in a
// separate Vite code-split chunk loaded only when the drawer first opens.
import { useEffect, useMemo, useState } from "react";
import { useTerminalStore, type TerminalMeta } from "./terminal-store";
import { TerminalPane } from "./terminal-pane";
import { TerminalTabStrip } from "./terminal-tab-strip";
import { attachIds, sendFrame } from "./use-terminal-ws";
import { useSettings } from "../settings";

interface PendingSpawn {
  id: string;
  kind: "shell" | "script";
  scriptName?: string;
  title: string;
}

export default function TerminalDrawer() {
  const terminals = useTerminalStore((s) => s.terminals);
  const activeId = useTerminalStore((s) => s.activeId);
  const addTerminal = useTerminalStore((s) => s.addTerminal);
  const noticeAck = useSettings((s) => s.terminalNoticeAcknowledged);

  // Track which ids were spawned THIS mount (vs rehydrated from storage).
  // spawn-on-mount fires exactly once per id.
  const [justSpawned] = useState<Set<string>>(() => new Set());
  const [spawnRequests] = useState<Map<string, PendingSpawn>>(() => new Map());

  // On first mount, attach any persisted ids. If none, open a fresh shell
  // so the drawer isn't empty on first use.
  useEffect(() => {
    const persistedIds = useTerminalStore.getState().terminals.map((t) => t.id);
    if (persistedIds.length > 0) {
      attachIds(persistedIds);
    } else {
      const id = crypto.randomUUID();
      const req: PendingSpawn = { id, kind: "shell", title: "shell" };
      justSpawned.add(id);
      spawnRequests.set(id, req);
      addTerminal({ id, title: req.title, status: "running" });
    }
  }, [addTerminal, justSpawned, spawnRequests]);

  const handleRequestSpawn = (req: PendingSpawn) => {
    justSpawned.add(req.id);
    spawnRequests.set(req.id, req);
    addTerminal({
      id: req.id,
      title: req.title,
      scriptName: req.scriptName,
      status: "running",
    });
  };

  return (
    <div className="flex h-full w-full flex-col overflow-hidden border-t border-border bg-bg">
      {!noticeAck && <SafetyNotice />}
      <TerminalTabStrip onRequestSpawn={handleRequestSpawn} />
      <div className="relative min-h-0 flex-1">
        {terminals.map((t) => (
          <PaneSlot
            key={t.id}
            terminal={t}
            hidden={t.id !== activeId}
            spawnOnMount={justSpawned.has(t.id)}
            spawnRequest={spawnRequests.get(t.id)}
          />
        ))}
        {terminals.length === 0 && (
          <div className="flex h-full items-center justify-center text-[12px] text-fg-subtle">
            No terminals open.
          </div>
        )}
      </div>
    </div>
  );
}

function PaneSlot({
  terminal,
  hidden,
  spawnOnMount,
  spawnRequest,
}: {
  terminal: TerminalMeta;
  hidden: boolean;
  spawnOnMount: boolean;
  spawnRequest?: PendingSpawn;
}) {
  const pane = useMemo(() => {
    if (spawnOnMount && spawnRequest) {
      const req =
        spawnRequest.kind === "shell"
          ? { kind: "shell" as const }
          : {
              kind: "script" as const,
              scriptName: spawnRequest.scriptName!,
              title: spawnRequest.title,
            };
      return <TerminalPane id={terminal.id} spawnOnMount={true} spawnRequest={req} />;
    }
    return <TerminalPane id={terminal.id} spawnOnMount={false} />;
    // Intentionally omit spawnRequest/spawnOnMount from deps: we want the
    // pane to mount once per id.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [terminal.id]);

  return (
    <div
      className="absolute inset-0"
      style={hidden ? { visibility: "hidden", pointerEvents: "none" } : undefined}
    >
      {pane}
    </div>
  );
}

function SafetyNotice() {
  const ack = () => useSettings.getState().set({ terminalNoticeAcknowledged: true });
  return (
    <div className="flex items-start gap-3 border-b border-border bg-accent/10 px-3 py-2 text-[12px] text-fg">
      <span className="leading-tight">
        <strong>Heads up:</strong> Terminals in diffscope run real shell
        commands. The read-only guarantee in the README applies to the viewer,
        not this pane.
      </span>
      <button
        type="button"
        onClick={ack}
        className="ml-auto shrink-0 rounded border border-border bg-bg-elevated px-2 py-0.5 text-fg-muted hover:text-fg"
      >
        Got it
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Create the always-loaded slot with `React.lazy`**

```tsx
// src/web/terminal/terminal-drawer-slot.tsx
// Always-loaded shell that decides whether to render the drawer. Uses
// React.lazy so xterm.js and all terminal-side code are in a separate
// Vite chunk, loaded only when the drawer first opens.
import { Suspense, lazy } from "react";
import { useSettings } from "../settings";
import { usePaneDrag } from "../lib/use-pane-drag";

const TerminalDrawer = lazy(() => import("./terminal-drawer"));

const MIN_HEIGHT = 120;
const MAX_HEIGHT_FRACTION = 0.8;

function clampHeight(px: number): number {
  const max = Math.max(
    MIN_HEIGHT + 60,
    Math.floor(window.innerHeight * MAX_HEIGHT_FRACTION),
  );
  return Math.min(Math.max(px, MIN_HEIGHT), max);
}

export function TerminalDrawerSlot() {
  const open = useSettings((s) => s.terminalDrawerOpen);
  const { sizePx, dragging, onMouseDown, onDoubleClick } = usePaneDrag({
    axis: "y",
    settingsKey: "terminalDrawerHeightPx",
    clamp: clampHeight,
  });

  if (!open) return null;

  return (
    <div
      className="flex shrink-0 flex-col"
      style={{ height: sizePx }}
    >
      <div
        role="separator"
        aria-orientation="horizontal"
        onMouseDown={onMouseDown}
        onDoubleClick={onDoubleClick}
        className="group relative flex h-1 w-full shrink-0 cursor-row-resize items-center justify-center"
        title="Drag to resize, double-click to reset"
      >
        <div
          className={`h-px w-full transition-colors ${
            dragging ? "bg-accent" : "bg-border group-hover:bg-accent"
          }`}
        />
      </div>
      <div className="min-h-0 flex-1">
        <Suspense
          fallback={
            <div className="flex h-full items-center justify-center text-[12px] text-fg-subtle">
              Loading terminal…
            </div>
          }
        >
          <TerminalDrawer />
        </Suspense>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Wire the slot into `Layout`**

Edit `src/web/components/layout.tsx`. At the top of the file, add the import:

```tsx
import { TerminalDrawerSlot } from "../terminal/terminal-drawer-slot";
```

Replace the `<main>...</main>` block:

```tsx
      <main className="min-h-0 flex-1 overflow-hidden">{children}</main>
```

with a flex column that holds the main content on top and the drawer at the bottom:

```tsx
      <div className="flex min-h-0 flex-1 flex-col">
        <main className="min-h-0 flex-1 overflow-hidden">{children}</main>
        <TerminalDrawerSlot />
      </div>
```

- [ ] **Step 4: Typecheck**

Run: `bun run typecheck`
Expected: passes.

- [ ] **Step 5: Commit**

```bash
git add src/web/terminal/terminal-drawer.tsx src/web/terminal/terminal-drawer-slot.tsx src/web/components/layout.tsx
git commit -m "feat(terminal): add lazy terminal drawer + layout slot"
```

---

## Task 14: Keybindings, palette action, status bar badge, Vite proxy

**Files:**
- Modify: `src/web/components/shortcuts.tsx`
- Modify: `src/web/lib/actions.ts`
- Modify: `src/web/components/status-bar.tsx`
- Modify: `vite.config.ts`

- [ ] **Step 1: Add the terminal toggle action**

Edit `src/web/lib/actions.ts`. Add a new action that toggles `terminalDrawerOpen` in settings. The exact structure depends on the existing shape — read the file first and match the existing entries (e.g. `{ id, label, run }`).

Example entry (adapt to the actual PaletteAction shape):

```ts
{
  id: "terminal.toggle",
  label: "Terminal: Toggle Drawer",
  run: () => {
    const cur = useSettings.getState().terminalDrawerOpen;
    useSettings.getState().set({ terminalDrawerOpen: !cur });
  },
},
```

- [ ] **Step 2: Add keybindings to `shortcuts.tsx`**

Edit `src/web/components/shortcuts.tsx`. Inside the `handler` function, BEFORE the `if (inInput) return;` line, add the `` Ctrl/Cmd+` `` and `` Ctrl/Cmd+Shift+` `` handlers (they should work even inside inputs because the backtick key isn't typed often):

```tsx
      // Ctrl/Cmd+` toggles the terminal drawer.
      if ((e.metaKey || e.ctrlKey) && e.key === "`" && !e.shiftKey) {
        e.preventDefault();
        const cur = useSettings.getState().terminalDrawerOpen;
        useSettings.getState().set({ terminalDrawerOpen: !cur });
        return;
      }
      // Ctrl/Cmd+Shift+` opens the drawer (and will trigger a new shell
      // via the drawer's empty-state auto-spawn logic if no terminals exist).
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === "~") {
        e.preventDefault();
        useSettings.getState().set({ terminalDrawerOpen: true });
        return;
      }
```

Note: `Shift+\`` produces `~` on US layouts; detect via `e.key === "~"` instead of `e.key === "\``.

Add rows to `SHORTCUT_HELP`:

```ts
  { keys: "⌘` / ⌃`", description: "Toggle terminal drawer" },
  { keys: "⌘⇧` / ⌃⇧`", description: "Open terminal drawer (new shell)" },
```

- [ ] **Step 3: Add the terminal badge to the status bar**

Edit `src/web/components/status-bar.tsx`. At the top, add the import:

```tsx
import { useTerminalStore } from "../terminal/terminal-store";
import { useSettings } from "../settings";
```

Inside the `StatusBar` component, add:

```tsx
  const terminalCount = useTerminalStore((s) => s.terminals.length);
  const drawerOpen = useSettings((s) => s.terminalDrawerOpen);
  const toggleDrawer = () => {
    useSettings.getState().set({ terminalDrawerOpen: !drawerOpen });
  };
```

Then, inside the `<div className="ml-auto flex items-center gap-2">` block (right before the settings button), add:

```tsx
        {(terminalCount > 0 || drawerOpen) && (
          <button
            onClick={toggleDrawer}
            title={`Terminal (${terminalCount} open)`}
            aria-label="Toggle terminal drawer"
            className={`flex items-center gap-1 rounded px-1 ${
              drawerOpen ? "text-accent" : "text-fg-muted hover:text-fg"
            }`}
          >
            <span>⌨</span>
            <span className="tabular-nums">{terminalCount}</span>
          </button>
        )}
```

- [ ] **Step 4: Enable WebSocket proxy in Vite dev**

Edit `vite.config.ts`. Change:

```ts
  server: {
    proxy: {
      "/api": {
        target: "http://localhost:41111",
        changeOrigin: true,
        ws: false,
      },
    },
  },
```

to:

```ts
  server: {
    proxy: {
      "/api": {
        target: "http://localhost:41111",
        changeOrigin: true,
        ws: true,
      },
    },
  },
```

- [ ] **Step 5: Typecheck + lint**

Run: `bun run typecheck && bun run lint`
Expected: both pass.

- [ ] **Step 6: Commit**

```bash
git add src/web/components/shortcuts.tsx src/web/lib/actions.ts src/web/components/status-bar.tsx vite.config.ts
git commit -m "feat(terminal): add keybindings, palette action, status-bar badge, ws proxy"
```

---

## Task 15: Full-stack smoke test + manual verification

**Files:** none — verification only. This is the gate before writing README.

- [ ] **Step 1: Build the web bundle**

Run: `bun run build:web`
Expected: Vite builds without errors, outputs `dist/web/`, prints chunk sizes. The terminal drawer should appear as a separate lazy chunk (xterm.js is ~200 KB gzipped).

- [ ] **Step 2: Start the server in a test repo**

Run: `bun run src/server/cli.ts .`
Expected: diffscope opens in browser, main UI loads, no console errors. Hit `` Cmd+` `` — drawer opens at the bottom, shows a "Heads up" notice once, auto-spawns a shell tab titled "shell". `pwd` in the shell should print the repo root.

- [ ] **Step 3: Run through the spec's §10.3 manual checklist**

For each item, verify it works. If an item fails, fix the underlying code (this may loop back through earlier tasks) before checking it off.

1. Open diffscope on a repo, hit `` Cmd+` `` → drawer opens with a fresh shell → `pwd` returns repo root. [ ]
2. `+ → dev` (or whatever the first package.json script is) → new tab, output streams live. [ ]
3. Resize drawer via the drag handle → `stty size` reflects the new dimensions. [ ]
4. Reload the browser tab → drawer reopens, both tabs reattach, scrollback replays, long-running processes still running. [ ]
5. Exit a running process (`Ctrl+C` a `sleep 30`) → tab stays visible with an "exited" marker, scrollback still scrollable. [ ]
6. Close the exited tab via `×` → it disappears from the strip. [ ]
7. `vim README.md` in a shell tab → full-screen editor draws correctly, arrow keys work, `:q` returns cleanly. (Real PTY smoke test.) [ ]
8. Switch themes via settings → terminal colors update to match. [ ]
9. Quit diffscope (`Ctrl+C` in the launching terminal) → all child processes die, verified with `ps aux | grep <something-the-test-terminal-was-running>`. [ ]

If all nine pass, verification is done. If any fails:
- Diagnose the root cause.
- Fix it in the appropriate earlier file.
- Re-run `bun test` and `bun run typecheck` before re-running the failing step.

- [ ] **Step 4: Dev-mode smoke test (Vite HMR path)**

Stop the server from Step 2.
Run in terminal 1: `DIFFSCOPE_DEV_PORT=41111 bun run --hot src/server/cli.ts .`
Run in terminal 2: `bun run dev:web`

Open http://localhost:5173 — the Vite dev server should proxy the WebSocket successfully. Open the drawer, spawn a shell, confirm input/output works. This verifies Task 14's `ws: true` proxy change.

- [ ] **Step 5: Stop dev servers and commit any fixes**

Stop both dev servers.
If Step 3 or Step 4 turned up fixes, commit them with a descriptive message like `fix(terminal): <specific issue>`.
If everything passed cleanly on the first try, no new commit needed for this task.

---

## Task 16: README update

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add a Terminal section**

Edit `README.md`. Find the `## Features` block (around line 37) and add a new bullet right after the existing features:

```markdown
- **Integrated terminal** — VSCode-style bottom drawer with multiple tabs, backed by a real PTY. Run any shell command, `vim`, `htop`, dev servers, etc. Predefined scripts dropdown pulls from `package.json` scripts, built-ins, and an optional `.diffscope/scripts.json`. Toggle with `` Ctrl/Cmd+` ``. Terminals survive browser reloads.
```

Then update the `## Scope` section. Find:

```markdown
## Scope

- Read-only. No staging, committing, or destructive actions.
- Works on any local git repo.
- Live updates via filesystem watcher — file edits, staging, commits, branch checkouts, stashes, `.gitignore` changes.
```

Change the first bullet to:

```markdown
## Scope

- **Viewer is read-only.** The diff/history/branches/stashes UI never stages, commits, or performs destructive actions.
- **The integrated terminal is a real shell.** Anything you can run in your terminal you can run in diffscope's terminal drawer, including destructive commands. This is an explicit opt-in: on first use, the drawer shows a one-time notice. If you want diffscope to stay purely observational, simply don't open the terminal.
- Works on any local git repo.
- Live updates via filesystem watcher — file edits, staging, commits, branch checkouts, stashes, `.gitignore` changes.
```

Add a "Shortcuts" row for the new keybinding. Find the existing shortcut list near the top:

```markdown
- **Keyboard shortcuts** — `j/k` between files, `Tab` between tabs, `u` toggle unified/split, `/` filter, `p` pause, `?` help
```

Change to:

```markdown
- **Keyboard shortcuts** — `j/k` between files, `Tab` between tabs, `u` toggle unified/split, `/` filter, `p` pause, `` Ctrl/Cmd+` `` toggle terminal, `?` help
```

- [ ] **Step 2: Add a `.diffscope/scripts.json` example block**

After the `## Features` section, add a new section:

```markdown
## Custom terminal scripts

Create `.diffscope/scripts.json` in your repo to add custom entries to the terminal's `+` dropdown:

\`\`\`json
{
  "scripts": [
    { "name": "dev + watcher", "command": "bun run dev & bun run watch" },
    { "name": "lint staged", "command": "bunx lint-staged" }
  ]
}
\`\`\`

User scripts override `package.json` scripts and built-ins if the names collide.
```

(Replace the backtick-escaped fences with real triple backticks when editing — they can't be nested in the plan text.)

- [ ] **Step 3: Run tests + typecheck + lint one final time**

Run: `bun test && bun run typecheck && bun run lint`
Expected: everything passes.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: document integrated terminal feature"
```

---

## Spec Coverage Check

Before declaring the plan done, confirm every §2 decision from the spec is covered by at least one task:

| Decision | Implemented in |
|---|---|
| 1. Bottom drawer with tab strip + multiple terminals | Tasks 12, 13 |
| 2. Real PTY via node-pty (gated spike first) | Tasks 1, 5 |
| 3. Persist across reload via attach+replay, die with backend | Tasks 5, 6, 9, 10, 13 |
| 4. Scripts merged: built-ins ∪ package.json ∪ .diffscope/scripts.json, user wins | Task 4 |
| 5. + button dropdown for scripts | Task 12 |
| 6. Exited tabs stay visible with marker | Task 11 (onExit handler), Task 12 (TabButton styling) |
| 7. 1 MiB scrollback cap | Task 5 |
| 8. Dedicated WebSocket at /api/terminal/ws | Tasks 6, 7 |
| 9. $SHELL -l default | Task 6 (ws.ts spawn handler) |
| 10. crypto.randomUUID() session ids, no new dep | Tasks 5, 12 |
| 11. First-time safety notice | Task 13 (SafetyNotice component) |

All 11 decisions are covered. Spec sections §10.3 (manual verification) is Task 15. Spec §9 (risks) is addressed — Task 1 is the spike gate, Task 7 step 4 handles the zombie case via `terminalModule.shutdown()` on /api/open swap, Task 5 scrollback test covers §9.3, Task 13 uses React.lazy for §9.4.

---

**Plan complete and saved to `docs/superpowers/plans/2026-04-09-embedded-terminal.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — execute tasks in this session using executing-plans, batch execution with checkpoints.

**Which approach?**
