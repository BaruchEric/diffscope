# File Explorer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an "Explore" mode to the Working Tree sidebar so users can browse the entire working directory and view any file's content, not just changed files.

**Architecture:** New backend endpoints (`/api/tree`, `/api/file`) produce full working-tree listings and raw file bytes; the watcher emits a new `tree-updated` SSE event. The frontend gains a `FileExplorer` component that renders alongside the existing `FileTree`, gated by a new `workingTreeMode` setting. `DiffView` gains a `fileViewMode` prop so unchanged files render via the existing Shiki/image/binary pipeline with the +/- gutter hidden. `buildTreeFromPaths` is extracted into `src/web/lib/tree.ts` and shared between `FileTree` and `FileExplorer`.

**Tech Stack:** Bun (server + test runner), TypeScript, React, Zustand (store + settings), Tailwind, Shiki, Vitest-style `bun:test`.

**Reference spec:** `docs/superpowers/specs/2026-04-09-file-explorer-design.md`

---

## File structure

**New files**

| File | Responsibility |
|---|---|
| `src/server/tree.ts` | `listTree(repoRoot, { hideIgnored })` + `readFile(repoRoot, relPath)` — filesystem + git ls-files + path safety + binary/image/large detection. |
| `src/web/lib/tree.ts` | Generic `buildTreeFromPaths<T>`, `flattenVisible<T>`, `collectAncestorDirs`, `collectAllDirs<T>` — shared tree primitives. |
| `src/web/components/file-explorer.tsx` | `FileExplorer` component — renders the full working-directory tree. |
| `test/tree.test.ts` | Backend tests for `listTree`, `readFile`, path safety, binary heuristic. |
| `test/http-tree.test.ts` | HTTP integration tests for `/api/tree` + `/api/file`. |
| `test/tree-lib.test.ts` | Unit tests for `buildTreeFromPaths` / `flattenVisible` / `collectAncestorDirs`. |

**Modified files**

| File | What changes |
|---|---|
| `src/shared/types.ts` | Add `FsEntry`, `FileContents`, extend `SseEvent` with `tree-updated`. |
| `src/server/http.ts` | Add `/api/tree` and `/api/file` routes. |
| `src/server/events.ts` | Track `exploreEntries` snapshot; emit `tree-updated` on working-tree-changed/gitignore-changed. |
| `src/web/lib/api.ts` | Add `tree(hideIgnored)` and `file(path)` client methods. |
| `src/web/lib/sse-client.ts` | No change — existing generic `SseEvent` handler already forwards new event types. |
| `src/web/settings.ts` | Add `workingTreeMode` and `hideIgnored` fields + defaults. |
| `src/web/store.ts` | Add `exploreEntries`, `viewingFile`, `focusExploreFile`, and SSE `tree-updated` handling. |
| `src/web/components/file-tree.tsx` | Replace inlined tree helpers with imports from `@/web/lib/tree`. |
| `src/web/components/file-list.tsx` | Add Changes/Explore segmented toggle; render `FileExplorer` in explore mode. |
| `src/web/components/diff-view.tsx` | Add `fileViewMode` prop + rendering branch. |
| `src/web/components/shortcuts.tsx` | Add `e` toggle, generalize `navigateSibling` for explore mode. |
| `src/web/components/command-palette.tsx` | Add "Toggle Explorer" and "Toggle hide ignored" entries. |
| `src/web/components/status-bar.tsx` | Read-only "viewing" line when `viewingFile` is set. |
| `README.md` | Document Explore mode in the Features list. |

---

## Task 1: Shared types

**Files:**
- Modify: `src/shared/types.ts`

- [ ] **Step 1: Add `FsEntry` and `FileContents` types, extend `SseEvent`**

At the bottom of `src/shared/types.ts` (but before/with other exports), add:

```ts
/**
 * A single entry in the working-tree listing served by /api/tree.
 * Directories are synthesized from file paths; see src/server/tree.ts.
 */
export interface FsEntry {
  /** Repo-root-relative, POSIX separators. */
  path: string;
  isDir: boolean;
  /** Files only. Omitted for directories. */
  size?: number;
}

/**
 * Server response for /api/file. Images transport as base64 so the whole
 * response shape stays JSON; clients decode to an object URL.
 */
export type FileContents =
  | { kind: "text"; content: string }
  | { kind: "image"; mime: string; base64: string }
  | { kind: "binary"; size: number }
  | { kind: "tooLarge"; size: number };
```

Then extend the `SseEvent` discriminated union by adding one more arm:

```ts
  | { type: "tree-updated"; entries: FsEntry[] }
```

The final `SseEvent` type (for reference) must include this arm alongside the existing ones.

- [ ] **Step 2: Typecheck passes**

Run: `bun run tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/shared/types.ts
git commit -m "feat(types): FsEntry, FileContents, tree-updated SSE event"
```

---

## Task 2: `src/server/tree.ts` — `listTree` (TDD, hideIgnored=true path)

**Files:**
- Create: `src/server/tree.ts`
- Create: `test/tree.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/tree.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createTempRepo, type TempRepo } from "./helpers/temp-repo";
import { listTree, readFile } from "../src/server/tree";

describe("listTree (hideIgnored=true)", () => {
  let temp: TempRepo;
  beforeEach(() => {
    temp = createTempRepo();
  });
  afterEach(() => {
    temp.cleanup();
  });

  test("returns tracked + untracked files, excludes gitignored", async () => {
    temp.write(".gitignore", "ignored.txt\nnode_modules/\n");
    temp.write("a.ts", "a\n");
    temp.write("src/b.ts", "b\n");
    temp.write("ignored.txt", "secret\n");
    temp.write("node_modules/pkg/index.js", "pkg\n");
    temp.git("add", "a.ts", "src/b.ts", ".gitignore");
    temp.git("commit", "-m", "init");
    temp.write("untracked.md", "new\n");

    const entries = await listTree(temp.root, { hideIgnored: true });
    const paths = entries.map((e) => e.path).sort();

    expect(paths).toContain("a.ts");
    expect(paths).toContain("src/b.ts");
    expect(paths).toContain(".gitignore");
    expect(paths).toContain("untracked.md");
    expect(paths).not.toContain("ignored.txt");
    expect(paths).not.toContain("node_modules/pkg/index.js");
  });

  test("synthesizes directory entries from file paths", async () => {
    temp.write("src/web/app.tsx", "x\n");
    temp.write("src/server/cli.ts", "y\n");
    temp.git("add", ".");
    temp.git("commit", "-m", "init");

    const entries = await listTree(temp.root, { hideIgnored: true });
    const dirs = entries.filter((e) => e.isDir).map((e) => e.path).sort();

    expect(dirs).toEqual(["src", "src/server", "src/web"]);
  });

  test("never includes .git entries", async () => {
    temp.write("a.ts", "a\n");
    temp.git("add", ".");
    temp.git("commit", "-m", "init");

    const entries = await listTree(temp.root, { hideIgnored: true });
    expect(entries.some((e) => e.path === ".git" || e.path.startsWith(".git/"))).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests — confirm failure**

Run: `bun test test/tree.test.ts`
Expected: module not found error for `../src/server/tree`.

- [ ] **Step 3: Implement `listTree` hideIgnored=true path**

Create `src/server/tree.ts`:

```ts
// src/server/tree.ts
// Full working-tree listing and raw file contents for the Explore mode.
//
// listTree returns a flat list of entries. Directory entries are synthesized
// from the observed file paths — callers (the frontend tree builder) split on
// "/" anyway, so we don't need to separately enumerate directories.
//
// readFile is deliberately narrow: path-safety enforced, image / binary /
// too-large detection server-side. Diffscope remains read-only — there is no
// counterpart write API.
import { spawn } from "node:child_process";
import { readdir, stat, lstat, readFile as fsReadFile } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";
import type { FsEntry, FileContents } from "../shared/types";

/**
 * Enumerate the working tree.
 *
 * hideIgnored=true uses `git ls-files --cached --others --exclude-standard`
 * so gitignored paths (node_modules, dist, …) are skipped without a separate
 * ignore parser. hideIgnored=false does a plain filesystem walk, skipping
 * only `.git` — matches the "everything on disk" mode the Explore toggle
 * advertises.
 */
export async function listTree(
  repoRoot: string,
  opts: { hideIgnored: boolean },
): Promise<FsEntry[]> {
  if (opts.hideIgnored) {
    const files = await gitListFiles(repoRoot);
    return synthesizeEntries(files);
  }
  return walkDisk(repoRoot);
}

function gitListFiles(repoRoot: string): Promise<string[]> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(
      "git",
      ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
      { cwd: repoRoot },
    );
    const chunks: Buffer[] = [];
    const errChunks: Buffer[] = [];
    child.stdout.on("data", (c: Buffer) => chunks.push(c));
    child.stderr.on("data", (c: Buffer) => errChunks.push(c));
    child.on("error", rejectPromise);
    child.on("close", (code) => {
      if (code !== 0) {
        rejectPromise(new Error(Buffer.concat(errChunks).toString("utf8") || `git ls-files exited ${code}`));
        return;
      }
      const raw = Buffer.concat(chunks).toString("utf8");
      // -z uses NUL separators; trailing NUL produces an empty string we drop.
      const paths = raw.split("\0").filter((p) => p.length > 0);
      resolvePromise(paths);
    });
  });
}

/**
 * Turn a flat list of file paths into a flat list of FsEntry (files +
 * synthesized directories). The tree-builder on the frontend expects both
 * kinds. No attempt to backfill sizes for ls-files paths — the Explorer
 * doesn't show sizes in the row UI; sizes are only populated by walkDisk
 * where we already have them for free from readdir+lstat.
 */
function synthesizeEntries(files: string[]): FsEntry[] {
  const dirs = new Set<string>();
  for (const f of files) {
    const parts = f.split("/");
    for (let i = 1; i < parts.length; i++) {
      dirs.add(parts.slice(0, i).join("/"));
    }
  }
  const out: FsEntry[] = [];
  for (const d of dirs) out.push({ path: d, isDir: true });
  for (const f of files) out.push({ path: f, isDir: false });
  return out;
}

async function walkDisk(repoRoot: string): Promise<FsEntry[]> {
  const out: FsEntry[] = [];
  const rootAbs = resolve(repoRoot);
  const walk = async (absDir: string, relDir: string): Promise<void> => {
    let dirents;
    try {
      dirents = await readdir(absDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const d of dirents) {
      if (relDir === "" && d.name === ".git") continue;
      const abs = join(absDir, d.name);
      const rel = relDir ? `${relDir}/${d.name}` : d.name;
      // lstat: never follow symlinks — treat them as leaf entries at their
      // link location so we don't walk out of the repo via a cheeky link.
      let st;
      try {
        st = await lstat(abs);
      } catch {
        continue;
      }
      if (st.isSymbolicLink()) {
        out.push({ path: rel, isDir: false, size: st.size });
        continue;
      }
      if (st.isDirectory()) {
        out.push({ path: rel, isDir: true });
        await walk(abs, rel);
        continue;
      }
      if (st.isFile()) {
        out.push({ path: rel, isDir: false, size: st.size });
      }
    }
  };
  await walk(rootAbs, "");
  return out;
}

// Placeholder — implemented in Task 3.
export async function readFile(
  _repoRoot: string,
  _relPath: string,
): Promise<FileContents> {
  throw new Error("readFile not implemented");
}
```

- [ ] **Step 4: Run tests — confirm green**

Run: `bun test test/tree.test.ts`
Expected: 3 passing tests in `listTree (hideIgnored=true)`.

- [ ] **Step 5: Commit**

```bash
git add src/server/tree.ts test/tree.test.ts
git commit -m "feat(server/tree): listTree hideIgnored=true via git ls-files"
```

---

## Task 3: `listTree` hideIgnored=false + symlink handling

**Files:**
- Modify: `test/tree.test.ts`

- [ ] **Step 1: Add failing tests**

Append to the existing `describe("listTree", ...)` section in `test/tree.test.ts`, or add a new `describe` block:

```ts
import { symlinkSync } from "node:fs";

describe("listTree (hideIgnored=false)", () => {
  let temp: TempRepo;
  beforeEach(() => {
    temp = createTempRepo();
  });
  afterEach(() => {
    temp.cleanup();
  });

  test("includes gitignored files", async () => {
    temp.write(".gitignore", "secret.txt\n");
    temp.write("a.ts", "a\n");
    temp.write("secret.txt", "shh\n");
    temp.git("add", "a.ts", ".gitignore");
    temp.git("commit", "-m", "init");

    const entries = await listTree(temp.root, { hideIgnored: false });
    const paths = entries.map((e) => e.path).sort();

    expect(paths).toContain("a.ts");
    expect(paths).toContain("secret.txt");
  });

  test("skips .git directory", async () => {
    temp.write("a.ts", "a\n");
    temp.git("add", ".");
    temp.git("commit", "-m", "init");

    const entries = await listTree(temp.root, { hideIgnored: false });
    expect(entries.some((e) => e.path === ".git" || e.path.startsWith(".git/"))).toBe(false);
  });

  test("treats symlinks as leaf entries without following", async () => {
    temp.write("real.txt", "real\n");
    symlinkSync("real.txt", join(temp.root, "link.txt"));
    temp.git("add", ".");
    temp.git("commit", "-m", "init");

    const entries = await listTree(temp.root, { hideIgnored: false });
    const link = entries.find((e) => e.path === "link.txt");
    expect(link).toBeDefined();
    expect(link!.isDir).toBe(false);
  });

  test("populates size for regular files", async () => {
    temp.write("a.ts", "abcdef\n");
    temp.git("add", ".");
    temp.git("commit", "-m", "init");

    const entries = await listTree(temp.root, { hideIgnored: false });
    const a = entries.find((e) => e.path === "a.ts");
    expect(a?.size).toBe(7); // 6 chars + newline
  });
});
```

Add the `join` import at the top of `test/tree.test.ts` if not already there:

```ts
import { join } from "node:path";
```

- [ ] **Step 2: Run — confirm passing**

Run: `bun test test/tree.test.ts`
Expected: all 7 tests pass. (The `walkDisk` implementation was already written in Task 2.)

- [ ] **Step 3: Commit**

```bash
git add test/tree.test.ts
git commit -m "test(tree): hideIgnored=false, symlinks, sizes"
```

---

## Task 4: `readFile` path safety (TDD)

**Files:**
- Modify: `src/server/tree.ts`
- Modify: `test/tree.test.ts`

- [ ] **Step 1: Add failing path-safety tests**

Append to `test/tree.test.ts`:

```ts
describe("readFile path safety", () => {
  let temp: TempRepo;
  beforeEach(() => {
    temp = createTempRepo();
  });
  afterEach(() => {
    temp.cleanup();
  });

  test("reads a normal text file", async () => {
    temp.write("a.ts", "hello\n");
    temp.git("add", ".");
    temp.git("commit", "-m", "init");

    const result = await readFile(temp.root, "a.ts");
    expect(result.kind).toBe("text");
    if (result.kind === "text") expect(result.content).toBe("hello\n");
  });

  test("rejects .. traversal", async () => {
    await expect(readFile(temp.root, "../etc/passwd")).rejects.toThrow(/invalid path/i);
  });

  test("rejects absolute paths", async () => {
    await expect(readFile(temp.root, "/etc/passwd")).rejects.toThrow(/invalid path/i);
  });

  test("rejects NUL in path", async () => {
    await expect(readFile(temp.root, "a\0b")).rejects.toThrow(/invalid path/i);
  });

  test("rejects symlinks escaping the repo root", async () => {
    temp.write("a.ts", "a\n");
    symlinkSync("/etc/passwd", join(temp.root, "escape.txt"));
    temp.git("add", ".");
    temp.git("commit", "-m", "init");

    await expect(readFile(temp.root, "escape.txt")).rejects.toThrow(/invalid path/i);
  });
});
```

- [ ] **Step 2: Run — confirm failure**

Run: `bun test test/tree.test.ts`
Expected: 5 failing `readFile path safety` tests (the placeholder `readFile` throws "not implemented").

- [ ] **Step 3: Implement path-safe `readFile` (text-only for now)**

Replace the placeholder `readFile` in `src/server/tree.ts`:

```ts
/**
 * Path safety is enforced in three layers, because each catches a different
 * class of attack:
 *
 *   1. Reject obvious bad inputs before touching the filesystem (absolute,
 *      `..`, NUL).
 *   2. Resolve the requested path, confirm it still starts with the resolved
 *      repo root. Catches Windows-style traversals and cases where the
 *      join/resolve produces something surprising.
 *   3. lstat + realpath: if any component of the path is a symlink whose
 *      target lives outside the repo root, reject. Catches escape-via-link.
 *
 * readFile returns a tagged union so the HTTP layer can JSON-serialize a
 * single shape regardless of file kind.
 */
export async function readFile(
  repoRoot: string,
  relPath: string,
): Promise<FileContents> {
  if (!isRelPathSafe(relPath)) throw new Error("invalid path");

  const rootAbs = resolve(repoRoot);
  const target = resolve(rootAbs, relPath);
  if (target !== rootAbs && !target.startsWith(rootAbs + sep)) {
    throw new Error("invalid path");
  }
  // If the target is a symlink, follow it and confirm the resolved location
  // is still inside the repo.
  let linkSt;
  try {
    linkSt = await lstat(target);
  } catch {
    throw new Error("not found");
  }
  if (linkSt.isSymbolicLink()) {
    // Resolve the link target and re-check containment.
    let resolved;
    try {
      resolved = resolve(target, "..", await (await import("node:fs/promises")).readlink(target));
    } catch {
      throw new Error("invalid path");
    }
    if (resolved !== rootAbs && !resolved.startsWith(rootAbs + sep)) {
      throw new Error("invalid path");
    }
  }

  // Real file stat (follows symlink — safe now, because we verified the
  // link target is inside the repo).
  let st;
  try {
    st = await stat(target);
  } catch {
    throw new Error("not found");
  }
  if (!st.isFile()) throw new Error("not a file");

  const content = await fsReadFile(target, "utf8");
  return { kind: "text", content };
}

function isRelPathSafe(path: string): boolean {
  if (!path) return false;
  if (path.startsWith("/")) return false;
  if (path.includes("\0")) return false;
  for (const seg of path.split(/[\\/]/)) {
    if (seg === "..") return false;
  }
  return true;
}
```

- [ ] **Step 4: Run — confirm green**

Run: `bun test test/tree.test.ts`
Expected: all tests pass (7 listTree + 5 readFile = 12).

- [ ] **Step 5: Commit**

```bash
git add src/server/tree.ts test/tree.test.ts
git commit -m "feat(server/tree): readFile with path safety, text kind"
```

---

## Task 5: `readFile` — image, binary, too-large branches

**Files:**
- Modify: `src/server/tree.ts`
- Modify: `test/tree.test.ts`

- [ ] **Step 1: Add failing tests for image / binary / tooLarge**

Append to `test/tree.test.ts`:

```ts
import { writeFileSync } from "node:fs";

describe("readFile kinds", () => {
  let temp: TempRepo;
  beforeEach(() => {
    temp = createTempRepo();
  });
  afterEach(() => {
    temp.cleanup();
  });

  test("image extension → image kind", async () => {
    const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    writeFileSync(join(temp.root, "logo.png"), pngBytes);
    temp.git("add", ".");
    temp.git("commit", "-m", "init");

    const result = await readFile(temp.root, "logo.png");
    expect(result.kind).toBe("image");
    if (result.kind === "image") {
      expect(result.mime).toBe("image/png");
      expect(result.base64).toBe(pngBytes.toString("base64"));
    }
  });

  test("NUL byte in first 8KB → binary kind", async () => {
    const buf = Buffer.alloc(100);
    buf.write("hello");
    buf[50] = 0;
    writeFileSync(join(temp.root, "data.bin"), buf);
    temp.git("add", ".");
    temp.git("commit", "-m", "init");

    const result = await readFile(temp.root, "data.bin");
    expect(result.kind).toBe("binary");
    if (result.kind === "binary") expect(result.size).toBe(100);
  });

  test("file above size limit → tooLarge kind", async () => {
    // 3 MB of "a" — above the 2 MB threshold.
    const big = "a".repeat(3 * 1024 * 1024);
    writeFileSync(join(temp.root, "big.txt"), big);
    temp.git("add", ".");
    temp.git("commit", "-m", "init");

    const result = await readFile(temp.root, "big.txt");
    expect(result.kind).toBe("tooLarge");
    if (result.kind === "tooLarge") expect(result.size).toBe(3 * 1024 * 1024);
  });
});
```

- [ ] **Step 2: Run — confirm failure**

Run: `bun test test/tree.test.ts`
Expected: 3 failing tests in `readFile kinds`.

- [ ] **Step 3: Extend `readFile` with image/binary/tooLarge branches**

In `src/server/tree.ts`, add these constants near the top of the file (after the imports):

```ts
/** 2 MB cap before we bail out with `tooLarge`. Matches the spirit of the
 *  existing DiffView large-hunk threshold — anything bigger is not useful
 *  to scroll in-browser and should open in the user's editor instead. */
const LARGE_FILE_LIMIT = 2 * 1024 * 1024;

/** Number of head bytes inspected for the NUL-byte heuristic. 8 KB is the
 *  same slice git uses for its own binary detection. */
const BINARY_PROBE_BYTES = 8192;

const IMAGE_MIME_BY_EXT: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".bmp": "image/bmp",
  ".ico": "image/x-icon",
};
```

Then replace the body of `readFile` — after the path-safety + stat block and before the `fsReadFile(target, "utf8")` call — with branching on kind:

```ts
  // (After the existing path-safety, symlink, and stat checks, with `st`
  //  bound to the real fs.Stats result.)

  if (st.size > LARGE_FILE_LIMIT) {
    return { kind: "tooLarge", size: st.size };
  }

  const ext = extname(target).toLowerCase();
  const imageMime = IMAGE_MIME_BY_EXT[ext];
  if (imageMime) {
    const bytes = await fsReadFile(target);
    return { kind: "image", mime: imageMime, base64: bytes.toString("base64") };
  }

  // Read once, inspect the head for NUL, then either return binary or
  // decode as UTF-8. Cheaper than two reads and safe for files <= 2 MB.
  const bytes = await fsReadFile(target);
  const probeLen = Math.min(bytes.length, BINARY_PROBE_BYTES);
  for (let i = 0; i < probeLen; i++) {
    if (bytes[i] === 0) {
      return { kind: "binary", size: st.size };
    }
  }
  return { kind: "text", content: bytes.toString("utf8") };
```

Remove the previous `const content = await fsReadFile(target, "utf8"); return { kind: "text", content };` lines — the new code replaces them.

- [ ] **Step 4: Run — confirm green**

Run: `bun test test/tree.test.ts`
Expected: all tests pass (12 + 3 = 15).

- [ ] **Step 5: Commit**

```bash
git add src/server/tree.ts test/tree.test.ts
git commit -m "feat(server/tree): readFile image/binary/tooLarge branches"
```

---

## Task 6: HTTP routes `/api/tree` and `/api/file`

**Files:**
- Modify: `src/server/http.ts`
- Create: `test/http-tree.test.ts`

- [ ] **Step 1: Write the failing HTTP test**

Create `test/http-tree.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createTempRepo, type TempRepo } from "./helpers/temp-repo";
import { startHttpServer, type StartedServer } from "../src/server/http";
import type { FsEntry, FileContents } from "../src/shared/types";

describe("HTTP: /api/tree + /api/file", () => {
  let temp: TempRepo;
  let server: StartedServer;
  let port: number;

  beforeEach(async () => {
    temp = createTempRepo();
    temp.write("a.ts", "hello\n");
    temp.write(".gitignore", "ignored.txt\n");
    temp.write("ignored.txt", "secret\n");
    temp.git("add", "a.ts", ".gitignore");
    temp.git("commit", "-m", "init");

    port = 41200 + Math.floor(Math.random() * 500);
    server = await startHttpServer({
      repoPath: temp.root,
      staticDir: "/tmp/does-not-exist",
      port,
    });
  });
  afterEach(async () => {
    await server.stop();
    temp.cleanup();
  });

  test("GET /api/tree?hideIgnored=1 returns entries", async () => {
    const res = await fetch(`http://localhost:${port}/api/tree?hideIgnored=1`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { entries: FsEntry[] };
    const paths = body.entries.map((e) => e.path);
    expect(paths).toContain("a.ts");
    expect(paths).not.toContain("ignored.txt");
  });

  test("GET /api/tree?hideIgnored=0 includes gitignored", async () => {
    const res = await fetch(`http://localhost:${port}/api/tree?hideIgnored=0`);
    const body = (await res.json()) as { entries: FsEntry[] };
    const paths = body.entries.map((e) => e.path);
    expect(paths).toContain("ignored.txt");
  });

  test("GET /api/file returns text contents", async () => {
    const res = await fetch(`http://localhost:${port}/api/file?path=a.ts`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as FileContents;
    expect(body.kind).toBe("text");
    if (body.kind === "text") expect(body.content).toBe("hello\n");
  });

  test("GET /api/file rejects invalid path with 400", async () => {
    const res = await fetch(`http://localhost:${port}/api/file?path=../etc/passwd`);
    expect(res.status).toBe(400);
  });

  test("GET /api/file 404 for missing file", async () => {
    const res = await fetch(`http://localhost:${port}/api/file?path=nope.ts`);
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run — confirm failure**

Run: `bun test test/http-tree.test.ts`
Expected: 5 failing tests (404 on `/api/tree`/`/api/file`).

- [ ] **Step 3: Add routes to `src/server/http.ts`**

Near the top of the file, add a new import alongside the existing repo imports:

```ts
import { listTree, readFile as readTreeFile } from "./tree";
```

Inside the `handle` function, after the `/api/blob` block and before the "Static SPA fallback" comment, add:

```ts
    if (pathname === "/api/tree") {
      if (!repo) return json({ error: "no repo loaded" }, 400);
      const hideIgnored = url.searchParams.get("hideIgnored") !== "0";
      try {
        const entries = await listTree(repo.cwd, { hideIgnored });
        return json({ entries });
      } catch (err) {
        return errorResponse(err);
      }
    }

    if (pathname === "/api/file") {
      if (!repo) return json({ error: "no repo loaded" }, 400);
      const path = url.searchParams.get("path");
      if (!path) return json({ error: "path required" }, 400);
      // Reuse the existing isRepoRelPathSafe gate for the obvious cases —
      // readTreeFile has its own deeper check but failing early gives a
      // clean 400 instead of a generic error.
      if (!isRepoRelPathSafe(path)) return json({ error: "invalid path" }, 400);
      try {
        const contents = await readTreeFile(repo.cwd, path);
        return json(contents);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (/not found|ENOENT/i.test(msg)) return json({ error: msg }, 404);
        if (/invalid path/i.test(msg)) return json({ error: msg }, 400);
        return errorResponse(err);
      }
    }
```

- [ ] **Step 4: Run — confirm green**

Run: `bun test test/http-tree.test.ts`
Expected: all 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/server/http.ts test/http-tree.test.ts
git commit -m "feat(server/http): /api/tree and /api/file routes"
```

---

## Task 7: SSE `tree-updated` event from watcher

**Files:**
- Modify: `src/server/events.ts`
- Modify: `test/http-tree.test.ts`

- [ ] **Step 1: Write the failing SSE test**

At the bottom of `test/http-tree.test.ts`, add:

```ts
describe("SSE: tree-updated", () => {
  let temp: TempRepo;
  let server: StartedServer;
  let port: number;

  beforeEach(async () => {
    temp = createTempRepo();
    temp.write("a.ts", "a\n");
    temp.git("add", ".");
    temp.git("commit", "-m", "init");

    port = 41700 + Math.floor(Math.random() * 200);
    server = await startHttpServer({
      repoPath: temp.root,
      staticDir: "/tmp/does-not-exist",
      port,
    });
  });
  afterEach(async () => {
    await server.stop();
    temp.cleanup();
  });

  test("emits tree-updated when a new file appears", async () => {
    // Open SSE, then touch the working tree and wait for the event.
    const controller = new AbortController();
    const res = await fetch(`http://localhost:${port}/api/stream`, {
      signal: controller.signal,
    });
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();

    let saw = false;
    const timer = setTimeout(() => controller.abort(), 4000);
    // Small delay so the watcher is fully subscribed before we mutate.
    await new Promise((r) => setTimeout(r, 500));
    temp.write("b.ts", "b\n");

    try {
      while (!saw) {
        const { value, done } = await reader.read();
        if (done) break;
        const text = decoder.decode(value);
        for (const line of text.split("\n")) {
          if (!line.startsWith("data:")) continue;
          try {
            const event = JSON.parse(line.slice(5).trim());
            if (event.type === "tree-updated") {
              const paths = (event.entries as FsEntry[]).map((e) => e.path);
              if (paths.includes("b.ts")) {
                saw = true;
                break;
              }
            }
          } catch {
            // keepalive or partial frame — skip
          }
        }
      }
    } finally {
      clearTimeout(timer);
      controller.abort();
    }
    expect(saw).toBe(true);
  }, 10_000);
});
```

- [ ] **Step 2: Run — confirm failure**

Run: `bun test test/http-tree.test.ts`
Expected: the SSE test fails (times out because `tree-updated` is never emitted).

- [ ] **Step 3: Add `tree-updated` emission to `src/server/events.ts`**

At the top of the file, add:

```ts
import { listTree } from "./tree";
import type { FsEntry } from "../shared/types";
```

Inside `createEventHub`, add a new snapshot field next to the existing ones:

```ts
  let treeSnapshot: FsEntry[] = [];
```

Add a refresh helper next to `refreshRepoInfo` / `refreshStatus`:

```ts
  const refreshTree = async () => {
    try {
      // Default to hideIgnored=true on the server side — the frontend
      // re-requests the full listing via /api/tree when the user flips
      // the toggle, and also receives tree-updated streams that always
      // reflect the hideIgnored=true view. Live-updating both views for
      // every watcher tick would double the work without a user waiting
      // on the hideIgnored=false side of things; they'll see the fresh
      // state on their next /api/tree fetch.
      treeSnapshot = await listTree(repo.cwd, { hideIgnored: true });
      emit({ type: "tree-updated", entries: treeSnapshot });
    } catch (err) {
      if (err instanceof GitError) emit({ type: "warning", message: err.stderr });
    }
  };
```

In `handleWatcherEvent`, add a parallel `refreshTree()` call to the cases that already refresh status:

```ts
      case "working-tree-changed":
      case "gitignore-changed":
      case "index-changed":
        await Promise.all([
          refreshStatus({ withDiffs: true, pathsToDiff: event.paths }),
          refreshTree(),
        ]);
        break;
```

And for `head-changed`:

```ts
      case "head-changed":
        invalidateBlameCache();
        await Promise.all([
          refreshRepoInfo(),
          refreshStatus({ withDiffs: false }),
          refreshTree(),
        ]);
        emit({
          type: "head-changed",
          headSha: repoInfo.headSha,
          status: statusSnapshot,
          branches: branchesSnapshot,
        });
        break;
```

In `start()`, seed `treeSnapshot` alongside the other initial snapshots:

```ts
      const [, nextStatus, nextStashes, nextTree] = await Promise.all([
        refreshRepoInfo(),
        repo.getStatus(),
        repo.getStashes().catch(() => [] as Stash[]),
        listTree(repo.cwd, { hideIgnored: true }).catch(() => [] as FsEntry[]),
      ]);
      statusSnapshot = nextStatus;
      stashesSnapshot = nextStashes;
      treeSnapshot = nextTree;
```

Leave the `subscribe` snapshot payload alone — `treeSnapshot` is only broadcast via the new `tree-updated` event. The web client fetches the initial tree via `GET /api/tree` (Task 10's store wiring).

- [ ] **Step 4: Run — confirm green**

Run: `bun test test/http-tree.test.ts`
Expected: all SSE and HTTP tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/server/events.ts test/http-tree.test.ts
git commit -m "feat(server/events): emit tree-updated on watcher events"
```

---

## Task 8: Shared frontend tree primitive `src/web/lib/tree.ts`

**Files:**
- Create: `src/web/lib/tree.ts`
- Create: `test/tree-lib.test.ts`

- [ ] **Step 1: Write failing unit tests**

Create `test/tree-lib.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import {
  buildTreeFromPaths,
  collectAllDirs,
  collectAncestorDirs,
  flattenVisible,
} from "../src/web/lib/tree";

interface Item {
  path: string;
  label?: string;
}

describe("buildTreeFromPaths", () => {
  test("builds nested directories", () => {
    const tree = buildTreeFromPaths<Item>([
      { path: "src/web/app.tsx" },
      { path: "src/server/cli.ts" },
      { path: "README.md" },
    ]);
    // Root -> [src/, README.md]
    expect(tree.children.map((c) => c.name)).toEqual(["src", "README.md"]);
    const src = tree.children.find((c) => c.name === "src")!;
    expect(src.isDir).toBe(true);
    // Inside src: server/ + web/
    expect(src.children.map((c) => c.name).sort()).toEqual(["server", "web"]);
  });

  test("sorts directories first then alphabetical", () => {
    const tree = buildTreeFromPaths<Item>([
      { path: "zebra.ts" },
      { path: "alpha/file.ts" },
      { path: "apple.ts" },
    ]);
    expect(tree.children.map((c) => c.name)).toEqual(["alpha", "apple.ts", "zebra.ts"]);
  });

  test("empty input returns an empty root", () => {
    const tree = buildTreeFromPaths<Item>([]);
    expect(tree.children).toEqual([]);
  });

  test("attaches data to leaf nodes", () => {
    const tree = buildTreeFromPaths<Item>([
      { path: "a.ts", label: "hello" },
    ]);
    expect(tree.children[0]!.data?.label).toBe("hello");
  });

  test("accepts synthesized directory entries (isDir from data not used here)", () => {
    // This shape comes from listTree which emits both file and directory
    // entries; buildTreeFromPaths should deduplicate directories correctly.
    const tree = buildTreeFromPaths<Item>([
      { path: "src" },
      { path: "src/a.ts" },
      { path: "src/b.ts" },
    ]);
    const src = tree.children.find((c) => c.name === "src")!;
    expect(src.children.map((c) => c.name)).toEqual(["a.ts", "b.ts"]);
  });
});

describe("collectAncestorDirs", () => {
  test("returns every parent dir of every input path", () => {
    const dirs = collectAncestorDirs(["src/web/app.tsx", "src/server/cli.ts"]);
    expect([...dirs].sort()).toEqual(["src", "src/server", "src/web"]);
  });
});

describe("collectAllDirs", () => {
  test("walks a tree and returns every directory path", () => {
    const tree = buildTreeFromPaths<Item>([
      { path: "src/web/app.tsx" },
      { path: "src/server/cli.ts" },
      { path: "a.ts" },
    ]);
    expect(collectAllDirs(tree).sort()).toEqual(["src", "src/server", "src/web"]);
  });
});

describe("flattenVisible", () => {
  test("returns only visible (non-hidden) descendants respecting isExpanded", () => {
    const tree = buildTreeFromPaths<Item>([
      { path: "src/web/app.tsx" },
      { path: "src/server/cli.ts" },
    ]);
    // Nothing expanded — only top-level children.
    const closed = flattenVisible(tree, () => false);
    expect(closed.map((v) => v.node.name)).toEqual(["src"]);

    // Expand src → src/server and src/web visible.
    const srcOnly = flattenVisible(tree, (d) => d === "src");
    expect(srcOnly.map((v) => v.node.name)).toEqual(["src", "server", "web"]);

    // Expand everything.
    const all = flattenVisible(tree, () => true);
    expect(all.map((v) => v.node.name)).toEqual([
      "src",
      "server",
      "cli.ts",
      "web",
      "app.tsx",
    ]);
  });
});
```

- [ ] **Step 2: Run — confirm failure**

Run: `bun test test/tree-lib.test.ts`
Expected: module-not-found error for `../src/web/lib/tree`.

- [ ] **Step 3: Create `src/web/lib/tree.ts`**

```ts
// src/web/lib/tree.ts
// Shared tree primitives — generic over the item type so both the Changes
// view (FileStatus) and the Explore view (FsEntry) can reuse one builder.
//
// The pattern: items have a `path` like "src/web/app.tsx". We split on "/",
// walk/create TreeNode children, attach the item as `data` on the leaf. A
// WeakMap cache keyed on the items array keeps the tree stable across
// renders when the source array is reference-identical.

export interface TreeNode<T> {
  name: string;
  /** "" for root, "src" / "src/web" for nested directories. */
  fullPath: string;
  isDir: boolean;
  children: TreeNode<T>[];
  data?: T;
}

function buildTreeUncached<T extends { path: string }>(items: T[]): TreeNode<T> {
  const root: TreeNode<T> = {
    name: "",
    fullPath: "",
    isDir: true,
    children: [],
  };
  for (const item of items) {
    const parts = item.path.split("/");
    let cursor = root;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]!;
      const isLast = i === parts.length - 1;
      const childPath = cursor.fullPath ? `${cursor.fullPath}/${part}` : part;
      let child = cursor.children.find((c) => c.name === part);
      if (!child) {
        child = {
          name: part,
          fullPath: childPath,
          isDir: !isLast,
          children: [],
        };
        cursor.children.push(child);
      }
      if (isLast) {
        // If we've already seen this path as an intermediate directory (e.g.
        // listTree emitted both "src" and "src/a.ts"), don't downgrade
        // `isDir` — the directory status wins.
        if (!child.isDir) child.data = item;
        else child.data = item; // directory-ish items also get data, but stay isDir
      }
      cursor = child;
    }
  }
  const sort = (n: TreeNode<T>): void => {
    n.children.sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    for (const c of n.children) sort(c);
  };
  sort(root);
  return root;
}

/**
 * Reference-identity cache. Callers that keep a stable items array across
 * renders (zustand selectors, useMemo on the same array reference) get a
 * free cache hit. On a new array reference the cache rebuilds — the work
 * is O(n) string walks, which is cheap for the ~1000s of paths a typical
 * repo has with hideIgnored=true.
 */
const treeCache = new WeakMap<object, TreeNode<unknown>>();
export function buildTreeFromPaths<T extends { path: string }>(items: T[]): TreeNode<T> {
  const cached = treeCache.get(items);
  if (cached) return cached as TreeNode<T>;
  const tree = buildTreeUncached(items);
  treeCache.set(items, tree as TreeNode<unknown>);
  return tree;
}

export function collectAncestorDirs(paths: string[]): Set<string> {
  const out = new Set<string>();
  for (const p of paths) {
    const parts = p.split("/");
    for (let i = 1; i < parts.length; i++) {
      out.add(parts.slice(0, i).join("/"));
    }
  }
  return out;
}

export function collectAllDirs<T>(node: TreeNode<T>): string[] {
  const out: string[] = [];
  const walk = (n: TreeNode<T>) => {
    if (n.isDir && n.fullPath) out.push(n.fullPath);
    for (const c of n.children) walk(c);
  };
  walk(node);
  return out;
}

export function flattenVisible<T>(
  node: TreeNode<T>,
  isExpanded: (dir: string) => boolean,
): Array<{ node: TreeNode<T>; depth: number }> {
  const out: Array<{ node: TreeNode<T>; depth: number }> = [];
  const walk = (n: TreeNode<T>, depth: number): void => {
    for (const child of n.children) {
      out.push({ node: child, depth });
      if (child.isDir && isExpanded(child.fullPath)) {
        walk(child, depth + 1);
      }
    }
  };
  walk(node, 0);
  return out;
}
```

- [ ] **Step 4: Run — confirm green**

Run: `bun test test/tree-lib.test.ts`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/web/lib/tree.ts test/tree-lib.test.ts
git commit -m "feat(web/lib/tree): generic buildTreeFromPaths + helpers"
```

---

## Task 9: Refactor `file-tree.tsx` to use shared primitive

**Files:**
- Modify: `src/web/components/file-tree.tsx`

- [ ] **Step 1: Remove the inlined helpers, import from `@/web/lib/tree`**

Open `src/web/components/file-tree.tsx` and make these changes:

1. Replace the top-of-file imports with:

```ts
import { useMemo, useState } from "react";
import type { FileStatus } from "@shared/types";
import {
  buildTreeFromPaths,
  collectAllDirs,
  collectAncestorDirs,
  flattenVisible,
  type TreeNode,
} from "../lib/tree";
```

2. Delete these local declarations from the file (they now live in `src/web/lib/tree.ts`):

- `interface TreeNode { ... }`
- `function buildTreeUncached(...) { ... }`
- `const treeCache = new WeakMap<...>();`
- `export function buildTree(...)`
- `function collectAncestorDirs(...)` (local version)
- `function flattenVisible(...)` (local version — note the signature change below)
- `function collectAllDirs(...)` (local version)

3. Update the component body — change every `buildTree(files)` to `buildTreeFromPaths(files)`:

```ts
  const tree = useMemo(() => buildTreeFromPaths(files), [files]);
```

4. `collectAncestorDirs` now takes `string[]`, not `FileStatus[]`. Update:

```ts
  const defaults = useMemo(
    () => collectAncestorDirs(files.map((f) => f.path)),
    [files],
  );
```

5. `flattenVisible` now returns the result array directly instead of using an out-param. Update `visible`:

```ts
  const visible = useMemo(() => {
    const isExpanded = (dir: string): boolean => {
      const forced = override.get(dir);
      if (forced !== undefined) return forced;
      return defaults.has(dir);
    };
    return flattenVisible(tree, isExpanded);
  }, [tree, override, defaults]);
```

6. The leaf row accesses `node.file` in the current code — but the generic `TreeNode<FileStatus>` uses `node.data`. Update every `node.file` → `node.data`:

```ts
            ) : (
              <button
                onClick={() => node.data && onFileClick(node.data.path)}
                className={
                  "flex w-full items-center gap-1 px-2 py-0.5 text-left border-l-2 " +
                  (focusedPath === node.data?.path
                    ? "bg-surface-hover text-fg border-accent"
                    : "text-fg-muted hover:bg-surface-hover hover:text-fg border-transparent")
                }
                style={{ paddingLeft: 8 + (depth + 1) * 12 }}
              >
                <span className="truncate">{node.name}</span>
              </button>
            )}
```

7. Update `countChanges` to walk via `data` instead of `file`:

```ts
function countChanges(node: TreeNode<FileStatus>): string {
  let n = 0;
  const walk = (x: TreeNode<FileStatus>) => {
    if (x.data) n++;
    for (const c of x.children) walk(c);
  };
  walk(node);
  return n > 0 ? `(${n})` : "";
}
```

8. Update `visibleFilePathsForTree` and `allDirPathsForTree`:

```ts
/**
 * Visible file paths for j/k sibling navigation. Uses the cached tree so
 * repeated keypresses over the same `files` array don't rebuild it.
 * `expanded` is "everything expanded" when called from shortcuts so every
 * file is reachable — that path is the hot one.
 */
export function visibleFilePathsForTree(
  files: FileStatus[],
  expanded: Set<string>,
): string[] {
  const tree = buildTreeFromPaths(files);
  const flat = flattenVisible(tree, (dir) => expanded.has(dir));
  return flat.filter((v) => !v.node.isDir).map((v) => v.node.data!.path);
}

/** All directory paths in the tree — reused by shortcuts for j/k nav. */
export function allDirPathsForTree(files: FileStatus[]): Set<string> {
  const tree = buildTreeFromPaths(files);
  return new Set(collectAllDirs(tree));
}
```

- [ ] **Step 2: Typecheck**

Run: `bun run tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Run existing tests to confirm nothing regresses**

Run: `bun test`
Expected: all tests pass (including the new tree + tree-lib tests).

- [ ] **Step 4: Commit**

```bash
git add src/web/components/file-tree.tsx
git commit -m "refactor(file-tree): consume shared buildTreeFromPaths"
```

---

## Task 10: Settings + API client additions

**Files:**
- Modify: `src/web/settings.ts`
- Modify: `src/web/lib/api.ts`

- [ ] **Step 1: Add `workingTreeMode` and `hideIgnored` to settings**

In `src/web/settings.ts`, extend the `Settings` interface:

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
  workingTreeMode: "changes" | "explore";
  hideIgnored: boolean;
}
```

Extend `DEFAULTS`:

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
  workingTreeMode: "changes",
  hideIgnored: true,
};
```

- [ ] **Step 2: Add `tree` and `file` to the API client**

In `src/web/lib/api.ts`, add the `FsEntry` / `FileContents` imports:

```ts
import type {
  BlameLine,
  Branch,
  BrowseResult,
  Commit,
  CommitDetail,
  FileStatus,
  FsEntry,
  FileContents,
  ParsedDiff,
  Stash,
} from "@shared/types";
```

Add two methods to the `api` object:

```ts
  tree: (hideIgnored: boolean) =>
    fetchJson<{ entries: FsEntry[] }>(
      `/api/tree?hideIgnored=${hideIgnored ? "1" : "0"}`,
    ),
  file: (path: string) =>
    fetchJson<FileContents>(`/api/file?path=${encodeURIComponent(path)}`),
```

- [ ] **Step 3: Typecheck**

Run: `bun run tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/web/settings.ts src/web/lib/api.ts
git commit -m "feat(web/settings+api): workingTreeMode, hideIgnored, /tree + /file"
```

---

## Task 11: Store additions — explore entries + viewingFile

**Files:**
- Modify: `src/web/store.ts`

- [ ] **Step 1: Extend the store state**

In `src/web/store.ts`, add imports:

```ts
import type {
  BlameLine,
  Branch,
  Commit,
  FileContents,
  FileStatus,
  FsEntry,
  ParsedDiff,
  RepoInfo,
  SseEvent,
  Stash,
} from "@shared/types";
```

Add fields to the `StoreState` interface (near the bottom of the existing state fields, before the action signatures):

```ts
  // Explore mode —
  exploreEntries: FsEntry[];
  exploreFocusedPath: string | null;
  viewingFile: { path: string; contents: FileContents } | null;
  loadExploreEntries: (hideIgnored: boolean) => Promise<void>;
  focusExploreFile: (path: string) => Promise<void>;
  clearViewingFile: () => void;
```

Initialize the new fields inside the `create<StoreState>(...)` body:

```ts
  exploreEntries: [],
  exploreFocusedPath: null,
  viewingFile: null,
```

Add the new action implementations (after `teardown`, inside the store body):

```ts
  loadExploreEntries: async (hideIgnored) => {
    try {
      const { entries } = await api.tree(hideIgnored);
      set({ exploreEntries: entries });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      set({
        toasts: pushToast(get().toasts, makeToast("warning", `Load tree failed: ${msg}`)),
      });
    }
  },

  focusExploreFile: async (path) => {
    // If the file is also in the changed-files set, prefer the existing
    // diff path — clicking a changed file in Explore mode should feel
    // identical to clicking it in Changes mode.
    const changed = get().status.some((f) => f.path === path);
    if (changed) {
      set({ exploreFocusedPath: path, viewingFile: null });
      await get().focusFile(path);
      return;
    }
    // Clear the Changes-side focus so DiffView doesn't overlay a stale diff.
    set({
      exploreFocusedPath: path,
      focusedPath: null,
      focusedDiff: null,
      viewingFile: null,
    });
    try {
      const contents = await api.file(path);
      // Only commit if the user hasn't moved on in the meantime.
      if (get().exploreFocusedPath === path) {
        set({ viewingFile: { path, contents } });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      set({
        toasts: pushToast(get().toasts, makeToast("warning", `Read file failed: ${msg}`)),
      });
    }
  },

  clearViewingFile: () => set({ viewingFile: null }),
```

In `handleEvent`, add a `tree-updated` case:

```ts
    case "tree-updated": {
      set({ exploreEntries: event.entries });
      // If the currently-viewed file was deleted on disk, drop the view.
      const viewing = get().viewingFile;
      if (viewing && !event.entries.some((e) => e.path === viewing.path)) {
        set({ viewingFile: null, exploreFocusedPath: null });
      }
      break;
    }
```

- [ ] **Step 2: Typecheck**

Run: `bun run tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/web/store.ts
git commit -m "feat(web/store): exploreEntries, viewingFile, SSE tree-updated"
```

---

## Task 12: `FileExplorer` component

**Files:**
- Create: `src/web/components/file-explorer.tsx`

- [ ] **Step 1: Create the component**

```tsx
// src/web/components/file-explorer.tsx
// Full working-directory tree view. Structurally mirrors FileTree but
// without change-count badges — every entry is a file or directory
// straight from listTree.
import { useMemo, useState } from "react";
import type { FsEntry } from "@shared/types";
import {
  buildTreeFromPaths,
  collectAllDirs,
  flattenVisible,
  type TreeNode,
} from "../lib/tree";

export function FileExplorer({
  entries,
  focusedPath,
  onFileClick,
}: {
  entries: FsEntry[];
  focusedPath: string | null;
  onFileClick: (path: string) => void;
}) {
  const tree = useMemo(() => buildTreeFromPaths(entries), [entries]);

  // Start fully collapsed — Explore has no "interesting" signal like
  // "expand ancestors of changed files", and blowing open a 30k-entry tree
  // on first render would kill the browser. The user clicks to expand.
  const [override, setOverride] = useState<Map<string, boolean>>(() => new Map());

  const visible = useMemo(() => {
    const isExpanded = (dir: string): boolean => override.get(dir) === true;
    return flattenVisible(tree, isExpanded);
  }, [tree, override]);

  const isExpanded = (dir: string): boolean => override.get(dir) === true;

  const toggle = (dirPath: string) => {
    setOverride((prev) => {
      const next = new Map(prev);
      next.set(dirPath, !isExpanded(dirPath));
      return next;
    });
  };

  const expandAll = () => {
    const all = collectAllDirs(tree);
    setOverride(new Map(all.map((d) => [d, true])));
  };
  const collapseAll = () => setOverride(new Map());

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-1 border-b border-border px-2 py-1 text-xs">
        <button
          className="rounded px-1 text-fg-muted hover:bg-surface-hover hover:text-fg"
          onClick={expandAll}
          title="Expand all"
        >
          ＋
        </button>
        <button
          className="rounded px-1 text-fg-muted hover:bg-surface-hover hover:text-fg"
          onClick={collapseAll}
          title="Collapse all"
        >
          −
        </button>
      </div>
      <ul className="flex-1 overflow-auto font-mono text-xs">
        {visible.map(({ node, depth }) => (
          <li key={node.fullPath}>
            {node.isDir ? (
              <button
                onClick={() => toggle(node.fullPath)}
                className="flex w-full items-center gap-1 px-2 py-0.5 text-left text-fg-muted hover:bg-surface-hover hover:text-fg"
                style={{ paddingLeft: 8 + depth * 12 }}
              >
                <span className="w-3 text-fg-subtle">
                  {isExpanded(node.fullPath) ? "▾" : "▸"}
                </span>
                <span className="text-fg">{node.name}</span>
              </button>
            ) : (
              <button
                onClick={() => onFileClick(node.fullPath)}
                className={
                  "flex w-full items-center gap-1 px-2 py-0.5 text-left border-l-2 " +
                  (focusedPath === node.fullPath
                    ? "bg-surface-hover text-fg border-accent"
                    : "text-fg-muted hover:bg-surface-hover hover:text-fg border-transparent")
                }
                style={{ paddingLeft: 8 + (depth + 1) * 12 }}
              >
                <span className="truncate">{node.name}</span>
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Visible file paths — used by shortcuts for j/k in Explore mode. */
export function visibleExploreFilePaths(
  entries: FsEntry[],
  expanded: Set<string>,
): string[] {
  const tree = buildTreeFromPaths(entries);
  const flat = flattenVisible(tree, (dir) => expanded.has(dir));
  return flat
    .filter((v) => !v.node.isDir)
    .map((v) => (v.node.data?.path ?? v.node.fullPath));
}

/** All directory paths in the Explore tree — used by shortcuts for j/k. */
export function allExploreDirPaths(entries: FsEntry[]): Set<string> {
  const tree = buildTreeFromPaths(entries);
  return new Set(collectAllDirs(tree));
}
```

- [ ] **Step 2: Typecheck**

Run: `bun run tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/web/components/file-explorer.tsx
git commit -m "feat(web): FileExplorer component"
```

---

## Task 13: Wire Changes/Explore toggle into `file-list.tsx`

**Files:**
- Modify: `src/web/components/file-list.tsx`

- [ ] **Step 1: Add the toggle + conditional render + explore load**

Replace the top of `src/web/components/file-list.tsx` imports:

```tsx
import { useEffect, useMemo, useState } from "react";
import type { FileChangeType, FileStatus, FsEntry } from "@shared/types";
import { useStore } from "../store";
import { useSettings } from "../settings";
import { fuzzyFilter } from "../lib/fuzzy";
import { FileTree } from "./file-tree";
import { FileExplorer } from "./file-explorer";
```

At the top of the `FileList` function, pull the new state:

```tsx
export function FileList() {
  const status = useStore((s) => s.status);
  const focusedPath = useStore((s) => s.focusedPath);
  const focusFile = useStore((s) => s.focusFile);
  const exploreEntries = useStore((s) => s.exploreEntries);
  const exploreFocusedPath = useStore((s) => s.exploreFocusedPath);
  const focusExploreFile = useStore((s) => s.focusExploreFile);
  const loadExploreEntries = useStore((s) => s.loadExploreEntries);
  const fileListMode = useSettings((s) => s.fileListMode);
  const workingTreeMode = useSettings((s) => s.workingTreeMode);
  const hideIgnored = useSettings((s) => s.hideIgnored);
  const setSettings = useSettings((s) => s.set);
  const [filter, setFilter] = useState("");
```

Add an effect that lazy-loads explore entries the first time the user enters Explore mode (or when `hideIgnored` flips):

```tsx
  // Load (or reload) the explore tree when entering explore mode or when
  // the user flips hideIgnored. The SSE stream will keep it fresh after.
  useEffect(() => {
    if (workingTreeMode === "explore") {
      void loadExploreEntries(hideIgnored);
    }
  }, [workingTreeMode, hideIgnored, loadExploreEntries]);
```

Update the existing Changes-mode `groups` useMemo to be guarded (only built when in changes mode — minor, keep it always-on is fine since it's cheap):

```tsx
  const groups = useMemo(() => {
    const filtered = filter
      ? fuzzyFilter(status, filter, (f) => f.path)
      : status;
    return group(filtered);
  }, [status, filter]);
```

Filter explore entries in a new useMemo:

```tsx
  const filteredExploreEntries = useMemo<FsEntry[]>(() => {
    if (!filter) return exploreEntries;
    // Keep directory entries that lie on the path of any surviving file,
    // so the filtered tree doesn't show orphaned leaves. Cheap two-pass:
    // first fuzzy-filter files, then add back every ancestor directory.
    const files = exploreEntries.filter((e) => !e.isDir);
    const matched = fuzzyFilter(files, filter, (f) => f.path);
    const keep = new Set(matched.map((m) => m.path));
    for (const m of matched) {
      const parts = m.path.split("/");
      for (let i = 1; i < parts.length; i++) keep.add(parts.slice(0, i).join("/"));
    }
    return exploreEntries.filter((e) => keep.has(e.path));
  }, [exploreEntries, filter]);
```

Replace the header block (the div that currently has the flat/tree buttons) with:

```tsx
      <div className="border-b border-border p-2">
        <div className="mb-2 flex items-center gap-1">
          <div role="tablist" className="flex rounded bg-surface-hover p-0.5">
            <button
              role="tab"
              aria-selected={workingTreeMode === "changes"}
              onClick={() => setSettings({ workingTreeMode: "changes" })}
              title="Changes"
              className={
                "rounded px-2 text-xs " +
                (workingTreeMode === "changes"
                  ? "bg-bg text-fg shadow-sm"
                  : "text-fg-muted hover:text-fg")
              }
            >
              Changes
            </button>
            <button
              role="tab"
              aria-selected={workingTreeMode === "explore"}
              onClick={() => setSettings({ workingTreeMode: "explore" })}
              title="Explore (full repo)"
              className={
                "rounded px-2 text-xs " +
                (workingTreeMode === "explore"
                  ? "bg-bg text-fg shadow-sm"
                  : "text-fg-muted hover:text-fg")
              }
            >
              Explore
            </button>
          </div>
          {workingTreeMode === "changes" && (
            <>
              <button
                onClick={() => setSettings({ fileListMode: "flat" })}
                title="Flat list"
                aria-pressed={fileListMode === "flat"}
                className={
                  "ml-2 rounded px-1 text-xs " +
                  (fileListMode === "flat"
                    ? "bg-surface-hover text-fg"
                    : "text-fg-muted hover:bg-surface-hover hover:text-fg")
                }
              >
                ☰
              </button>
              <button
                onClick={() => setSettings({ fileListMode: "tree" })}
                title="Tree view"
                aria-pressed={fileListMode === "tree"}
                className={
                  "rounded px-1 text-xs " +
                  (fileListMode === "tree"
                    ? "bg-surface-hover text-fg"
                    : "text-fg-muted hover:bg-surface-hover hover:text-fg")
                }
              >
                ▾
              </button>
            </>
          )}
          {workingTreeMode === "explore" && (
            <button
              onClick={() => setSettings({ hideIgnored: !hideIgnored })}
              title={hideIgnored ? "Show ignored files" : "Hide ignored files"}
              aria-pressed={hideIgnored}
              className={
                "ml-2 rounded px-1 text-xs " +
                (hideIgnored
                  ? "bg-surface-hover text-fg"
                  : "text-fg-muted hover:bg-surface-hover hover:text-fg")
              }
            >
              {hideIgnored ? "◐" : "◑"}
            </button>
          )}
        </div>
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter files… (/)"
          className="w-full rounded border border-border bg-surface px-2 py-1 text-sm text-fg focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent-soft"
          data-filter-input
        />
      </div>
```

Replace the body (the `<div className="flex-1 overflow-auto">...</div>` block) with:

```tsx
      <div className="flex-1 overflow-auto">
        {workingTreeMode === "explore" ? (
          <FileExplorer
            entries={filteredExploreEntries}
            focusedPath={exploreFocusedPath}
            onFileClick={(p) => void focusExploreFile(p)}
          />
        ) : fileListMode === "tree" ? (
          <FileTree
            files={status}
            focusedPath={focusedPath}
            onFileClick={(p) => void focusFile(p)}
          />
        ) : (
          groups.map((g) =>
            g.files.length === 0 ? null : (
              <div key={g.kind}>
                <div className="sticky top-0 bg-bg-elevated px-2 py-1 text-xs font-medium uppercase tracking-wide text-fg-muted">
                  {g.label} ({g.files.length})
                </div>
                {g.files.map((f) => (
                  <button
                    key={`${g.kind}-${f.path}`}
                    onClick={() => void focusFile(f.path)}
                    className={
                      "flex w-full items-center gap-2 truncate px-2 py-1 text-left text-sm border-l-2 " +
                      (focusedPath === f.path
                        ? "bg-surface-hover text-fg border-accent"
                        : "text-fg-muted hover:bg-surface-hover hover:text-fg border-transparent")
                    }
                  >
                    <ChangeBadge file={f} groupKind={g.kind} />
                    <span className="flex-1 truncate">{f.path}</span>
                    <DiffStats file={f} />
                  </button>
                ))}
              </div>
            ),
          )
        )}
      </div>
```

- [ ] **Step 2: Typecheck**

Run: `bun run tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/web/components/file-list.tsx
git commit -m "feat(file-list): Changes/Explore segmented toggle"
```

---

## Task 14: DiffView `fileViewMode` prop

**Files:**
- Modify: `src/web/components/diff-view.tsx`
- Modify: `src/web/tabs/working-tree.tsx`

- [ ] **Step 1: Add the prop and the rendering branch**

In `src/web/components/diff-view.tsx`, extend `Props`:

```ts
import type { BlameLine, DiffLine, ParsedDiff, FileContents } from "@shared/types";

interface Props {
  diff: ParsedDiff | null;
  loading?: boolean;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
  /**
   * When set, DiffView renders the file's contents instead of a diff —
   * +/- gutter hidden, Shiki highlighting applied, image/binary/tooLarge
   * branches handled by the same code paths used for diffs. Used by the
   * Explore mode when the selected file is not a changed file.
   *
   * If both `diff` and `fileViewMode` are set, `fileViewMode` wins. The
   * store guarantees they are never both set in practice.
   */
  fileViewMode?: { path: string; contents: FileContents };
}
```

At the very top of the `DiffView` function body (before the existing `useState`/`useEffect` calls), add an early short-circuit that renders file-view mode via its own helper:

```tsx
export function DiffView({
  diff,
  loading,
  collapsed: collapsedProp,
  onToggleCollapsed,
  fileViewMode,
}: Props) {
  if (fileViewMode) {
    return <FileViewer file={fileViewMode} />;
  }
  // ...existing DiffView body unchanged...
```

At the bottom of the file (after the existing `ImageDiff` / other helper components), add the `FileViewer` component:

```tsx
function FileViewer({ file }: { file: { path: string; contents: FileContents } }) {
  const mode = useSettings((s) => s.diffMode); // shared Shiki theme state
  void mode; // referenced for symmetry — FileViewer always renders unified plain

  const { path, contents } = file;

  if (contents.kind === "tooLarge") {
    return (
      <div className="p-4 text-sm text-fg-muted">
        <div className="font-medium text-fg">{path}</div>
        <div>File too large to display ({formatBytes(contents.size)}).</div>
      </div>
    );
  }

  if (contents.kind === "binary") {
    return (
      <div className="p-4 text-sm text-fg-muted">
        <div className="font-medium text-fg">{path}</div>
        <div>Binary file ({formatBytes(contents.size)}).</div>
      </div>
    );
  }

  if (contents.kind === "image") {
    const src = `data:${contents.mime};base64,${contents.base64}`;
    return (
      <div className="flex h-full flex-col overflow-auto p-4">
        <div className="mb-2 text-sm text-fg-muted">
          {path} · <span className="rounded border border-border px-1 text-[10px] uppercase">read-only</span>
        </div>
        <img src={src} alt={path} className="max-h-full max-w-full object-contain" />
      </div>
    );
  }

  // kind === "text"
  return <FileViewerText path={path} content={contents.content} />;
}

function FileViewerText({ path, content }: { path: string; content: string }) {
  const [html, setHtml] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const hl = await getHighlighter();
      const theme = activeShikiTheme();
      const lang = langFromPath(path);
      try {
        const rendered = hl.codeToHtml(content, { lang, theme });
        if (!cancelled) setHtml(rendered);
      } catch {
        if (!cancelled) setHtml(`<pre>${escapeHtml(content)}</pre>`);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [path, content]);

  return (
    <div className="flex h-full flex-col overflow-auto">
      <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-border bg-bg-elevated px-3 py-1.5 text-xs text-fg-muted">
        <span className="font-medium text-fg">{path}</span>
        <span className="rounded border border-border px-1 text-[10px] uppercase">read-only</span>
      </div>
      <div
        className="flex-1 overflow-auto p-3 font-mono text-xs"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={html ? { __html: html } : { __html: `<pre>${escapeHtml(content)}</pre>` }}
      />
    </div>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
```

- [ ] **Step 2: Wire `viewingFile` into `WorkingTreeTab`**

Replace `src/web/tabs/working-tree.tsx`:

```tsx
import { FileList } from "../components/file-list";
import { DiffView } from "../components/diff-view";
import { PaneSplit } from "../components/pane-split";
import { useStore } from "../store";

export function WorkingTreeTab() {
  const focusedDiff = useStore((s) => s.focusedDiff);
  const focusedPath = useStore((s) => s.focusedPath);
  const viewingFile = useStore((s) => s.viewingFile);
  return (
    <PaneSplit
      axis="x"
      a={<FileList />}
      b={
        <div className="h-full overflow-auto">
          <DiffView
            diff={focusedDiff}
            loading={focusedPath !== null && focusedDiff === null}
            fileViewMode={viewingFile ?? undefined}
          />
        </div>
      }
    />
  );
}
```

- [ ] **Step 3: Typecheck + build**

Run: `bun run tsc --noEmit && bun run build:web`
Expected: no errors, build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/web/components/diff-view.tsx src/web/tabs/working-tree.tsx
git commit -m "feat(diff-view): fileViewMode for unchanged-file content"
```

---

## Task 15: Shortcuts — `e` toggle + j/k in Explore

**Files:**
- Modify: `src/web/components/shortcuts.tsx`

- [ ] **Step 1: Add `e` binding and extend `navigateSibling`**

In `src/web/components/shortcuts.tsx`, add imports:

```ts
import {
  allExploreDirPaths,
  visibleExploreFilePaths,
} from "./file-explorer";
```

In the `SHORTCUT_HELP` array, add an `e` row near the `t` row:

```ts
  { keys: "t", description: "Toggle flat / tree file list" },
  { keys: "e", description: "Toggle Changes / Explore (Working Tree)" },
```

Add the `e` handler next to the existing `t` handler inside the key event handler:

```ts
      if (e.key === "e") {
        if (useSettings.getState().lastUsedTab !== "working-tree") return;
        const cur = useSettings.getState().workingTreeMode;
        useSettings
          .getState()
          .set({ workingTreeMode: cur === "explore" ? "changes" : "explore" });
        return;
      }
```

Replace the `navigateSibling` function with a version that branches on `workingTreeMode` when the active tab is `working-tree`:

```ts
function navigateSibling(delta: 1 | -1): void {
  const s = useStore.getState();
  const mode = useSettings.getState().fileListMode;
  const tab = useSettings.getState().lastUsedTab;
  const wtMode = useSettings.getState().workingTreeMode;
  if (tab === "working-tree") {
    if (wtMode === "explore") {
      const entries = s.exploreEntries;
      const paths = visibleExploreFilePaths(entries, allExploreDirPaths(entries));
      if (paths.length === 0) return;
      const idx = s.exploreFocusedPath ? paths.indexOf(s.exploreFocusedPath) : -1;
      const next = paths[(idx + delta + paths.length) % paths.length];
      if (next) void s.focusExploreFile(next);
      return;
    }
    let paths: string[] = s.status.map((f) => f.path);
    if (mode === "tree") {
      paths = visibleFilePathsForTree(s.status, allDirPathsForTree(s.status));
    }
    if (paths.length === 0) return;
    const idx = s.focusedPath ? paths.indexOf(s.focusedPath) : -1;
    const next = paths[(idx + delta + paths.length) % paths.length];
    if (next) void s.focusFile(next);
    return;
  }
  if (tab === "history") {
    const shas = s.log.map((c) => c.sha);
    if (shas.length === 0) return;
    const idx = s.focusedCommitSha ? shas.indexOf(s.focusedCommitSha) : -1;
    const next = shas[(idx + delta + shas.length) % shas.length];
    if (next) void s.focusCommit(next);
    return;
  }
  if (tab === "branches") {
    const names = s.branches.map((b) => b.name);
    if (names.length === 0) return;
    const idx = s.focusedBranch ? names.indexOf(s.focusedBranch) : -1;
    const next = names[(idx + delta + names.length) % names.length];
    if (next) s.focusBranch(next);
    return;
  }
  if (tab === "stashes") {
    if (s.stashes.length === 0) return;
    const cur = s.focusedStashIndex ?? -1;
    const nextIdx =
      (cur + delta + s.stashes.length) % s.stashes.length;
    s.focusStash(nextIdx);
    return;
  }
}
```

- [ ] **Step 2: Typecheck + build**

Run: `bun run tsc --noEmit && bun run build:web`
Expected: no errors, build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/web/components/shortcuts.tsx
git commit -m "feat(shortcuts): `e` toggles Explore, j/k navigates Explore"
```

---

## Task 16: Command palette entries

**Files:**
- Modify: `src/web/components/command-palette.tsx`

- [ ] **Step 1: Read the palette to understand its action shape**

Open `src/web/components/command-palette.tsx` and note the pattern the existing commands use (e.g., how `Toggle flat / tree file list` is registered). Use the same shape.

- [ ] **Step 2: Add two new commands**

Following the pattern of the existing commands, add entries for:

1. **"Explorer: toggle Changes / Explore"** — calls
   ```ts
   const cur = useSettings.getState().workingTreeMode;
   useSettings.getState().set({ workingTreeMode: cur === "explore" ? "changes" : "explore" });
   ```
2. **"Explorer: toggle hide ignored files"** — calls
   ```ts
   useSettings.getState().set({ hideIgnored: !useSettings.getState().hideIgnored });
   ```

If the palette filters commands by current tab, both commands should only appear when `lastUsedTab === "working-tree"`.

- [ ] **Step 3: Typecheck + build**

Run: `bun run tsc --noEmit && bun run build:web`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/web/components/command-palette.tsx
git commit -m "feat(palette): Explorer toggle + hide-ignored commands"
```

---

## Task 17: Status bar "viewing" line

**Files:**
- Modify: `src/web/components/status-bar.tsx`

- [ ] **Step 1: Read the status bar to understand its current structure**

Open `src/web/components/status-bar.tsx` and find where the focused diff's stats line is rendered (the "X files changed, Y insertions…" style row).

- [ ] **Step 2: Add a viewing-file branch**

Add a selector for `viewingFile`:

```ts
const viewingFile = useStore((s) => s.viewingFile);
```

In the stats-rendering block, when `viewingFile` is set and `focusedDiff` is null, render instead:

```tsx
{viewingFile && !focusedDiff && (
  <span className="text-fg-muted">
    viewing: <span className="text-fg">{viewingFile.path}</span>
    {viewingFile.contents.kind !== "text" && (
      <> · <span>{viewingFile.contents.kind}</span></>
    )}
    {" "}· read-only
  </span>
)}
```

(Exact wrapping depends on the existing status-bar layout — keep classes and container shape consistent with neighboring items.)

- [ ] **Step 3: Typecheck + build**

Run: `bun run tsc --noEmit && bun run build:web`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/web/components/status-bar.tsx
git commit -m "feat(status-bar): viewing read-only file indicator"
```

---

## Task 18: README update

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add Explore mode to the Features list**

In `README.md`, find the `## Features` section and add an entry under "Working Tree":

```markdown
- **File explorer** — "Explore" mode in the Working Tree sidebar shows the full repo tree, not just changed files. Click any file to view its contents (syntax-highlighted via Shiki) or its diff if it's changed. Toggle with `e` or the segmented control. "Hide ignored files" toggle is sticky across sessions.
```

In the keyboard shortcuts line, add `e` to the list:

```markdown
- **Keyboard shortcuts** — `j/k` between files, `Tab` between tabs, `u` toggle unified/split, `t` flat/tree, `e` Changes/Explore, `/` filter, `p` pause, `` Ctrl/Cmd+` `` toggle terminal, `?` help
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: document file explorer in Features list"
```

---

## Task 19: Full-stack verification

**Files:** None modified — this is a smoke test pass.

- [ ] **Step 1: Run the full test suite**

Run: `bun test`
Expected: all tests pass (existing suite + new tree, tree-lib, and http-tree tests).

- [ ] **Step 2: Typecheck and build**

Run: `bun run tsc --noEmit && bun run build:web`
Expected: clean.

- [ ] **Step 3: Manual smoke against a real repo**

In two terminals:

```bash
# Terminal 1
DIFFSCOPE_DEV_PORT=41111 bun run --hot src/server/cli.ts /path/to/test-repo
```

```bash
# Terminal 2
bun run dev:web
```

Open `http://localhost:5173` and verify:

- [ ] Working Tree sidebar shows the `[ Changes | Explore ]` toggle at the top.
- [ ] Default mode is Changes (clean first-run default).
- [ ] Clicking Explore switches the sidebar to the full tree.
- [ ] The tree starts fully collapsed; expanding a directory works.
- [ ] Clicking an unchanged file shows its content on the right, syntax-highlighted, with a "read-only" badge.
- [ ] Clicking a changed file in Explore shows the normal diff (same as Changes mode).
- [ ] Clicking a PNG shows the image.
- [ ] Clicking a large file (>2 MB) shows the "file too large" message.
- [ ] Deleting a file on disk updates the Explore tree within ~1 second.
- [ ] Creating a file on disk updates the Explore tree within ~1 second.
- [ ] Editing an unchanged file in Explore mode causes the tree to update (the file now appears in Changes too).
- [ ] Hide-ignored toggle — turn it off, confirm `node_modules` appears, reload the page, confirm the setting persists.
- [ ] `workingTreeMode` persists across reload.
- [ ] `e` shortcut toggles modes when focus is in the main area.
- [ ] `j` / `k` in Explore mode walks visible files, Enter is a no-op (same as Changes).
- [ ] Command palette (`Cmd/Ctrl+K`) lists "Explorer: toggle Changes / Explore" and "Explorer: toggle hide ignored files".
- [ ] Status bar shows "viewing: <path> · read-only" when viewing an unchanged file; normal stats otherwise.
- [ ] Toggling to Changes from Explore: if the Explore-focused file is also a changed file, Changes highlights it. Otherwise, Changes restores its last selection.
- [ ] No regressions on History / Branches / Stashes tabs.

- [ ] **Step 4: Commit the verification note (optional)**

If any small fixes came out of the smoke test, commit them with a clear message and re-run the checklist. If everything worked, no commit is needed.

---

## Self-review notes

**Spec coverage:**
- ✅ Scope: Explore is Working-Tree-only (Tasks 13, 15).
- ✅ Segmented toggle + `e` shortcut (Tasks 13, 15).
- ✅ Full-disk walk + git ls-files + hideIgnored (Tasks 2, 3).
- ✅ Path-safe readFile with text/image/binary/tooLarge (Tasks 4, 5).
- ✅ HTTP endpoints (Task 6).
- ✅ Live updates via SSE `tree-updated` (Task 7).
- ✅ Shared `buildTreeFromPaths` primitive (Tasks 8, 9).
- ✅ `FileExplorer` component (Task 12).
- ✅ Store + settings additions (Tasks 10, 11).
- ✅ DiffView `fileViewMode` with text/image/binary/tooLarge (Task 14).
- ✅ Shortcuts `e` + j/k in Explore (Task 15).
- ✅ Command palette entries (Task 16).
- ✅ Status bar (Task 17).
- ✅ README (Task 18).
- ✅ Verification (Task 19).

**Placeholder scan:** No "TODO" / "TBD" strings. One "depends on existing palette structure" note in Task 16 (palette structure is read at task time) — that's a deliberate read-then-insert-following-existing-pattern step, not a planning placeholder.

**Type consistency:** `FileContents`, `FsEntry`, and `SseEvent.tree-updated` are defined once in Task 1 and used by name everywhere after. `focusExploreFile` / `loadExploreEntries` / `clearViewingFile` / `viewingFile` / `exploreFocusedPath` / `exploreEntries` are defined in Task 11 and referenced consistently in Tasks 13, 14, 15, 17.
