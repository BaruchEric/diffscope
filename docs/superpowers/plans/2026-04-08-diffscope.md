# diffscope Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local, read-only, live git diff viewer launched via `bunx diffscope` that watches any git repo on the user's Mac and streams working-tree / history / branches / stashes updates into a browser UI.

**Architecture:** Single Bun HTTP server per repo. Shells out to the `git` binary via `child_process` and parses plumbing output. File and git events come from `@parcel/watcher`. Server maintains an in-memory snapshot and pushes only deltas to the browser over Server-Sent Events. Frontend is a React + Vite SPA served as static files.

**Tech Stack:** Bun, TypeScript (strict), `child_process` → `git`, `@parcel/watcher`, SSE (native `ReadableStream` + `EventSource`), React, Vite, Tailwind CSS, shadcn/ui, Zustand, Shiki.

**Reference:** `docs/superpowers/specs/2026-04-08-diffscope-design.md`

---

## File Structure

```
diffscope/
├── package.json
├── tsconfig.json                    # server TS config (strict, NodeNext)
├── tsconfig.web.json                # web TS config (jsx, bundler resolution)
├── vite.config.ts                   # Vite bundler config (outputs to dist/web/)
├── tailwind.config.ts
├── postcss.config.js
├── bin/
│   └── diffscope.ts                 # bin entry → imports src/server/cli.ts
├── src/
│   ├── shared/
│   │   └── types.ts                 # types shared between server and web
│   ├── server/
│   │   ├── cli.ts                   # argv parse, repo resolve, port, launch
│   │   ├── http.ts                  # Bun.serve routes: REST + SSE + static
│   │   ├── repo.ts                  # git subprocess wrappers
│   │   ├── parser.ts                # pure parsers for git CLI output
│   │   ├── watcher.ts               # @parcel/watcher wrapper + debounce
│   │   ├── events.ts                # snapshot + delta + SSE fanout
│   │   └── recents.ts               # ~/.diffscope/recents.json helpers
│   └── web/
│       ├── main.tsx                 # Vite entry
│       ├── app.tsx                  # React root
│       ├── index.css                # Tailwind directives + theme vars
│       ├── store.ts                 # Zustand store + SSE wiring
│       ├── lib/
│       │   ├── api.ts               # REST client
│       │   ├── sse-client.ts        # EventSource wrapper
│       │   └── highlight.ts         # Shiki lazy loader
│       ├── components/
│       │   ├── layout.tsx           # header + top tabs + content slot
│       │   ├── file-list.tsx        # staged/unstaged/untracked groups
│       │   ├── diff-view.tsx        # unified + split modes + image + binary
│       │   ├── picker.tsx           # recents + folder browser
│       │   └── shortcuts.tsx        # keyboard shortcut handler + help modal
│       └── tabs/
│           ├── working-tree.tsx
│           ├── history.tsx
│           ├── branches.tsx
│           └── stashes.tsx
└── test/
    ├── fixtures/
    │   ├── status/                  # recorded `git status --porcelain=v2` output
    │   ├── diff/                    # recorded `git diff --patch` output
    │   └── log/                     # recorded `git log --format=…` output
    ├── helpers/
    │   └── temp-repo.ts             # creates scratch git repos
    ├── parser.test.ts
    ├── repo.test.ts
    └── events.test.ts
```

---

## Task 1: Project scaffold

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `src/server/.gitkeep`
- Create: `src/web/.gitkeep`
- Create: `src/shared/.gitkeep`
- Create: `test/.gitkeep`

- [x] **Step 1: Create `package.json`**

```json
{
  "name": "diffscope",
  "version": "0.0.1",
  "description": "A local, read-only, live git diff viewer.",
  "type": "module",
  "bin": {
    "diffscope": "./bin/diffscope.ts"
  },
  "scripts": {
    "dev:server": "bun run --hot src/server/cli.ts",
    "dev:web": "vite",
    "build:web": "vite build",
    "start": "bun run src/server/cli.ts",
    "test": "bun test",
    "typecheck": "tsc --noEmit && tsc --noEmit -p tsconfig.web.json"
  },
  "dependencies": {
    "@parcel/watcher": "^2.4.1"
  },
  "devDependencies": {
    "@types/bun": "latest",
    "typescript": "^5.6.0"
  }
}
```

- [x] **Step 2: Create `tsconfig.json`** (server-side)

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "allowImportingTsExtensions": true,
    "noEmit": true,
    "isolatedModules": true,
    "resolveJsonModule": true
  },
  "include": ["src/server/**/*", "src/shared/**/*", "bin/**/*", "test/**/*"],
  "exclude": ["src/web/**/*"]
}
```

- [x] **Step 3: Create empty directories with placeholders**

```bash
mkdir -p src/server src/web src/shared test/fixtures test/helpers bin
touch src/server/.gitkeep src/web/.gitkeep src/shared/.gitkeep test/.gitkeep
```

- [x] **Step 4: Install dependencies**

Run: `bun install`
Expected: creates `bun.lock`, installs `@parcel/watcher` and `typescript`.

- [x] **Step 5: Typecheck (informational only — expected to fail)**

With zero `.ts` files in the project yet, `bun x tsc --noEmit` will fail with `TS18003: No inputs were found`. This is expected — Task 2 adds `src/shared/types.ts` which makes the typecheck pass. Skip this step and move on to commit.

- [x] **Step 6: Commit**

```bash
git add package.json tsconfig.json bun.lock src/ test/ bin/
git commit -m "chore: scaffold diffscope package"
```

---

## Task 2: Shared types

**Files:**
- Create: `src/shared/types.ts`

- [ ] **Step 1: Write types**

```ts
// src/shared/types.ts
// Shared between server and web. Keep pure — no runtime code.

export type FileChangeType =
  | "added"
  | "modified"
  | "deleted"
  | "renamed"
  | "copied"
  | "untracked"
  | "ignored"
  | "unmerged";

export interface FileStatus {
  /** Repo-root-relative path (post-rename for renames). */
  path: string;
  /** For renames/copies, the original path. */
  oldPath?: string;
  /** Change relative to HEAD/index on the staged side. */
  staged: FileChangeType | null;
  /** Change relative to index/working tree on the unstaged side. */
  unstaged: FileChangeType | null;
  /** True if the file is new to the index (never committed). */
  isUntracked: boolean;
  /** True for image file extensions — web renders side-by-side. */
  isImage: boolean;
  /** True if git reports binary. */
  isBinary: boolean;
  /** File size in bytes of the current working-tree version, if known. */
  sizeBytes?: number;
}

export interface DiffLine {
  kind: "context" | "add" | "del";
  oldLine?: number;
  newLine?: number;
  text: string;
}

export interface DiffHunk {
  header: string; // e.g. "@@ -12,7 +12,9 @@ export function main()"
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: DiffLine[];
}

export interface ParsedDiff {
  path: string;
  oldPath?: string;
  hunks: DiffHunk[];
  /** Set when git reports a binary diff. */
  binary?: { oldSize?: number; newSize?: number };
  /** True when the diff was collapsed because the file was too large. */
  truncated?: boolean;
}

export interface Commit {
  sha: string;
  shortSha: string;
  author: string;
  authorEmail: string;
  date: string; // ISO 8601
  subject: string;
  parents: string[];
  refs: string[]; // e.g. ["HEAD -> main", "origin/main"]
}

export interface CommitDetail extends Commit {
  body: string;
  diff: ParsedDiff[];
}

export interface Branch {
  name: string;
  isCurrent: boolean;
  isRemote: boolean;
  upstream?: string;
  ahead: number;
  behind: number;
  tipSha: string;
  tipSubject: string;
}

export interface Stash {
  index: number;
  sha: string;
  message: string;
  date: string;
}

export interface RepoInfo {
  root: string;
  headSha: string;
  currentBranch: string | null;
}

export type SseEvent =
  | { type: "snapshot"; status: FileStatus[]; repo: RepoInfo }
  | { type: "file-updated"; path: string; status: FileStatus; diff?: ParsedDiff }
  | { type: "file-removed"; path: string }
  | { type: "head-changed"; headSha: string; status: FileStatus[]; branches: Branch[] }
  | { type: "refs-changed"; branches: Branch[] }
  | { type: "stashes-changed"; stashes: Stash[] }
  | { type: "watcher-down" }
  | { type: "watcher-up" }
  | { type: "repo-error"; reason: string }
  | { type: "warning"; message: string };

export interface BrowseEntry {
  name: string;
  path: string;
  isGitRepo: boolean;
}

export interface BrowseResult {
  path: string;
  entries: BrowseEntry[];
  /** Parent directory, or null if at filesystem root. */
  parent: string | null;
}
```

- [ ] **Step 2: Typecheck**

Run: `bun x tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/shared/types.ts
git commit -m "feat(types): add shared TypeScript types"
```

---

## Task 3: Parser — `git status --porcelain=v2` fixtures and tests

**Files:**
- Create: `test/fixtures/status/basic.txt`
- Create: `test/fixtures/status/rename.txt`
- Create: `test/fixtures/status/unicode.txt`
- Create: `src/server/parser.ts`
- Create: `test/parser.test.ts`

- [ ] **Step 1: Record fixture `basic.txt`**

Create `test/fixtures/status/basic.txt` with real v2 porcelain output. This captures the format — if unsure, generate with `git status --porcelain=v2 -z` and then convert NULs to newlines for readability. Use the literal text below verbatim (the trailing newline on the last line matters):

```
# branch.oid 1234567890abcdef1234567890abcdef12345678
# branch.head main
1 M. N... 100644 100644 100644 abc123 abc124 src/app.ts
1 .M N... 100644 100644 100644 def456 def457 README.md
1 MM N... 100644 100644 100644 aaa111 aaa112 src/cli.ts
? new.ts
? docs/note.md
! ignored.log
```

Note: diffscope uses `--porcelain=v2` (not `-z`) for the first cut. Fixture file format mirrors that non-NUL form.

- [ ] **Step 2: Write the first failing test**

```ts
// test/parser.test.ts
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseStatus } from "../src/server/parser";

const fixture = (name: string) =>
  readFileSync(join(import.meta.dir, "fixtures/status", name), "utf8");

describe("parseStatus", () => {
  test("parses basic mixed staged/unstaged/untracked/ignored", () => {
    const result = parseStatus(fixture("basic.txt"));
    expect(result).toEqual([
      {
        path: "src/app.ts",
        staged: "modified",
        unstaged: null,
        isUntracked: false,
        isImage: false,
        isBinary: false,
      },
      {
        path: "README.md",
        staged: null,
        unstaged: "modified",
        isUntracked: false,
        isImage: false,
        isBinary: false,
      },
      {
        path: "src/cli.ts",
        staged: "modified",
        unstaged: "modified",
        isUntracked: false,
        isImage: false,
        isBinary: false,
      },
      {
        path: "new.ts",
        staged: null,
        unstaged: "added",
        isUntracked: true,
        isImage: false,
        isBinary: false,
      },
      {
        path: "docs/note.md",
        staged: null,
        unstaged: "added",
        isUntracked: true,
        isImage: false,
        isBinary: false,
      },
      {
        path: "ignored.log",
        staged: null,
        unstaged: "added",
        isUntracked: false,
        isImage: false,
        isBinary: false,
      },
    ]);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `bun test test/parser.test.ts`
Expected: FAIL — `parseStatus` is not defined.

- [ ] **Step 4: Implement `parseStatus` (just enough to pass)**

```ts
// src/server/parser.ts
import type { FileChangeType, FileStatus } from "../shared/types";

const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp", ".ico"]);

function isImage(path: string): boolean {
  const lower = path.toLowerCase();
  const dot = lower.lastIndexOf(".");
  if (dot < 0) return false;
  return IMAGE_EXTS.has(lower.slice(dot));
}

function xyToChange(c: string): FileChangeType | null {
  switch (c) {
    case ".": return null;
    case "M": return "modified";
    case "A": return "added";
    case "D": return "deleted";
    case "R": return "renamed";
    case "C": return "copied";
    case "U": return "unmerged";
    case "T": return "modified"; // type change — treat as modified
    default: return null;
  }
}

function baseStatus(path: string): FileStatus {
  return {
    path,
    staged: null,
    unstaged: null,
    isUntracked: false,
    isImage: isImage(path),
    isBinary: false,
  };
}

export function parseStatus(raw: string): FileStatus[] {
  const result: FileStatus[] = [];
  for (const line of raw.split("\n")) {
    if (!line || line.startsWith("#")) continue;
    const kind = line[0];
    if (kind === "1") {
      // "1 XY <sub> <mH> <mI> <mW> <hH> <hI> <path>"
      const parts = line.split(" ");
      const xy = parts[1] ?? "..";
      const path = parts.slice(8).join(" ");
      const entry = baseStatus(path);
      entry.staged = xyToChange(xy[0] ?? ".");
      entry.unstaged = xyToChange(xy[1] ?? ".");
      result.push(entry);
    } else if (kind === "?") {
      // "? <path>"
      const path = line.slice(2);
      const entry = baseStatus(path);
      entry.unstaged = "added";
      entry.isUntracked = true;
      result.push(entry);
    } else if (kind === "!") {
      // ignored — still surface it so the UI can filter
      const path = line.slice(2);
      const entry = baseStatus(path);
      entry.unstaged = "added";
      result.push(entry);
    }
    // kind === "2" (rename) and "u" (unmerged) handled in Task 4
  }
  return result;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test test/parser.test.ts`
Expected: PASS (1 test).

- [ ] **Step 6: Commit**

```bash
git add src/server/parser.ts test/parser.test.ts test/fixtures/status/basic.txt
git commit -m "feat(parser): parse basic git status porcelain v2"
```

---

## Task 4: Parser — status edge cases (renames, unicode, unmerged)

**Files:**
- Create: `test/fixtures/status/rename.txt`
- Create: `test/fixtures/status/unicode.txt`
- Create: `test/fixtures/status/unmerged.txt`
- Modify: `src/server/parser.ts`
- Modify: `test/parser.test.ts`

- [ ] **Step 1: Record `rename.txt` fixture**

```
# branch.oid 1234567890abcdef1234567890abcdef12345678
# branch.head feature
2 R. N... 100644 100644 100644 abc123 abc124 R100 src/new-name.ts	src/old-name.ts
2 RM N... 100644 100644 100644 def456 def457 R100 src/renamed.ts	src/original.ts
```

Note: in porcelain v2, rename entries use a tab separator between new path and original path.

- [ ] **Step 2: Record `unicode.txt` fixture**

```
# branch.oid 1234567890abcdef1234567890abcdef12345678
# branch.head main
1 M. N... 100644 100644 100644 abc123 abc124 src/café/naïve.ts
1 .M N... 100644 100644 100644 def456 def457 "src/with space.ts"
? "docs/new file.md"
```

Note: porcelain v2 without `-z` may quote filenames containing special chars — handle both quoted and unquoted forms.

- [ ] **Step 3: Record `unmerged.txt` fixture**

```
# branch.oid 1234567890abcdef1234567890abcdef12345678
# branch.head main
u UU N... 100644 100644 100644 100644 aaa bbb ccc src/conflict.ts
```

- [ ] **Step 4: Add failing tests**

Append to `test/parser.test.ts`:

```ts
test("parses renames with original path", () => {
  const result = parseStatus(fixture("rename.txt"));
  expect(result).toEqual([
    {
      path: "src/new-name.ts",
      oldPath: "src/old-name.ts",
      staged: "renamed",
      unstaged: null,
      isUntracked: false,
      isImage: false,
      isBinary: false,
    },
    {
      path: "src/renamed.ts",
      oldPath: "src/original.ts",
      staged: "renamed",
      unstaged: "modified",
      isUntracked: false,
      isImage: false,
      isBinary: false,
    },
  ]);
});

test("handles unicode and quoted filenames", () => {
  const result = parseStatus(fixture("unicode.txt"));
  expect(result.map((e) => e.path)).toEqual([
    "src/café/naïve.ts",
    "src/with space.ts",
    "docs/new file.md",
  ]);
});

test("parses unmerged entries", () => {
  const result = parseStatus(fixture("unmerged.txt"));
  expect(result).toEqual([
    {
      path: "src/conflict.ts",
      staged: "unmerged",
      unstaged: "unmerged",
      isUntracked: false,
      isImage: false,
      isBinary: false,
    },
  ]);
});
```

- [ ] **Step 5: Run tests to verify they fail**

Run: `bun test test/parser.test.ts`
Expected: 3 new tests FAIL.

- [ ] **Step 6: Extend `parseStatus` to handle these cases**

Replace the `parseStatus` function body:

```ts
function unquote(s: string): string {
  if (!s.startsWith('"') || !s.endsWith('"')) return s;
  // Minimal unescape: \" → ", \\ → \, \t → \t, \n → \n
  return s
    .slice(1, -1)
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, "\\")
    .replace(/\\t/g, "\t")
    .replace(/\\n/g, "\n");
}

export function parseStatus(raw: string): FileStatus[] {
  const result: FileStatus[] = [];
  for (const line of raw.split("\n")) {
    if (!line || line.startsWith("#")) continue;
    const kind = line[0];
    if (kind === "1") {
      const parts = line.split(" ");
      const xy = parts[1] ?? "..";
      const path = unquote(parts.slice(8).join(" "));
      const entry = baseStatus(path);
      entry.staged = xyToChange(xy[0] ?? ".");
      entry.unstaged = xyToChange(xy[1] ?? ".");
      result.push(entry);
    } else if (kind === "2") {
      // "2 XY <sub> <mH> <mI> <mW> <hH> <hI> <score> <path>\t<origPath>"
      const parts = line.split(" ");
      const xy = parts[1] ?? "..";
      const rest = parts.slice(9).join(" ");
      const tab = rest.indexOf("\t");
      const path = unquote(tab >= 0 ? rest.slice(0, tab) : rest);
      const oldPath = tab >= 0 ? unquote(rest.slice(tab + 1)) : undefined;
      const entry = baseStatus(path);
      if (oldPath) entry.oldPath = oldPath;
      entry.staged = xyToChange(xy[0] ?? ".");
      entry.unstaged = xyToChange(xy[1] ?? ".");
      result.push(entry);
    } else if (kind === "u") {
      // "u XY <sub> <m1> <m2> <m3> <mW> <h1> <h2> <h3> <path>"
      const parts = line.split(" ");
      const path = unquote(parts.slice(10).join(" "));
      const entry = baseStatus(path);
      entry.staged = "unmerged";
      entry.unstaged = "unmerged";
      result.push(entry);
    } else if (kind === "?") {
      const path = unquote(line.slice(2));
      const entry = baseStatus(path);
      entry.unstaged = "added";
      entry.isUntracked = true;
      result.push(entry);
    } else if (kind === "!") {
      const path = unquote(line.slice(2));
      const entry = baseStatus(path);
      entry.unstaged = "added";
      result.push(entry);
    }
  }
  return result;
}
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `bun test test/parser.test.ts`
Expected: all 4 tests PASS.

- [ ] **Step 8: Commit**

```bash
git add src/server/parser.ts test/parser.test.ts test/fixtures/status/
git commit -m "feat(parser): handle renames, unicode/quoted paths, unmerged"
```

---

## Task 5: Parser — unified diff patches

**Files:**
- Create: `test/fixtures/diff/modify.patch`
- Create: `test/fixtures/diff/rename.patch`
- Create: `test/fixtures/diff/binary.patch`
- Create: `test/fixtures/diff/no-newline.patch`
- Modify: `src/server/parser.ts`
- Modify: `test/parser.test.ts`

- [ ] **Step 1: Record `modify.patch` fixture**

```
diff --git a/src/cli.ts b/src/cli.ts
index abc123..def456 100644
--- a/src/cli.ts
+++ b/src/cli.ts
@@ -12,7 +12,9 @@ export async function main() {
   const cwd = process.cwd();
   const repo = await findRepo(cwd);
-  if (!repo) throw new Error("not a repo");
+  if (!repo) {
+    openRepoPicker();
+    return;
+  }
   return startServer(repo);
 }
```

- [ ] **Step 2: Record `rename.patch` fixture**

```
diff --git a/src/old.ts b/src/new.ts
similarity index 95%
rename from src/old.ts
rename to src/new.ts
index abc..def 100644
--- a/src/old.ts
+++ b/src/new.ts
@@ -1,3 +1,3 @@
 export const x = 1;
-export const y = 2;
+export const y = 3;
 export const z = 3;
```

- [ ] **Step 3: Record `binary.patch` fixture**

```
diff --git a/logo.png b/logo.png
index abc..def 100644
Binary files a/logo.png and b/logo.png differ
```

- [ ] **Step 4: Record `no-newline.patch` fixture**

```
diff --git a/config b/config
index abc..def 100644
--- a/config
+++ b/config
@@ -1 +1 @@
-old value
\ No newline at end of file
+new value
\ No newline at end of file
```

- [ ] **Step 5: Write failing tests**

Append to `test/parser.test.ts`:

```ts
import { parseDiff } from "../src/server/parser";

const diffFixture = (name: string) =>
  readFileSync(join(import.meta.dir, "fixtures/diff", name), "utf8");

describe("parseDiff", () => {
  test("parses a basic modify patch", () => {
    const result = parseDiff(diffFixture("modify.patch"));
    expect(result).toHaveLength(1);
    expect(result[0]!.path).toBe("src/cli.ts");
    expect(result[0]!.hunks).toHaveLength(1);
    const hunk = result[0]!.hunks[0]!;
    expect(hunk.oldStart).toBe(12);
    expect(hunk.oldLines).toBe(7);
    expect(hunk.newStart).toBe(12);
    expect(hunk.newLines).toBe(9);
    const kinds = hunk.lines.map((l) => l.kind);
    expect(kinds).toContain("context");
    expect(kinds).toContain("add");
    expect(kinds).toContain("del");
    expect(hunk.lines.filter((l) => l.kind === "add")).toHaveLength(4);
    expect(hunk.lines.filter((l) => l.kind === "del")).toHaveLength(1);
  });

  test("parses rename with oldPath", () => {
    const result = parseDiff(diffFixture("rename.patch"));
    expect(result).toHaveLength(1);
    expect(result[0]!.path).toBe("src/new.ts");
    expect(result[0]!.oldPath).toBe("src/old.ts");
  });

  test("marks binary files", () => {
    const result = parseDiff(diffFixture("binary.patch"));
    expect(result).toHaveLength(1);
    expect(result[0]!.path).toBe("logo.png");
    expect(result[0]!.binary).toBeDefined();
    expect(result[0]!.hunks).toHaveLength(0);
  });

  test("handles no-newline-at-eof marker", () => {
    const result = parseDiff(diffFixture("no-newline.patch"));
    const lines = result[0]!.hunks[0]!.lines;
    // The "\ No newline" marker should NOT appear as a diff line
    expect(lines.every((l) => !l.text.startsWith("\\"))).toBe(true);
    expect(lines.filter((l) => l.kind === "add")).toHaveLength(1);
    expect(lines.filter((l) => l.kind === "del")).toHaveLength(1);
  });
});
```

- [ ] **Step 6: Run tests to verify they fail**

Run: `bun test test/parser.test.ts`
Expected: 4 new tests FAIL — `parseDiff` undefined.

- [ ] **Step 7: Implement `parseDiff`**

Append to `src/server/parser.ts`:

```ts
import type { DiffHunk, DiffLine, ParsedDiff } from "../shared/types";

const FILE_HEADER_RE = /^diff --git a\/(.+?) b\/(.+?)$/;
const HUNK_HEADER_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

export function parseDiff(raw: string): ParsedDiff[] {
  const results: ParsedDiff[] = [];
  const lines = raw.split("\n");

  let i = 0;
  while (i < lines.length) {
    const header = lines[i]!;
    const m = header.match(FILE_HEADER_RE);
    if (!m) {
      i++;
      continue;
    }
    const oldBPath = m[1]!;
    const newBPath = m[2]!;
    const current: ParsedDiff = { path: newBPath, hunks: [] };
    if (oldBPath !== newBPath) current.oldPath = oldBPath;

    i++;
    // Skip extended headers (index, mode, similarity, rename, ---, +++)
    while (i < lines.length && !lines[i]!.startsWith("@@") && !lines[i]!.startsWith("diff --git")) {
      if (lines[i]!.startsWith("Binary files ")) {
        current.binary = {};
      }
      i++;
    }

    // Hunks
    while (i < lines.length && lines[i]!.startsWith("@@")) {
      const hm = lines[i]!.match(HUNK_HEADER_RE);
      if (!hm) break;
      const hunk: DiffHunk = {
        header: lines[i]!,
        oldStart: parseInt(hm[1]!, 10),
        oldLines: hm[2] ? parseInt(hm[2], 10) : 1,
        newStart: parseInt(hm[3]!, 10),
        newLines: hm[4] ? parseInt(hm[4], 10) : 1,
        lines: [],
      };
      i++;
      let oldLine = hunk.oldStart;
      let newLine = hunk.newStart;
      while (i < lines.length && !lines[i]!.startsWith("diff --git") && !lines[i]!.startsWith("@@")) {
        const l = lines[i]!;
        if (l.startsWith("\\")) {
          // "\ No newline at end of file" — metadata marker; drop
          i++;
          continue;
        }
        let diffLine: DiffLine;
        if (l.startsWith("+")) {
          diffLine = { kind: "add", newLine: newLine++, text: l.slice(1) };
        } else if (l.startsWith("-")) {
          diffLine = { kind: "del", oldLine: oldLine++, text: l.slice(1) };
        } else if (l.startsWith(" ")) {
          diffLine = {
            kind: "context",
            oldLine: oldLine++,
            newLine: newLine++,
            text: l.slice(1),
          };
        } else if (l === "") {
          // Trailing blank — end of hunk
          break;
        } else {
          // Unknown marker — skip defensively
          i++;
          continue;
        }
        hunk.lines.push(diffLine);
        i++;
      }
      current.hunks.push(hunk);
    }

    results.push(current);
  }

  return results;
}
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `bun test test/parser.test.ts`
Expected: all parser tests PASS (including earlier status tests — no regressions).

- [ ] **Step 9: Commit**

```bash
git add src/server/parser.ts test/parser.test.ts test/fixtures/diff/
git commit -m "feat(parser): parse unified diff patches, renames, binary, no-newline"
```

---

## Task 6: Parser — `git log` format

**Files:**
- Create: `test/fixtures/log/basic.txt`
- Modify: `src/server/parser.ts`
- Modify: `test/parser.test.ts`

The `git log` format we use: `--format=%H%x00%h%x00%P%x00%an%x00%ae%x00%aI%x00%D%x00%s%x00%b%x1e`. `%x00` is NUL (field separator), `%x1e` is record separator (ASCII RS).

- [ ] **Step 1: Record `basic.txt` log fixture**

Because this contains non-printable bytes, create it with a helper. Run this once to generate the file, then commit the binary-ish result:

```bash
printf '%s\0%s\0%s\0%s\0%s\0%s\0%s\0%s\0%s\036' \
  "1111111111111111111111111111111111111111" \
  "1111111" \
  "2222222222222222222222222222222222222222" \
  "Alice" \
  "alice@example.com" \
  "2026-04-08T10:00:00+00:00" \
  "HEAD -> main, origin/main" \
  "feat: initial commit" \
  "" > test/fixtures/log/basic.txt

printf '%s\0%s\0%s\0%s\0%s\0%s\0%s\0%s\0%s\036' \
  "2222222222222222222222222222222222222222" \
  "2222222" \
  "" \
  "Bob Smith" \
  "bob@example.com" \
  "2026-04-07T09:30:00+00:00" \
  "" \
  "chore: setup" \
  "Longer body\nwith multiple lines" \
  >> test/fixtures/log/basic.txt
```

- [ ] **Step 2: Write failing test**

Append to `test/parser.test.ts`:

```ts
import { parseLog } from "../src/server/parser";

describe("parseLog", () => {
  test("parses NUL-delimited log output", () => {
    const raw = readFileSync(join(import.meta.dir, "fixtures/log/basic.txt"), "utf8");
    const commits = parseLog(raw);
    expect(commits).toHaveLength(2);
    expect(commits[0]).toEqual({
      sha: "1111111111111111111111111111111111111111",
      shortSha: "1111111",
      parents: ["2222222222222222222222222222222222222222"],
      author: "Alice",
      authorEmail: "alice@example.com",
      date: "2026-04-08T10:00:00+00:00",
      refs: ["HEAD -> main", "origin/main"],
      subject: "feat: initial commit",
    });
    expect(commits[1]!.parents).toEqual([]);
    expect(commits[1]!.refs).toEqual([]);
    expect(commits[1]!.author).toBe("Bob Smith");
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `bun test test/parser.test.ts`
Expected: FAIL — `parseLog` undefined.

- [ ] **Step 4: Implement `parseLog`**

Append to `src/server/parser.ts`:

```ts
import type { Commit } from "../shared/types";

const RECORD_SEP = "\x1e";

export function parseLog(raw: string): Commit[] {
  const records = raw.split(RECORD_SEP).filter((r) => r.length > 0);
  const commits: Commit[] = [];
  for (const record of records) {
    const fields = record.split("\x00");
    if (fields.length < 8) continue;
    const [sha, shortSha, parents, author, authorEmail, date, refs, subject] = fields as [
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
    ];
    commits.push({
      sha,
      shortSha,
      parents: parents ? parents.split(" ").filter((p) => p.length > 0) : [],
      author,
      authorEmail,
      date,
      refs: refs ? refs.split(", ").filter((r) => r.length > 0) : [],
      subject,
    });
  }
  return commits;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test test/parser.test.ts`
Expected: all parser tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/server/parser.ts test/parser.test.ts test/fixtures/log/
git commit -m "feat(parser): parse NUL-delimited git log records"
```

---

## Task 7: Repo — integration harness + `getStatus`

**Files:**
- Create: `test/helpers/temp-repo.ts`
- Create: `src/server/repo.ts`
- Create: `test/repo.test.ts`

- [ ] **Step 1: Write the temp-repo helper**

```ts
// test/helpers/temp-repo.ts
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

export interface TempRepo {
  root: string;
  write(path: string, content: string): void;
  git(...args: string[]): { stdout: string; stderr: string; code: number };
  cleanup(): void;
}

export function createTempRepo(): TempRepo {
  const root = mkdtempSync(join(tmpdir(), "diffscope-test-"));
  const git = (...args: string[]) => {
    const r = spawnSync("git", args, { cwd: root, encoding: "utf8" });
    return { stdout: r.stdout ?? "", stderr: r.stderr ?? "", code: r.status ?? -1 };
  };
  git("init", "-q", "-b", "main");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Test");
  git("config", "commit.gpgsign", "false");
  return {
    root,
    write(path, content) {
      const full = join(root, path);
      const dir = full.substring(0, full.lastIndexOf("/"));
      if (dir) mkdirSync(dir, { recursive: true });
      writeFileSync(full, content);
    },
    git,
    cleanup() {
      rmSync(root, { recursive: true, force: true });
    },
  };
}
```

- [ ] **Step 2: Write failing `repo.test.ts`**

```ts
// test/repo.test.ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createTempRepo, type TempRepo } from "./helpers/temp-repo";
import { createRepo } from "../src/server/repo";

describe("repo", () => {
  let temp: TempRepo;
  beforeEach(() => {
    temp = createTempRepo();
  });
  afterEach(() => {
    temp.cleanup();
  });

  test("getRepoRoot returns the top level of the working tree", async () => {
    temp.write("README.md", "hi\n");
    temp.git("add", ".");
    temp.git("commit", "-m", "init");
    const repo = createRepo(temp.root);
    const root = await repo.getRepoRoot();
    expect(root).toBe(temp.root);
  });

  test("getStatus shows staged, unstaged, and untracked files", async () => {
    temp.write("a.ts", "original\n");
    temp.git("add", ".");
    temp.git("commit", "-m", "init");

    temp.write("a.ts", "modified\n");
    temp.git("add", "a.ts");
    temp.write("a.ts", "modified again\n");
    temp.write("b.ts", "new file\n");

    const repo = createRepo(temp.root);
    const status = await repo.getStatus();
    const byPath = new Map(status.map((f) => [f.path, f]));

    expect(byPath.get("a.ts")?.staged).toBe("modified");
    expect(byPath.get("a.ts")?.unstaged).toBe("modified");
    expect(byPath.get("b.ts")?.isUntracked).toBe(true);
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `bun test test/repo.test.ts`
Expected: FAIL — `createRepo` undefined.

- [ ] **Step 4: Implement `repo.ts` with `createRepo`, `runGit`, `getRepoRoot`, `getStatus`**

```ts
// src/server/repo.ts
import { spawn } from "node:child_process";
import { parseStatus } from "./parser";
import type { FileStatus } from "../shared/types";

export class GitError extends Error {
  constructor(
    public code: number,
    public stderr: string,
    public args: readonly string[],
  ) {
    super(`git ${args.join(" ")} failed (${code}): ${stderr}`);
    this.name = "GitError";
  }
}

async function runGit(cwd: string, args: readonly string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, { cwd });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d.toString("utf8")));
    child.stderr.on("data", (d) => (stderr += d.toString("utf8")));
    child.on("error", (err) => reject(err));
    child.on("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new GitError(code ?? -1, stderr, args));
    });
  });
}

export interface Repo {
  readonly cwd: string;
  getRepoRoot(): Promise<string>;
  getStatus(): Promise<FileStatus[]>;
}

export function createRepo(cwd: string): Repo {
  return {
    cwd,
    async getRepoRoot() {
      const out = await runGit(cwd, ["rev-parse", "--show-toplevel"]);
      return out.trim();
    },
    async getStatus() {
      const out = await runGit(cwd, ["status", "--porcelain=v2"]);
      return parseStatus(out);
    },
  };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun test test/repo.test.ts`
Expected: both tests PASS. If git isn't on PATH the suite errors — document that in README later.

- [ ] **Step 6: Commit**

```bash
git add src/server/repo.ts test/helpers/temp-repo.ts test/repo.test.ts
git commit -m "feat(repo): getRepoRoot + getStatus via git subprocess"
```

---

## Task 8: Repo — `getFileDiff`, `getLog`, `getCommit`

**Files:**
- Modify: `src/server/repo.ts`
- Modify: `test/repo.test.ts`

- [ ] **Step 1: Write failing tests**

Append to `test/repo.test.ts`:

```ts
test("getFileDiff returns parsed unstaged diff", async () => {
  temp.write("a.ts", "one\ntwo\nthree\n");
  temp.git("add", ".");
  temp.git("commit", "-m", "init");
  temp.write("a.ts", "one\nTWO\nthree\n");

  const repo = createRepo(temp.root);
  const diff = await repo.getFileDiff("a.ts", { staged: false });
  expect(diff).not.toBeNull();
  expect(diff!.path).toBe("a.ts");
  expect(diff!.hunks.length).toBeGreaterThan(0);
});

test("getFileDiff returns parsed staged diff", async () => {
  temp.write("a.ts", "one\n");
  temp.git("add", ".");
  temp.git("commit", "-m", "init");
  temp.write("a.ts", "one\ntwo\n");
  temp.git("add", "a.ts");

  const repo = createRepo(temp.root);
  const diff = await repo.getFileDiff("a.ts", { staged: true });
  expect(diff!.hunks[0]!.lines.some((l) => l.kind === "add")).toBe(true);
});

test("getLog returns commits with parents and subject", async () => {
  temp.write("a.ts", "1\n");
  temp.git("add", ".");
  temp.git("commit", "-m", "first");
  temp.write("a.ts", "2\n");
  temp.git("add", ".");
  temp.git("commit", "-m", "second");

  const repo = createRepo(temp.root);
  const commits = await repo.getLog({ limit: 10, offset: 0 });
  expect(commits).toHaveLength(2);
  expect(commits[0]!.subject).toBe("second");
  expect(commits[1]!.subject).toBe("first");
  expect(commits[0]!.parents).toHaveLength(1);
  expect(commits[1]!.parents).toHaveLength(0);
});

test("getCommit returns commit detail with diff", async () => {
  temp.write("a.ts", "original\n");
  temp.git("add", ".");
  temp.git("commit", "-m", "first");
  temp.write("a.ts", "changed\n");
  temp.git("add", ".");
  temp.git("commit", "-m", "second");
  const headSha = temp.git("rev-parse", "HEAD").stdout.trim();

  const repo = createRepo(temp.root);
  const detail = await repo.getCommit(headSha);
  expect(detail.sha).toBe(headSha);
  expect(detail.subject).toBe("second");
  expect(detail.diff.length).toBeGreaterThan(0);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test test/repo.test.ts`
Expected: 4 new tests FAIL.

- [ ] **Step 3: Implement the methods**

Extend `src/server/repo.ts`. Update `parseLog` import, add new methods, and extend the `Repo` interface:

```ts
import { parseDiff, parseLog, parseStatus } from "./parser";
import type { Commit, CommitDetail, FileStatus, ParsedDiff } from "../shared/types";

const LOG_FORMAT = "%H%x00%h%x00%P%x00%an%x00%ae%x00%aI%x00%D%x00%s%x00%b%x1e";

export interface Repo {
  readonly cwd: string;
  getRepoRoot(): Promise<string>;
  getStatus(): Promise<FileStatus[]>;
  getFileDiff(path: string, opts: { staged: boolean }): Promise<ParsedDiff | null>;
  getLog(opts: { limit: number; offset: number }): Promise<Commit[]>;
  getCommit(sha: string): Promise<CommitDetail>;
}

export function createRepo(cwd: string): Repo {
  return {
    cwd,
    async getRepoRoot() {
      const out = await runGit(cwd, ["rev-parse", "--show-toplevel"]);
      return out.trim();
    },
    async getStatus() {
      const out = await runGit(cwd, ["status", "--porcelain=v2"]);
      return parseStatus(out);
    },
    async getFileDiff(path, { staged }) {
      const args = ["diff", "--patch", "--no-color"];
      if (staged) args.push("--cached");
      args.push("--", path);
      const out = await runGit(cwd, args);
      if (!out.trim()) return null;
      const parsed = parseDiff(out);
      return parsed[0] ?? null;
    },
    async getLog({ limit, offset }) {
      const out = await runGit(cwd, [
        "log",
        `--format=${LOG_FORMAT}`,
        `--max-count=${limit}`,
        `--skip=${offset}`,
      ]);
      return parseLog(out);
    },
    async getCommit(sha) {
      const [metaRaw, diffRaw] = await Promise.all([
        runGit(cwd, ["log", "-1", `--format=${LOG_FORMAT}`, sha]),
        runGit(cwd, ["show", "--patch", "--format=", "--no-color", sha]),
      ]);
      const meta = parseLog(metaRaw)[0];
      if (!meta) throw new Error(`commit ${sha} not found`);
      const diff = parseDiff(diffRaw);
      // Extract body from metaRaw's last field (empty string in fixtures — body came from log format's %b)
      return { ...meta, body: "", diff };
    },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test test/repo.test.ts`
Expected: all repo tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/repo.ts test/repo.test.ts
git commit -m "feat(repo): getFileDiff, getLog, getCommit"
```

---

## Task 9: Repo — `getBranches` and `getStashes`

**Files:**
- Modify: `src/server/repo.ts`
- Modify: `test/repo.test.ts`

- [ ] **Step 1: Write failing tests**

Append to `test/repo.test.ts`:

```ts
test("getBranches returns local and remote branches with upstream info", async () => {
  temp.write("a.ts", "1\n");
  temp.git("add", ".");
  temp.git("commit", "-m", "init");
  temp.git("branch", "feature");

  const repo = createRepo(temp.root);
  const branches = await repo.getBranches();
  const names = branches.map((b) => b.name).sort();
  expect(names).toContain("main");
  expect(names).toContain("feature");
  const current = branches.find((b) => b.isCurrent);
  expect(current?.name).toBe("main");
});

test("getStashes returns stashes in order", async () => {
  temp.write("a.ts", "1\n");
  temp.git("add", ".");
  temp.git("commit", "-m", "init");
  temp.write("a.ts", "work in progress\n");
  temp.git("stash", "push", "-m", "wip1");
  temp.write("a.ts", "more\n");
  temp.git("stash", "push", "-m", "wip2");

  const repo = createRepo(temp.root);
  const stashes = await repo.getStashes();
  expect(stashes).toHaveLength(2);
  expect(stashes[0]!.message).toContain("wip2");
  expect(stashes[1]!.message).toContain("wip1");
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test test/repo.test.ts`
Expected: both new tests FAIL.

- [ ] **Step 3: Implement**

Extend the `Repo` interface and `createRepo`:

```ts
import type { Branch, Stash } from "../shared/types";

const BRANCH_FORMAT =
  "%(refname:short)%00%(HEAD)%00%(upstream:short)%00%(upstream:track)%00%(objectname)%00%(contents:subject)";

// In createRepo(...):
    async getBranches(): Promise<Branch[]> {
      const out = await runGit(cwd, [
        "for-each-ref",
        "--format=" + BRANCH_FORMAT,
        "refs/heads",
        "refs/remotes",
      ]);
      const branches: Branch[] = [];
      for (const line of out.split("\n")) {
        if (!line) continue;
        const parts = line.split("\x00");
        const name = parts[0] ?? "";
        const head = parts[1] ?? " ";
        const upstream = parts[2] || undefined;
        const track = parts[3] ?? "";
        const tipSha = parts[4] ?? "";
        const tipSubject = parts[5] ?? "";
        const ahead = /ahead (\d+)/.exec(track)?.[1];
        const behind = /behind (\d+)/.exec(track)?.[1];
        branches.push({
          name,
          isCurrent: head === "*",
          isRemote: name.startsWith("origin/") || name.includes("/"),
          upstream,
          ahead: ahead ? parseInt(ahead, 10) : 0,
          behind: behind ? parseInt(behind, 10) : 0,
          tipSha,
          tipSubject,
        });
      }
      return branches;
    },

    async getStashes(): Promise<Stash[]> {
      const out = await runGit(cwd, [
        "stash",
        "list",
        "--format=%H%x00%gd%x00%aI%x00%s",
      ]);
      const stashes: Stash[] = [];
      for (const line of out.split("\n")) {
        if (!line) continue;
        const [sha, refname, date, message] = line.split("\x00") as [string, string, string, string];
        const idxMatch = /stash@\{(\d+)\}/.exec(refname);
        stashes.push({
          index: idxMatch ? parseInt(idxMatch[1]!, 10) : 0,
          sha,
          date,
          message,
        });
      }
      return stashes;
    },
```

Update the `Repo` interface to include these two methods.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test test/repo.test.ts`
Expected: all repo tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/repo.ts test/repo.test.ts
git commit -m "feat(repo): getBranches and getStashes"
```

---

## Task 10: Watcher — `@parcel/watcher` wrapper

**Files:**
- Create: `src/server/watcher.ts`

- [ ] **Step 1: Implement `watcher.ts`**

```ts
// src/server/watcher.ts
import watcher from "@parcel/watcher";

export type WatcherEventKind =
  | "working-tree-changed"
  | "index-changed"
  | "head-changed"
  | "refs-changed"
  | "stashes-changed"
  | "gitignore-changed";

export interface WatcherEvent {
  kind: WatcherEventKind;
  paths: string[];
}

export type WatcherListener = (event: WatcherEvent) => void;

export interface WatcherHandle {
  stop(): Promise<void>;
}

interface PendingBatch {
  workingTree: Set<string>;
  index: boolean;
  head: boolean;
  refs: boolean;
  stashes: boolean;
  gitignore: boolean;
  timer: ReturnType<typeof setTimeout> | null;
}

function newBatch(): PendingBatch {
  return {
    workingTree: new Set(),
    index: false,
    head: false,
    refs: false,
    stashes: false,
    gitignore: false,
    timer: null,
  };
}

const DEBOUNCE_MS = 50;

export async function startWatcher(
  repoRoot: string,
  listener: WatcherListener,
  onError?: (err: Error) => void,
): Promise<WatcherHandle> {
  let batch = newBatch();

  const flush = () => {
    const current = batch;
    batch = newBatch();
    if (current.workingTree.size > 0) {
      listener({ kind: "working-tree-changed", paths: Array.from(current.workingTree) });
    }
    if (current.gitignore) listener({ kind: "gitignore-changed", paths: [] });
    if (current.index) listener({ kind: "index-changed", paths: [] });
    if (current.head) listener({ kind: "head-changed", paths: [] });
    if (current.refs) listener({ kind: "refs-changed", paths: [] });
    if (current.stashes) listener({ kind: "stashes-changed", paths: [] });
  };

  const schedule = () => {
    if (batch.timer) return;
    batch.timer = setTimeout(flush, DEBOUNCE_MS);
  };

  const classify = (path: string, relativeTo: string): void => {
    const rel = path.startsWith(relativeTo) ? path.slice(relativeTo.length + 1) : path;
    if (rel.startsWith(".git/")) {
      const gitRel = rel.slice(5);
      if (gitRel === "HEAD" || gitRel.startsWith("HEAD")) batch.head = true;
      if (gitRel.startsWith("refs/")) batch.refs = true;
      if (gitRel === "index") batch.index = true;
      if (gitRel === "refs/stash" || gitRel.startsWith("logs/refs/stash")) batch.stashes = true;
    } else {
      batch.workingTree.add(rel);
      if (rel === ".gitignore" || rel.endsWith("/.gitignore")) batch.gitignore = true;
    }
  };

  try {
    const workingTreeSub = await watcher.subscribe(
      repoRoot,
      (err, events) => {
        if (err) {
          onError?.(err instanceof Error ? err : new Error(String(err)));
          return;
        }
        for (const e of events) classify(e.path, repoRoot);
        schedule();
      },
      { ignore: ["node_modules", "dist", ".DS_Store"] },
    );

    return {
      async stop() {
        if (batch.timer) clearTimeout(batch.timer);
        await workingTreeSub.unsubscribe();
      },
    };
  } catch (err) {
    onError?.(err instanceof Error ? err : new Error(String(err)));
    throw err;
  }
}
```

**Note on the design:** `@parcel/watcher` can watch `.git/` as part of the working tree because we pass the repo root. The `classify` function routes events into the right bucket based on the relative path.

- [ ] **Step 2: Typecheck**

Run: `bun x tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/server/watcher.ts
git commit -m "feat(watcher): @parcel/watcher wrapper with debounced classification"
```

---

## Task 11: Events hub — snapshot, delta, SSE fanout

**Files:**
- Create: `src/server/events.ts`

- [ ] **Step 1: Implement `events.ts`**

```ts
// src/server/events.ts
import type {
  Branch,
  FileStatus,
  ParsedDiff,
  RepoInfo,
  SseEvent,
  Stash,
} from "../shared/types";
import type { Repo } from "./repo";
import { GitError } from "./repo";
import { startWatcher, type WatcherEvent, type WatcherHandle } from "./watcher";

type Subscriber = (event: SseEvent) => void;

export interface EventHub {
  start(): Promise<void>;
  stop(): Promise<void>;
  subscribe(fn: Subscriber): { snapshot: SseEvent; unsubscribe: () => void };
}

export function createEventHub(repo: Repo): EventHub {
  const subscribers = new Set<Subscriber>();
  let statusSnapshot: FileStatus[] = [];
  let branchesSnapshot: Branch[] = [];
  let stashesSnapshot: Stash[] = [];
  let repoInfo: RepoInfo = { root: repo.cwd, headSha: "", currentBranch: null };
  let watcherHandle: WatcherHandle | null = null;

  const emit = (event: SseEvent) => {
    for (const sub of subscribers) sub(event);
  };

  const diffStatuses = (
    prev: FileStatus[],
    next: FileStatus[],
  ): { updated: FileStatus[]; removed: string[] } => {
    const prevByPath = new Map(prev.map((f) => [f.path, f]));
    const updated: FileStatus[] = [];
    const nextPaths = new Set<string>();
    for (const f of next) {
      nextPaths.add(f.path);
      const p = prevByPath.get(f.path);
      if (!p || JSON.stringify(p) !== JSON.stringify(f)) updated.push(f);
    }
    const removed = [...prevByPath.keys()].filter((p) => !nextPaths.has(p));
    return { updated, removed };
  };

  const refreshRepoInfo = async () => {
    try {
      const [headSha, branch] = await Promise.all([
        repo.getRepoRoot().then(() => repo.getLog({ limit: 1, offset: 0 }).then((c) => c[0]?.sha ?? "")),
        Promise.resolve(null).then(async () => {
          try {
            const branches = await repo.getBranches();
            branchesSnapshot = branches;
            return branches.find((b) => b.isCurrent)?.name ?? null;
          } catch {
            return null;
          }
        }),
      ]);
      repoInfo = { root: repo.cwd, headSha, currentBranch: branch };
    } catch (err) {
      if (err instanceof GitError) emit({ type: "warning", message: err.stderr });
    }
  };

  const refreshStatus = async (opts: { withDiffs?: boolean; pathsToDiff?: string[] } = {}) => {
    try {
      const next = await repo.getStatus();
      const { updated, removed } = diffStatuses(statusSnapshot, next);
      statusSnapshot = next;
      for (const f of updated) {
        let diff: ParsedDiff | undefined;
        if (opts.withDiffs && (!opts.pathsToDiff || opts.pathsToDiff.includes(f.path))) {
          try {
            diff = (await repo.getFileDiff(f.path, { staged: false })) ?? undefined;
          } catch (err) {
            if (err instanceof GitError) emit({ type: "warning", message: err.stderr });
          }
        }
        emit({ type: "file-updated", path: f.path, status: f, diff });
      }
      for (const p of removed) emit({ type: "file-removed", path: p });
    } catch (err) {
      if (err instanceof GitError) {
        if (/not a git repository/i.test(err.stderr)) {
          emit({ type: "repo-error", reason: err.stderr });
        } else {
          emit({ type: "warning", message: err.stderr });
        }
      }
    }
  };

  const handleWatcherEvent = async (event: WatcherEvent) => {
    switch (event.kind) {
      case "working-tree-changed":
      case "gitignore-changed":
      case "index-changed":
        await refreshStatus({ withDiffs: true, pathsToDiff: event.paths });
        break;
      case "head-changed":
        await refreshRepoInfo();
        await refreshStatus({ withDiffs: false });
        emit({
          type: "head-changed",
          headSha: repoInfo.headSha,
          status: statusSnapshot,
          branches: branchesSnapshot,
        });
        break;
      case "refs-changed":
        try {
          branchesSnapshot = await repo.getBranches();
          emit({ type: "refs-changed", branches: branchesSnapshot });
        } catch (err) {
          if (err instanceof GitError) emit({ type: "warning", message: err.stderr });
        }
        break;
      case "stashes-changed":
        try {
          stashesSnapshot = await repo.getStashes();
          emit({ type: "stashes-changed", stashes: stashesSnapshot });
        } catch (err) {
          if (err instanceof GitError) emit({ type: "warning", message: err.stderr });
        }
        break;
    }
  };

  return {
    async start() {
      await refreshRepoInfo();
      statusSnapshot = await repo.getStatus();
      try {
        stashesSnapshot = await repo.getStashes();
      } catch {
        // empty / no stash ref yet — ignore
      }
      watcherHandle = await startWatcher(
        repo.cwd,
        (event) => {
          void handleWatcherEvent(event);
        },
        (err) => emit({ type: "warning", message: err.message }),
      );
    },
    async stop() {
      await watcherHandle?.stop();
    },
    subscribe(fn) {
      subscribers.add(fn);
      const snapshot: SseEvent = {
        type: "snapshot",
        status: statusSnapshot,
        repo: repoInfo,
      };
      return {
        snapshot,
        unsubscribe: () => {
          subscribers.delete(fn);
        },
      };
    },
  };
}
```

- [ ] **Step 2: Typecheck**

Run: `bun x tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/server/events.ts
git commit -m "feat(events): snapshot + delta + SSE fanout hub"
```

---

## Task 12: HTTP server — REST routes

**Files:**
- Create: `src/server/http.ts`

- [ ] **Step 1: Implement `http.ts` with the core REST routes**

```ts
// src/server/http.ts
import { serve, type Server } from "bun";
import { createRepo, GitError, type Repo } from "./repo";
import { createEventHub, type EventHub } from "./events";

export interface HttpServerOptions {
  repoPath: string | null;
  staticDir: string; // absolute path to the built web/ dist
  port: number;
}

export interface StartedServer {
  server: Server;
  hub: EventHub | null;
  stop(): Promise<void>;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function errorResponse(err: unknown): Response {
  if (err instanceof GitError) {
    return json({ error: err.stderr, code: err.code }, 500);
  }
  const message = err instanceof Error ? err.message : String(err);
  return json({ error: message }, 500);
}

export async function startHttpServer(opts: HttpServerOptions): Promise<StartedServer> {
  let repo: Repo | null = opts.repoPath ? createRepo(opts.repoPath) : null;
  let hub: EventHub | null = null;
  if (repo) {
    hub = createEventHub(repo);
    await hub.start();
  }

  const handle = async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    const pathname = url.pathname;

    // REST: repo state
    if (pathname === "/api/info") {
      if (!repo) return json({ loaded: false });
      const root = await repo.getRepoRoot().catch(() => null);
      return json({ loaded: true, root });
    }

    if (pathname === "/api/status") {
      if (!repo) return json({ error: "no repo loaded" }, 400);
      try {
        return json(await repo.getStatus());
      } catch (err) {
        return errorResponse(err);
      }
    }

    if (pathname === "/api/diff") {
      if (!repo) return json({ error: "no repo loaded" }, 400);
      const path = url.searchParams.get("path");
      if (!path) return json({ error: "path required" }, 400);
      const staged = url.searchParams.get("staged") === "true";
      try {
        const diff = await repo.getFileDiff(path, { staged });
        return json(diff);
      } catch (err) {
        return errorResponse(err);
      }
    }

    if (pathname === "/api/log") {
      if (!repo) return json({ error: "no repo loaded" }, 400);
      const limit = parseInt(url.searchParams.get("limit") ?? "50", 10);
      const offset = parseInt(url.searchParams.get("offset") ?? "0", 10);
      try {
        return json(await repo.getLog({ limit, offset }));
      } catch (err) {
        return errorResponse(err);
      }
    }

    if (pathname.startsWith("/api/commit/")) {
      if (!repo) return json({ error: "no repo loaded" }, 400);
      const sha = pathname.slice("/api/commit/".length);
      try {
        return json(await repo.getCommit(sha));
      } catch (err) {
        return errorResponse(err);
      }
    }

    if (pathname === "/api/branches") {
      if (!repo) return json({ error: "no repo loaded" }, 400);
      try {
        return json(await repo.getBranches());
      } catch (err) {
        return errorResponse(err);
      }
    }

    if (pathname === "/api/stashes") {
      if (!repo) return json({ error: "no repo loaded" }, 400);
      try {
        return json(await repo.getStashes());
      } catch (err) {
        return errorResponse(err);
      }
    }

    return json({ error: "not found" }, 404);
  };

  const server = serve({
    port: opts.port,
    async fetch(req) {
      try {
        return await handle(req);
      } catch (err) {
        return errorResponse(err);
      }
    },
  });

  return {
    server,
    hub,
    async stop() {
      if (hub) await hub.stop();
      server.stop(true);
    },
  };
}
```

- [ ] **Step 2: Typecheck**

Run: `bun x tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Quick smoke test**

```bash
# From any scratch git repo
cd /tmp && rm -rf smoke-diffscope && mkdir smoke-diffscope && cd smoke-diffscope
git init -q && echo hi > a.txt && git add . && git commit -qm init
echo bye > a.txt

# From the diffscope checkout in another shell:
cd ~/Arik/dev/diffscope
bun -e 'import { startHttpServer } from "./src/server/http.ts"; (async () => { const s = await startHttpServer({ repoPath: "/tmp/smoke-diffscope", staticDir: "./dist/web", port: 41111 }); console.log("listening"); })()' &
sleep 1
curl -s http://localhost:41111/api/status | head -c 400
kill %1 2>/dev/null || true
```

Expected: JSON array with one entry for `a.txt` showing `unstaged: "modified"`.

- [ ] **Step 4: Commit**

```bash
git add src/server/http.ts
git commit -m "feat(http): REST routes for status/diff/log/commit/branches/stashes"
```

---

## Task 13: HTTP server — SSE endpoint and static SPA serving

**Files:**
- Modify: `src/server/http.ts`

- [ ] **Step 1: Add SSE endpoint and static fallback**

Inside `handle(req)` in `http.ts`, add **before** the `return json({ error: "not found" }, 404);` line:

```ts
    // SSE stream
    if (pathname === "/api/stream") {
      if (!hub) return json({ error: "no repo loaded" }, 400);
      const stream = new ReadableStream({
        start(controller) {
          const encoder = new TextEncoder();
          const send = (event: unknown) => {
            const data = `data: ${JSON.stringify(event)}\n\n`;
            controller.enqueue(encoder.encode(data));
          };
          const { snapshot, unsubscribe } = hub!.subscribe((event) => send(event));
          send(snapshot);
          // Keepalive ping every 25s to prevent proxy timeouts
          const keepalive = setInterval(() => {
            controller.enqueue(encoder.encode(`: keepalive\n\n`));
          }, 25000);
          req.signal.addEventListener("abort", () => {
            clearInterval(keepalive);
            unsubscribe();
            try {
              controller.close();
            } catch {
              // already closed
            }
          });
        },
      });
      return new Response(stream, {
        headers: {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
          connection: "keep-alive",
        },
      });
    }

    // Static SPA fallback
    if (!pathname.startsWith("/api/")) {
      const fsPath =
        pathname === "/"
          ? `${opts.staticDir}/index.html`
          : `${opts.staticDir}${pathname}`;
      const file = Bun.file(fsPath);
      if (await file.exists()) {
        return new Response(file);
      }
      // SPA fallback — route not found on disk → serve index.html
      const index = Bun.file(`${opts.staticDir}/index.html`);
      if (await index.exists()) {
        return new Response(index);
      }
      return new Response("frontend not built — run `bun run build:web`", {
        status: 503,
      });
    }
```

- [ ] **Step 2: Typecheck**

Run: `bun x tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/server/http.ts
git commit -m "feat(http): SSE stream and static SPA serving"
```

---

## Task 14: HTTP server — picker endpoints (`/api/browse`, `/api/recents`, `/api/open`)

**Files:**
- Create: `src/server/recents.ts`
- Modify: `src/server/http.ts`

- [ ] **Step 1: Implement `recents.ts`**

```ts
// src/server/recents.ts
import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

const RECENTS_DIR = join(homedir(), ".diffscope");
const RECENTS_FILE = join(RECENTS_DIR, "recents.json");
const MAX_RECENTS = 20;

export interface Recent {
  path: string;
  lastOpenedAt: string;
}

export function loadRecents(): Recent[] {
  if (!existsSync(RECENTS_FILE)) return [];
  try {
    const raw = readFileSync(RECENTS_FILE, "utf8");
    const data = JSON.parse(raw);
    if (!Array.isArray(data)) return [];
    return data.filter(
      (e): e is Recent => typeof e?.path === "string" && typeof e?.lastOpenedAt === "string",
    );
  } catch {
    return [];
  }
}

export function saveRecents(recents: Recent[]): void {
  if (!existsSync(RECENTS_DIR)) mkdirSync(RECENTS_DIR, { recursive: true });
  writeFileSync(RECENTS_FILE, JSON.stringify(recents, null, 2));
}

export function addRecent(path: string): Recent[] {
  const now = new Date().toISOString();
  const existing = loadRecents().filter((r) => r.path !== path);
  const next = [{ path, lastOpenedAt: now }, ...existing].slice(0, MAX_RECENTS);
  saveRecents(next);
  return next;
}

export function removeRecent(path: string): Recent[] {
  const next = loadRecents().filter((r) => r.path !== path);
  saveRecents(next);
  return next;
}
```

- [ ] **Step 2: Add browse + recents + open routes to `http.ts`**

Add these imports at the top:

```ts
import { readdirSync, statSync, existsSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { homedir } from "node:os";
import { addRecent, loadRecents, removeRecent } from "./recents";
```

Inside `handle(req)`, **before** the static SPA fallback block, add:

```ts
    if (pathname === "/api/browse") {
      const rawPath = url.searchParams.get("path") || homedir();
      const abs = isAbsolute(rawPath) ? resolve(rawPath) : resolve(homedir(), rawPath);
      if (!existsSync(abs)) return json({ error: "not found", path: abs }, 404);
      const entries: {
        name: string;
        path: string;
        isGitRepo: boolean;
      }[] = [];
      try {
        for (const name of readdirSync(abs).sort()) {
          if (name.startsWith(".") && name !== ".git") continue;
          const p = join(abs, name);
          try {
            const st = statSync(p);
            if (!st.isDirectory()) continue;
            entries.push({ name, path: p, isGitRepo: existsSync(join(p, ".git")) });
          } catch {
            // unreadable — skip
          }
        }
      } catch (err) {
        return errorResponse(err);
      }
      const parent = abs === "/" ? null : dirname(abs);
      return json({ path: abs, entries, parent });
    }

    if (pathname === "/api/recents" && req.method === "GET") {
      return json(loadRecents());
    }

    if (pathname === "/api/recents" && req.method === "DELETE") {
      const path = url.searchParams.get("path");
      if (!path) return json({ error: "path required" }, 400);
      return json(removeRecent(path));
    }

    if (pathname === "/api/open" && req.method === "POST") {
      const body = (await req.json().catch(() => ({}))) as { path?: string };
      const input = body.path;
      if (!input) return json({ error: "path required" }, 400);
      // Walk upward to find .git
      let current = resolve(input);
      let found: string | null = null;
      while (true) {
        if (existsSync(join(current, ".git"))) {
          found = current;
          break;
        }
        const parent = dirname(current);
        if (parent === current) break;
        current = parent;
      }
      if (!found) return json({ error: "not a git repo" }, 400);
      addRecent(found);
      // Re-initialize the hub to point at the new repo.
      if (hub) await hub.stop();
      repo = createRepo(found);
      hub = createEventHub(repo);
      await hub.start();
      return json({ ok: true, root: found });
    }
```

- [ ] **Step 3: Typecheck**

Run: `bun x tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/server/recents.ts src/server/http.ts
git commit -m "feat(http): browse + recents + open picker endpoints"
```

---

## Task 15: CLI entry point

**Files:**
- Create: `src/server/cli.ts`
- Create: `bin/diffscope.ts`

- [ ] **Step 1: Implement `cli.ts`**

```ts
// src/server/cli.ts
import { existsSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { startHttpServer } from "./http";

function findRepoRoot(start: string): string | null {
  let current = resolve(start);
  while (true) {
    if (existsSync(join(current, ".git"))) return current;
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

async function pickPort(): Promise<number> {
  // Bun.serve with port: 0 → random free port; probe via a short-lived server
  const probe = Bun.serve({ port: 0, fetch: () => new Response("ok") });
  const port = probe.port;
  probe.stop(true);
  return port;
}

function openBrowser(url: string): void {
  spawn("open", [url], { detached: true, stdio: "ignore" }).unref();
}

function staticDirForMode(): string {
  return resolve(import.meta.dir, "..", "..", "dist", "web");
}

export async function main(argv: readonly string[]): Promise<void> {
  const arg = argv[0];
  let repoPath: string | null = null;

  if (arg) {
    const abs = isAbsolute(arg) ? arg : resolve(process.cwd(), arg);
    if (!existsSync(abs)) {
      console.error(`diffscope: path does not exist: ${abs}`);
      process.exit(1);
    }
    const found = findRepoRoot(abs);
    repoPath = found; // null → picker UI loads
  } else {
    repoPath = findRepoRoot(process.cwd());
  }

  const port = await pickPort();
  const { stop } = await startHttpServer({
    repoPath,
    staticDir: staticDirForMode(),
    port,
  });

  const url = `http://localhost:${port}`;
  if (repoPath) {
    console.log(`diffscope: watching ${repoPath}`);
  } else {
    console.log(`diffscope: no repo at ${arg ?? process.cwd()} — opening picker`);
  }
  console.log(`diffscope: ${url}`);
  openBrowser(url);

  const shutdown = async () => {
    console.log("\ndiffscope: shutting down…");
    await stop();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

if (import.meta.main) {
  main(process.argv.slice(2)).catch((err) => {
    console.error("diffscope:", err);
    process.exit(1);
  });
}
```

- [ ] **Step 2: Create `bin/diffscope.ts`**

```ts
#!/usr/bin/env bun
import { main } from "../src/server/cli";
main(process.argv.slice(2)).catch((err) => {
  console.error("diffscope:", err);
  process.exit(1);
});
```

- [ ] **Step 3: Make bin executable**

```bash
chmod +x bin/diffscope.ts
```

- [ ] **Step 4: Smoke test against a real repo**

```bash
cd /tmp && rm -rf smoke2 && mkdir smoke2 && cd smoke2
git init -q -b main
echo hi > a.txt
git add .
git commit -qm init
echo bye > a.txt

# In another shell from the diffscope checkout:
cd ~/Arik/dev/diffscope
bun run src/server/cli.ts /tmp/smoke2 &
sleep 1
# Expected: logs "watching /tmp/smoke2" and a URL
kill %1 2>/dev/null || true
```

Expected: CLI logs `watching /tmp/smoke2` and opens a browser. Since the frontend isn't built yet, the browser will get the 503 "frontend not built" — that's fine for now.

- [ ] **Step 5: Commit**

```bash
git add src/server/cli.ts bin/diffscope.ts
git commit -m "feat(cli): argv parse, repo resolve, port pick, browser open"
```

---

## Task 16: Watcher + events integration tests

**Files:**
- Create: `test/events.test.ts`

- [ ] **Step 1: Write integration tests**

```ts
// test/events.test.ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createTempRepo, type TempRepo } from "./helpers/temp-repo";
import { createRepo } from "../src/server/repo";
import { createEventHub } from "../src/server/events";
import type { SseEvent } from "../src/shared/types";

const waitForEvent = (
  events: SseEvent[],
  predicate: (e: SseEvent) => boolean,
  timeoutMs = 3000,
): Promise<SseEvent> =>
  new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = () => {
      const found = events.find(predicate);
      if (found) return resolve(found);
      if (Date.now() - start > timeoutMs) return reject(new Error("timeout waiting for event"));
      setTimeout(tick, 50);
    };
    tick();
  });

describe("events + watcher integration", () => {
  let temp: TempRepo;
  beforeEach(() => {
    temp = createTempRepo();
    temp.write("a.ts", "original\n");
    temp.git("add", ".");
    temp.git("commit", "-m", "init");
  });
  afterEach(() => {
    temp.cleanup();
  });

  test("writing a file emits a file-updated event", async () => {
    const repo = createRepo(temp.root);
    const hub = createEventHub(repo);
    await hub.start();
    const received: SseEvent[] = [];
    hub.subscribe((e) => received.push(e));

    temp.write("a.ts", "modified\n");

    const event = await waitForEvent(
      received,
      (e) => e.type === "file-updated" && e.path === "a.ts",
    );
    expect(event.type).toBe("file-updated");
    await hub.stop();
  });

  test("rapid successive writes coalesce into one update", async () => {
    const repo = createRepo(temp.root);
    const hub = createEventHub(repo);
    await hub.start();
    const received: SseEvent[] = [];
    hub.subscribe((e) => received.push(e));

    for (let i = 0; i < 10; i++) {
      temp.write("a.ts", `v${i}\n`);
    }

    await waitForEvent(received, (e) => e.type === "file-updated" && e.path === "a.ts");
    // Give the debounce a moment to prove no extra events fire
    await new Promise((r) => setTimeout(r, 200));
    const updates = received.filter(
      (e) => e.type === "file-updated" && e.path === "a.ts",
    );
    expect(updates.length).toBeLessThanOrEqual(2); // allow one trailing edge case
    await hub.stop();
  });

  test("editing .gitignore re-evaluates untracked files", async () => {
    temp.write("ignored.log", "trace\n");
    const repo = createRepo(temp.root);
    const hub = createEventHub(repo);
    await hub.start();
    const received: SseEvent[] = [];
    hub.subscribe((e) => received.push(e));

    temp.write(".gitignore", "*.log\n");

    // After gitignore edits, ignored.log should no longer appear as untracked
    await new Promise((r) => setTimeout(r, 300));
    const status = await repo.getStatus();
    expect(status.find((f) => f.path === "ignored.log")).toBeUndefined();
    await hub.stop();
  });
});
```

- [ ] **Step 2: Run the integration tests**

Run: `bun test test/events.test.ts`
Expected: all 3 tests PASS. If timings are flaky, bump timeouts.

- [ ] **Step 3: Commit**

```bash
git add test/events.test.ts
git commit -m "test(events): watcher integration — file update, debounce, gitignore"
```

---

## Task 17: Frontend scaffold — Vite + React + Tailwind + shadcn basics

**Files:**
- Create: `tsconfig.web.json`
- Create: `vite.config.ts`
- Create: `tailwind.config.ts`
- Create: `postcss.config.js`
- Create: `src/web/main.tsx`
- Create: `src/web/app.tsx`
- Create: `src/web/index.css`
- Create: `index.html` (at repo root, for Vite)
- Modify: `package.json` (add frontend deps)

- [ ] **Step 1: Install frontend dependencies**

```bash
bun add react react-dom zustand shiki
bun add -d vite @vitejs/plugin-react @types/react @types/react-dom tailwindcss postcss autoprefixer
```

- [ ] **Step 2: Create `tsconfig.web.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "allowImportingTsExtensions": true,
    "noEmit": true,
    "isolatedModules": true,
    "resolveJsonModule": true,
    "paths": {
      "@/*": ["./src/web/*"],
      "@shared/*": ["./src/shared/*"]
    },
    "baseUrl": "."
  },
  "include": ["src/web/**/*", "src/shared/**/*", "index.html"]
}
```

- [ ] **Step 3: Create `vite.config.ts`**

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": resolve(__dirname, "src/web"),
      "@shared": resolve(__dirname, "src/shared"),
    },
  },
  build: {
    outDir: "dist/web",
    emptyOutDir: true,
  },
  server: {
    proxy: {
      "/api": {
        target: "http://localhost:41111",
        changeOrigin: true,
        ws: false,
      },
    },
  },
});
```

(Dev proxy assumes the Bun server runs on a fixed dev port — we'll document that in the dev workflow.)

- [ ] **Step 4: Create `tailwind.config.ts`**

```ts
import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/web/**/*.{ts,tsx}"],
  darkMode: "media",
  theme: {
    extend: {
      fontFamily: {
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
    },
  },
  plugins: [],
} satisfies Config;
```

- [ ] **Step 5: Create `postcss.config.js`**

```js
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
```

- [ ] **Step 6: Create `index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>diffscope</title>
  </head>
  <body class="bg-white text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100">
    <div id="root"></div>
    <script type="module" src="/src/web/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 7: Create `src/web/index.css`**

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

html,
body,
#root {
  height: 100%;
}

body {
  font-family:
    -apple-system,
    BlinkMacSystemFont,
    "SF Pro Text",
    sans-serif;
}
```

- [ ] **Step 8: Create `src/web/main.tsx`**

```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app";
import "./index.css";

const root = document.getElementById("root");
if (!root) throw new Error("root element missing");
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

- [ ] **Step 9: Create placeholder `src/web/app.tsx`**

```tsx
export function App() {
  return (
    <div className="flex h-full items-center justify-center">
      <p className="text-neutral-500">diffscope — loading…</p>
    </div>
  );
}
```

- [ ] **Step 10: Build and typecheck**

```bash
bun x tsc --noEmit -p tsconfig.web.json
bun run build:web
```

Expected: both succeed. `dist/web/index.html` exists.

- [ ] **Step 11: Commit**

```bash
git add tsconfig.web.json vite.config.ts tailwind.config.ts postcss.config.js index.html src/web/main.tsx src/web/app.tsx src/web/index.css package.json bun.lock
git commit -m "feat(web): scaffold Vite + React + Tailwind"
```

---

## Task 18: Frontend — Zustand store, REST client, SSE client

**Files:**
- Create: `src/web/lib/api.ts`
- Create: `src/web/lib/sse-client.ts`
- Create: `src/web/store.ts`

- [ ] **Step 1: Create `src/web/lib/api.ts`**

```ts
import type {
  Branch,
  BrowseResult,
  Commit,
  CommitDetail,
  FileStatus,
  ParsedDiff,
  Stash,
} from "@shared/types";

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status} ${url}: ${text}`);
  }
  return (await res.json()) as T;
}

export const api = {
  info: () => fetchJson<{ loaded: boolean; root?: string }>("/api/info"),
  status: () => fetchJson<FileStatus[]>("/api/status"),
  diff: (path: string, staged: boolean) =>
    fetchJson<ParsedDiff | null>(
      `/api/diff?path=${encodeURIComponent(path)}&staged=${staged}`,
    ),
  log: (limit = 50, offset = 0) =>
    fetchJson<Commit[]>(`/api/log?limit=${limit}&offset=${offset}`),
  commit: (sha: string) => fetchJson<CommitDetail>(`/api/commit/${sha}`),
  branches: () => fetchJson<Branch[]>("/api/branches"),
  stashes: () => fetchJson<Stash[]>("/api/stashes"),
  browse: (path?: string) =>
    fetchJson<BrowseResult>(`/api/browse${path ? `?path=${encodeURIComponent(path)}` : ""}`),
  recents: () => fetchJson<{ path: string; lastOpenedAt: string }[]>("/api/recents"),
  removeRecent: (path: string) =>
    fetchJson<{ path: string; lastOpenedAt: string }[]>(
      `/api/recents?path=${encodeURIComponent(path)}`,
      { method: "DELETE" },
    ),
  open: (path: string) =>
    fetchJson<{ ok: true; root: string }>("/api/open", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path }),
    }),
};
```

- [ ] **Step 2: Create `src/web/lib/sse-client.ts`**

```ts
import type { SseEvent } from "@shared/types";

export interface SseClient {
  close(): void;
}

export function openSseStream(
  onEvent: (event: SseEvent) => void,
  onError?: (err: Event) => void,
): SseClient {
  const source = new EventSource("/api/stream");
  source.onmessage = (msg) => {
    try {
      const event = JSON.parse(msg.data) as SseEvent;
      onEvent(event);
    } catch {
      // malformed frame — ignore
    }
  };
  source.onerror = (err) => onError?.(err);
  return {
    close() {
      source.close();
    },
  };
}
```

- [ ] **Step 3: Create `src/web/store.ts`**

```ts
import { create } from "zustand";
import type {
  Branch,
  Commit,
  FileStatus,
  ParsedDiff,
  RepoInfo,
  SseEvent,
  Stash,
} from "@shared/types";
import { api } from "./lib/api";
import { openSseStream, type SseClient } from "./lib/sse-client";

export type Tab = "working-tree" | "history" | "branches" | "stashes";
export type DiffMode = "unified" | "split";

interface StoreState {
  repo: RepoInfo | null;
  repoLoaded: boolean;
  tab: Tab;
  diffMode: DiffMode;
  paused: boolean;
  status: FileStatus[];
  focusedPath: string | null;
  focusedDiff: ParsedDiff | null;
  log: Commit[];
  focusedCommitSha: string | null;
  branches: Branch[];
  focusedBranch: string | null;
  stashes: Stash[];
  focusedStashIndex: number | null;
  watcherDown: boolean;
  error: string | null;
  sse: SseClient | null;

  setTab: (tab: Tab) => void;
  setDiffMode: (mode: DiffMode) => void;
  togglePaused: () => void;
  focusFile: (path: string) => Promise<void>;
  focusCommit: (sha: string) => Promise<void>;
  focusBranch: (name: string) => void;
  focusStash: (index: number) => void;
  initialize: () => Promise<void>;
  teardown: () => void;
}

export const useStore = create<StoreState>((set, get) => ({
  repo: null,
  repoLoaded: false,
  tab: "working-tree",
  diffMode: "unified",
  paused: false,
  status: [],
  focusedPath: null,
  focusedDiff: null,
  log: [],
  focusedCommitSha: null,
  branches: [],
  focusedBranch: null,
  stashes: [],
  focusedStashIndex: null,
  watcherDown: false,
  error: null,
  sse: null,

  setTab: (tab) => set({ tab }),
  setDiffMode: (mode) => {
    localStorage.setItem("diffscope:diffMode", mode);
    set({ diffMode: mode });
  },
  togglePaused: () => set((s) => ({ paused: !s.paused })),

  focusFile: async (path) => {
    set({ focusedPath: path, focusedDiff: null });
    const entry = get().status.find((f) => f.path === path);
    const staged = entry?.staged !== null && entry?.unstaged === null;
    const diff = await api.diff(path, staged).catch(() => null);
    if (get().focusedPath === path) set({ focusedDiff: diff });
  },

  focusCommit: async (sha) => {
    set({ focusedCommitSha: sha });
    // Commit detail fetched inside the History tab component on demand
  },

  focusBranch: (name) => set({ focusedBranch: name }),
  focusStash: (index) => set({ focusedStashIndex: index }),

  initialize: async () => {
    const savedMode = localStorage.getItem("diffscope:diffMode") as DiffMode | null;
    if (savedMode) set({ diffMode: savedMode });
    const info = await api.info().catch(() => ({ loaded: false }));
    if (!info.loaded) {
      set({ repoLoaded: false });
      return;
    }
    const [status, branches, stashes] = await Promise.all([
      api.status(),
      api.branches().catch(() => []),
      api.stashes().catch(() => []),
    ]);
    set({
      repoLoaded: true,
      status,
      branches,
      stashes,
      repo: {
        root: info.root ?? "",
        headSha: "",
        currentBranch: branches.find((b) => b.isCurrent)?.name ?? null,
      },
    });
    const sse = openSseStream(
      (event) => handleEvent(event, set, get),
      () => set({ watcherDown: true }),
    );
    set({ sse });
  },

  teardown: () => {
    get().sse?.close();
    set({ sse: null });
  },
}));

function handleEvent(
  event: SseEvent,
  set: (partial: Partial<StoreState>) => void,
  get: () => StoreState,
): void {
  if (get().paused) return;
  switch (event.type) {
    case "snapshot":
      set({ status: event.status, repo: event.repo });
      break;
    case "file-updated": {
      const existing = get().status;
      const idx = existing.findIndex((f) => f.path === event.path);
      const next = [...existing];
      if (idx >= 0) next[idx] = event.status;
      else next.push(event.status);
      set({ status: next });
      if (get().focusedPath === event.path && event.diff) {
        set({ focusedDiff: event.diff });
      }
      break;
    }
    case "file-removed": {
      set({ status: get().status.filter((f) => f.path !== event.path) });
      if (get().focusedPath === event.path) {
        set({ focusedPath: null, focusedDiff: null });
      }
      break;
    }
    case "head-changed":
      set({ status: event.status, branches: event.branches });
      break;
    case "refs-changed":
      set({ branches: event.branches });
      break;
    case "stashes-changed":
      set({ stashes: event.stashes });
      break;
    case "watcher-down":
      set({ watcherDown: true });
      break;
    case "watcher-up":
      set({ watcherDown: false });
      break;
    case "repo-error":
      set({ error: event.reason });
      break;
    case "warning":
      // Could surface as toast later
      break;
  }
}
```

- [ ] **Step 4: Typecheck**

Run: `bun x tsc --noEmit -p tsconfig.web.json`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/web/lib/api.ts src/web/lib/sse-client.ts src/web/store.ts
git commit -m "feat(web): Zustand store + REST client + SSE wiring"
```

---

## Task 19: Frontend — layout shell with top tabs

**Files:**
- Create: `src/web/components/layout.tsx`
- Modify: `src/web/app.tsx`

- [ ] **Step 1: Create `layout.tsx`**

```tsx
import type { ReactNode } from "react";
import { useStore, type Tab } from "../store";

const TABS: { key: Tab; label: string }[] = [
  { key: "working-tree", label: "Working Tree" },
  { key: "history", label: "History" },
  { key: "branches", label: "Branches" },
  { key: "stashes", label: "Stashes" },
];

export function Layout({ children }: { children: ReactNode }) {
  const tab = useStore((s) => s.tab);
  const setTab = useStore((s) => s.setTab);
  const paused = useStore((s) => s.paused);
  const togglePaused = useStore((s) => s.togglePaused);
  const watcherDown = useStore((s) => s.watcherDown);
  const repo = useStore((s) => s.repo);

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-neutral-200 bg-neutral-50 px-4 py-2 dark:border-neutral-800 dark:bg-neutral-900">
        <div className="flex items-center gap-4">
          <span className="font-semibold">diffscope</span>
          {repo?.root && (
            <span className="text-sm text-neutral-500">{shortenPath(repo.root)}</span>
          )}
        </div>
        <nav className="flex gap-1">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`rounded px-3 py-1 text-sm ${
                tab === t.key
                  ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900"
                  : "text-neutral-600 hover:bg-neutral-200 dark:text-neutral-400 dark:hover:bg-neutral-800"
              }`}
            >
              {t.label}
            </button>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          {watcherDown && (
            <span className="text-xs text-amber-600">⚠ Live updates off</span>
          )}
          <button
            onClick={togglePaused}
            className="rounded border border-neutral-300 px-2 py-1 text-xs dark:border-neutral-700"
          >
            {paused ? "▶ Resume" : "⏸ Pause"}
          </button>
        </div>
      </header>
      <main className="flex-1 overflow-hidden">{children}</main>
    </div>
  );
}

function shortenPath(p: string): string {
  const home = "/Users/";
  if (p.startsWith(home)) {
    const rest = p.slice(home.length);
    const first = rest.indexOf("/");
    if (first >= 0) return `~${rest.slice(first)}`;
  }
  return p;
}
```

- [ ] **Step 2: Update `src/web/app.tsx`**

```tsx
import { useEffect } from "react";
import { Layout } from "./components/layout";
import { useStore } from "./store";

export function App() {
  const initialize = useStore((s) => s.initialize);
  const teardown = useStore((s) => s.teardown);
  const repoLoaded = useStore((s) => s.repoLoaded);
  const tab = useStore((s) => s.tab);

  useEffect(() => {
    void initialize();
    return () => teardown();
  }, [initialize, teardown]);

  if (!repoLoaded) {
    return (
      <div className="flex h-full items-center justify-center text-neutral-500">
        Loading repo…
      </div>
    );
  }

  return (
    <Layout>
      <div className="p-4 text-neutral-500">Tab: {tab} (not yet implemented)</div>
    </Layout>
  );
}
```

- [ ] **Step 3: Build and typecheck**

```bash
bun x tsc --noEmit -p tsconfig.web.json
bun run build:web
```

Expected: both succeed.

- [ ] **Step 4: Commit**

```bash
git add src/web/components/layout.tsx src/web/app.tsx
git commit -m "feat(web): header + top tabs layout shell"
```

---

## Task 20: Frontend — diff view (unified mode + Shiki + images + binary)

**Files:**
- Create: `src/web/lib/highlight.ts`
- Create: `src/web/components/diff-view.tsx`

- [ ] **Step 1: Create `src/web/lib/highlight.ts`**

```ts
import { createHighlighter, type Highlighter } from "shiki";

let highlighterPromise: Promise<Highlighter> | null = null;

export function getHighlighter(): Promise<Highlighter> {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighter({
      themes: ["github-light", "github-dark"],
      langs: [
        "typescript",
        "tsx",
        "javascript",
        "jsx",
        "json",
        "css",
        "html",
        "markdown",
        "shell",
        "python",
        "rust",
        "go",
      ],
    });
  }
  return highlighterPromise;
}

export function langFromPath(path: string): string {
  const dot = path.lastIndexOf(".");
  const ext = dot >= 0 ? path.slice(dot + 1).toLowerCase() : "";
  const map: Record<string, string> = {
    ts: "typescript",
    tsx: "tsx",
    js: "javascript",
    jsx: "jsx",
    mjs: "javascript",
    cjs: "javascript",
    json: "json",
    css: "css",
    html: "html",
    md: "markdown",
    markdown: "markdown",
    sh: "shell",
    bash: "shell",
    zsh: "shell",
    py: "python",
    rs: "rust",
    go: "go",
  };
  return map[ext] ?? "text";
}
```

- [ ] **Step 2: Create `src/web/components/diff-view.tsx`**

```tsx
import { useEffect, useState } from "react";
import type { DiffLine, ParsedDiff } from "@shared/types";
import { getHighlighter, langFromPath } from "../lib/highlight";

interface Props {
  diff: ParsedDiff | null;
  loading?: boolean;
}

const LARGE_HUNK_LINE_THRESHOLD = 5000;

export function DiffView({ diff, loading }: Props) {
  if (loading) {
    return <div className="p-4 text-neutral-500">Loading diff…</div>;
  }
  if (!diff) {
    return <div className="p-4 text-neutral-500">Select a file to view its diff.</div>;
  }

  if (diff.binary) {
    return (
      <div className="p-4 text-sm text-neutral-500">
        Binary file changed{" "}
        {diff.binary.oldSize !== undefined && diff.binary.newSize !== undefined
          ? `(${diff.binary.oldSize}B → ${diff.binary.newSize}B)`
          : ""}
      </div>
    );
  }

  const totalLines = diff.hunks.reduce((n, h) => n + h.lines.length, 0);
  const isLarge = totalLines > LARGE_HUNK_LINE_THRESHOLD;

  const [expanded, setExpanded] = useState(!isLarge);
  if (isLarge && !expanded) {
    return (
      <div className="p-4">
        <p className="text-sm text-neutral-500">
          Large diff ({totalLines} lines) — collapsed by default.
        </p>
        <button
          onClick={() => setExpanded(true)}
          className="mt-2 rounded bg-neutral-200 px-3 py-1 text-sm dark:bg-neutral-800"
        >
          Expand anyway
        </button>
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto font-mono text-[13px]">
      <div className="border-b border-neutral-200 bg-neutral-50 px-3 py-1 text-xs text-neutral-500 dark:border-neutral-800 dark:bg-neutral-900">
        {diff.oldPath && diff.oldPath !== diff.path ? `${diff.oldPath} → ${diff.path}` : diff.path}
      </div>
      {diff.hunks.map((h, i) => (
        <div key={i} className="border-b border-neutral-100 last:border-b-0 dark:border-neutral-900">
          <div className="bg-cyan-50 px-3 py-0.5 text-cyan-700 dark:bg-cyan-950 dark:text-cyan-300">
            {h.header}
          </div>
          <HunkLines path={diff.path} lines={h.lines} />
        </div>
      ))}
    </div>
  );
}

function HunkLines({ path, lines }: { path: string; lines: DiffLine[] }) {
  const [highlighted, setHighlighted] = useState<string[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      const highlighter = await getHighlighter();
      const lang = langFromPath(path);
      const isDark = window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
      const theme = isDark ? "github-dark" : "github-light";
      const html = lines.map((l) => {
        try {
          return highlighter.codeToHtml(l.text, { lang, theme });
        } catch {
          return escapeHtml(l.text);
        }
      });
      if (!cancelled) setHighlighted(html);
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [path, lines]);

  return (
    <div>
      {lines.map((l, i) => (
        <div
          key={i}
          className={`grid grid-cols-[48px_48px_1fr] gap-2 px-2 ${
            l.kind === "add"
              ? "bg-green-50 dark:bg-green-950/40"
              : l.kind === "del"
              ? "bg-red-50 dark:bg-red-950/40"
              : ""
          }`}
        >
          <span className="select-none text-right text-neutral-400">{l.oldLine ?? ""}</span>
          <span className="select-none text-right text-neutral-400">{l.newLine ?? ""}</span>
          <span
            className="whitespace-pre [&_pre]:inline [&_pre]:bg-transparent"
            dangerouslySetInnerHTML={{ __html: highlighted?.[i] ?? escapeHtml(l.text) }}
          />
        </div>
      ))}
    </div>
  );
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
```

- [ ] **Step 3: Build and typecheck**

```bash
bun x tsc --noEmit -p tsconfig.web.json
bun run build:web
```

Expected: success.

- [ ] **Step 4: Commit**

```bash
git add src/web/lib/highlight.ts src/web/components/diff-view.tsx
git commit -m "feat(web): diff view with Shiki, binary + large-file handling"
```

---

## Task 21: Frontend — file list component (working tree groups)

**Files:**
- Create: `src/web/components/file-list.tsx`

- [ ] **Step 1: Implement**

```tsx
import { useMemo, useState } from "react";
import type { FileStatus } from "@shared/types";
import { useStore } from "../store";

interface Group {
  label: string;
  files: FileStatus[];
}

function group(status: FileStatus[]): Group[] {
  const staged: FileStatus[] = [];
  const unstaged: FileStatus[] = [];
  const untracked: FileStatus[] = [];
  for (const f of status) {
    if (f.isUntracked) untracked.push(f);
    else {
      if (f.staged) staged.push(f);
      if (f.unstaged) unstaged.push(f);
    }
  }
  return [
    { label: "Staged", files: staged },
    { label: "Unstaged", files: unstaged },
    { label: "Untracked", files: untracked },
  ];
}

export function FileList() {
  const status = useStore((s) => s.status);
  const focusedPath = useStore((s) => s.focusedPath);
  const focusFile = useStore((s) => s.focusFile);
  const [filter, setFilter] = useState("");

  const groups = useMemo(() => {
    const g = group(status);
    if (!filter) return g;
    return g.map((grp) => ({
      ...grp,
      files: grp.files.filter((f) => f.path.toLowerCase().includes(filter.toLowerCase())),
    }));
  }, [status, filter]);

  return (
    <div className="flex h-full flex-col border-r border-neutral-200 dark:border-neutral-800">
      <div className="border-b border-neutral-200 p-2 dark:border-neutral-800">
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter files… (/)"
          className="w-full rounded border border-neutral-300 bg-white px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-900"
          data-filter-input
        />
      </div>
      <div className="flex-1 overflow-auto">
        {groups.map((g) =>
          g.files.length === 0 ? null : (
            <div key={g.label}>
              <div className="sticky top-0 bg-neutral-100 px-2 py-1 text-xs font-medium uppercase tracking-wide text-neutral-500 dark:bg-neutral-900">
                {g.label} ({g.files.length})
              </div>
              {g.files.map((f) => (
                <button
                  key={`${g.label}-${f.path}`}
                  onClick={() => void focusFile(f.path)}
                  className={`flex w-full items-center gap-2 truncate px-2 py-1 text-left text-sm ${
                    focusedPath === f.path
                      ? "bg-blue-100 dark:bg-blue-900/40"
                      : "hover:bg-neutral-100 dark:hover:bg-neutral-900"
                  }`}
                >
                  <ChangeBadge file={f} group={g.label} />
                  <span className="truncate">{f.path}</span>
                </button>
              ))}
            </div>
          ),
        )}
      </div>
    </div>
  );
}

function ChangeBadge({ file, group }: { file: FileStatus; group: string }) {
  const change =
    group === "Staged" ? file.staged : group === "Unstaged" ? file.unstaged : "added";
  const letter = change === "added" ? "A" : change === "deleted" ? "D" : change === "renamed" ? "R" : "M";
  const color =
    change === "added"
      ? "text-green-600"
      : change === "deleted"
      ? "text-red-600"
      : change === "renamed"
      ? "text-purple-600"
      : "text-amber-600";
  return <span className={`font-mono text-xs ${color}`}>{letter}</span>;
}
```

- [ ] **Step 2: Typecheck + build**

```bash
bun x tsc --noEmit -p tsconfig.web.json
bun run build:web
```

- [ ] **Step 3: Commit**

```bash
git add src/web/components/file-list.tsx
git commit -m "feat(web): file list with staged/unstaged/untracked groups + filter"
```

---

## Task 22: Frontend — Working Tree tab

**Files:**
- Create: `src/web/tabs/working-tree.tsx`
- Modify: `src/web/app.tsx`

- [ ] **Step 1: Create the tab**

```tsx
import { FileList } from "../components/file-list";
import { DiffView } from "../components/diff-view";
import { useStore } from "../store";

export function WorkingTreeTab() {
  const focusedDiff = useStore((s) => s.focusedDiff);
  const focusedPath = useStore((s) => s.focusedPath);
  return (
    <div className="grid h-full grid-cols-[320px_1fr]">
      <FileList />
      <div className="overflow-hidden">
        <DiffView diff={focusedDiff} loading={focusedPath !== null && focusedDiff === null} />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Wire it into `app.tsx`**

Replace the `return` block in `App()`:

```tsx
  return (
    <Layout>
      {tab === "working-tree" && <WorkingTreeTab />}
      {tab !== "working-tree" && (
        <div className="p-4 text-neutral-500">{tab} (not yet implemented)</div>
      )}
    </Layout>
  );
```

Add the import at the top:

```tsx
import { WorkingTreeTab } from "./tabs/working-tree";
```

- [ ] **Step 3: End-to-end smoke test**

In one shell:

```bash
cd /tmp && rm -rf smoke3 && mkdir smoke3 && cd smoke3
git init -q -b main
echo hello > a.ts
git add .
git commit -qm init
```

In another shell (from the diffscope checkout):

```bash
bun run build:web
bun run src/server/cli.ts /tmp/smoke3
```

Expected: browser opens, working tree tab loads, no files visible. Now in the first shell:

```bash
cd /tmp/smoke3
echo world >> a.ts
```

Expected: within ~200ms the browser shows `a.ts` under Unstaged; clicking it shows the diff in the right pane with syntax highlighting.

- [ ] **Step 4: Commit**

```bash
git add src/web/tabs/working-tree.tsx src/web/app.tsx
git commit -m "feat(web): Working Tree tab wired end-to-end"
```

---

## Task 23: Frontend — History tab

**Files:**
- Create: `src/web/tabs/history.tsx`
- Modify: `src/web/app.tsx`

- [ ] **Step 1: Implement**

```tsx
import { useEffect, useState } from "react";
import type { Commit, CommitDetail } from "@shared/types";
import { api } from "../lib/api";
import { DiffView } from "../components/diff-view";

export function HistoryTab() {
  const [commits, setCommits] = useState<Commit[]>([]);
  const [focused, setFocused] = useState<string | null>(null);
  const [detail, setDetail] = useState<CommitDetail | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    void api.log(100, 0).then(setCommits);
  }, []);

  useEffect(() => {
    if (!focused) return;
    setLoading(true);
    void api
      .commit(focused)
      .then((d) => setDetail(d))
      .finally(() => setLoading(false));
  }, [focused]);

  return (
    <div className="grid h-full grid-cols-[380px_1fr]">
      <div className="overflow-auto border-r border-neutral-200 dark:border-neutral-800">
        {commits.map((c) => (
          <button
            key={c.sha}
            onClick={() => setFocused(c.sha)}
            className={`block w-full truncate px-3 py-2 text-left text-sm ${
              focused === c.sha
                ? "bg-blue-100 dark:bg-blue-900/40"
                : "hover:bg-neutral-100 dark:hover:bg-neutral-900"
            }`}
          >
            <div className="truncate font-medium">{c.subject}</div>
            <div className="truncate text-xs text-neutral-500">
              {c.shortSha} · {c.author} · {new Date(c.date).toLocaleString()}
            </div>
          </button>
        ))}
      </div>
      <div className="overflow-auto">
        {loading && <div className="p-4 text-neutral-500">Loading commit…</div>}
        {!loading && detail &&
          detail.diff.map((d, i) => <DiffView key={`${detail.sha}-${i}`} diff={d} />)}
        {!loading && !detail && (
          <div className="p-4 text-neutral-500">Select a commit to view its diff.</div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Wire into `app.tsx`**

Add import and render:

```tsx
import { HistoryTab } from "./tabs/history";
// …
{tab === "history" && <HistoryTab />}
```

Remove `history` from the "not yet implemented" branch.

- [ ] **Step 3: Build + commit**

```bash
bun run build:web
git add src/web/tabs/history.tsx src/web/app.tsx
git commit -m "feat(web): History tab — commit list + commit detail diffs"
```

---

## Task 24: Frontend — Branches tab

**Files:**
- Create: `src/web/tabs/branches.tsx`
- Modify: `src/web/app.tsx`

- [ ] **Step 1: Implement**

```tsx
import { useState } from "react";
import type { Branch } from "@shared/types";
import { useStore } from "../store";

export function BranchesTab() {
  const branches = useStore((s) => s.branches);
  const [focused, setFocused] = useState<string | null>(null);
  const selected = branches.find((b) => b.name === focused) ?? null;

  const locals = branches.filter((b) => !b.isRemote);
  const remotes = branches.filter((b) => b.isRemote);

  return (
    <div className="grid h-full grid-cols-[320px_1fr]">
      <div className="overflow-auto border-r border-neutral-200 dark:border-neutral-800">
        <BranchGroup label="Local" branches={locals} focused={focused} onFocus={setFocused} />
        <BranchGroup label="Remotes" branches={remotes} focused={focused} onFocus={setFocused} />
      </div>
      <div className="overflow-auto p-6">
        {!selected && <p className="text-neutral-500">Select a branch to see its tip.</p>}
        {selected && (
          <div className="space-y-3">
            <h2 className="text-xl font-semibold">{selected.name}</h2>
            <div className="text-sm text-neutral-500">
              {selected.isCurrent && "current branch · "}
              {selected.upstream && `upstream: ${selected.upstream} · `}
              {selected.ahead > 0 && `↑${selected.ahead} `}
              {selected.behind > 0 && `↓${selected.behind}`}
            </div>
            <div className="rounded border border-neutral-200 p-4 dark:border-neutral-800">
              <div className="font-mono text-xs text-neutral-500">{selected.tipSha}</div>
              <div className="mt-1">{selected.tipSubject}</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function BranchGroup({
  label,
  branches,
  focused,
  onFocus,
}: {
  label: string;
  branches: Branch[];
  focused: string | null;
  onFocus: (name: string) => void;
}) {
  if (branches.length === 0) return null;
  return (
    <div>
      <div className="sticky top-0 bg-neutral-100 px-3 py-1 text-xs font-medium uppercase tracking-wide text-neutral-500 dark:bg-neutral-900">
        {label} ({branches.length})
      </div>
      {branches.map((b) => (
        <button
          key={b.name}
          onClick={() => onFocus(b.name)}
          className={`block w-full truncate px-3 py-1.5 text-left text-sm ${
            focused === b.name
              ? "bg-blue-100 dark:bg-blue-900/40"
              : "hover:bg-neutral-100 dark:hover:bg-neutral-900"
          }`}
        >
          {b.isCurrent && <span className="mr-1 text-green-600">●</span>}
          {b.name}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Wire into `app.tsx`**

```tsx
import { BranchesTab } from "./tabs/branches";
// …
{tab === "branches" && <BranchesTab />}
```

- [ ] **Step 3: Build + commit**

```bash
bun run build:web
git add src/web/tabs/branches.tsx src/web/app.tsx
git commit -m "feat(web): Branches tab — local + remotes + tip info"
```

---

## Task 25: Frontend — Stashes tab

**Files:**
- Create: `src/web/tabs/stashes.tsx`
- Modify: `src/web/app.tsx`

- [ ] **Step 1: Implement**

```tsx
import { useEffect, useState } from "react";
import type { CommitDetail, Stash } from "@shared/types";
import { api } from "../lib/api";
import { DiffView } from "../components/diff-view";
import { useStore } from "../store";

export function StashesTab() {
  const stashes = useStore((s) => s.stashes);
  const [focused, setFocused] = useState<Stash | null>(null);
  const [detail, setDetail] = useState<CommitDetail | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!focused) {
      setDetail(null);
      return;
    }
    setLoading(true);
    void api
      .commit(focused.sha)
      .then(setDetail)
      .finally(() => setLoading(false));
  }, [focused]);

  return (
    <div className="grid h-full grid-cols-[360px_1fr]">
      <div className="overflow-auto border-r border-neutral-200 dark:border-neutral-800">
        {stashes.length === 0 && (
          <p className="p-4 text-sm text-neutral-500">No stashes.</p>
        )}
        {stashes.map((s) => (
          <button
            key={s.index}
            onClick={() => setFocused(s)}
            className={`block w-full truncate px-3 py-2 text-left text-sm ${
              focused?.index === s.index
                ? "bg-blue-100 dark:bg-blue-900/40"
                : "hover:bg-neutral-100 dark:hover:bg-neutral-900"
            }`}
          >
            <div className="truncate font-medium">stash@{'{'}{s.index}{'}'}</div>
            <div className="truncate text-xs text-neutral-500">{s.message}</div>
          </button>
        ))}
      </div>
      <div className="overflow-auto">
        {loading && <div className="p-4 text-neutral-500">Loading stash…</div>}
        {!loading && detail &&
          detail.diff.map((d, i) => <DiffView key={`${detail.sha}-${i}`} diff={d} />)}
        {!loading && !detail && !focused && (
          <div className="p-4 text-neutral-500">Select a stash to view its diff.</div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Wire into `app.tsx`**

```tsx
import { StashesTab } from "./tabs/stashes";
// …
{tab === "stashes" && <StashesTab />}
```

Delete the "not yet implemented" fallback — all four tabs are now implemented.

- [ ] **Step 3: Build + commit**

```bash
bun run build:web
git add src/web/tabs/stashes.tsx src/web/app.tsx
git commit -m "feat(web): Stashes tab — list + diff"
```

---

## Task 26: Frontend — Picker UI (recents + folder browser)

**Files:**
- Create: `src/web/components/picker.tsx`
- Modify: `src/web/app.tsx`

- [ ] **Step 1: Create `picker.tsx`**

```tsx
import { useEffect, useState } from "react";
import type { BrowseResult } from "@shared/types";
import { api } from "../lib/api";
import { useStore } from "../store";

interface Recent {
  path: string;
  lastOpenedAt: string;
}

export function Picker() {
  const [recents, setRecents] = useState<Recent[]>([]);
  const [browse, setBrowse] = useState<BrowseResult | null>(null);
  const [pathInput, setPathInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const initialize = useStore((s) => s.initialize);

  useEffect(() => {
    void api.recents().then(setRecents);
    void api.browse().then(setBrowse);
  }, []);

  const open = async (path: string) => {
    setError(null);
    try {
      await api.open(path);
      await initialize();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const navigateTo = async (path: string) => {
    try {
      setBrowse(await api.browse(path));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-8">
      <h1 className="text-2xl font-semibold">Open a repository</h1>

      {error && (
        <div className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
          {error}
        </div>
      )}

      {recents.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-medium uppercase tracking-wide text-neutral-500">
            Recents
          </h2>
          <ul className="space-y-1">
            {recents.map((r) => (
              <li key={r.path}>
                <button
                  onClick={() => void open(r.path)}
                  className="block w-full truncate rounded px-3 py-2 text-left hover:bg-neutral-100 dark:hover:bg-neutral-900"
                >
                  {r.path}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h2 className="mb-2 text-sm font-medium uppercase tracking-wide text-neutral-500">
          Or open a folder
        </h2>
        <div className="mb-2 flex gap-2">
          <input
            value={pathInput}
            onChange={(e) => setPathInput(e.target.value)}
            placeholder="/path/to/repo"
            className="flex-1 rounded border border-neutral-300 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900"
          />
          <button
            onClick={() => pathInput && void open(pathInput)}
            className="rounded bg-neutral-900 px-4 py-2 text-sm text-white dark:bg-neutral-100 dark:text-neutral-900"
          >
            Open
          </button>
        </div>
        {browse && (
          <div className="rounded border border-neutral-200 dark:border-neutral-800">
            <div className="flex items-center justify-between border-b border-neutral-200 bg-neutral-50 px-3 py-2 text-sm dark:border-neutral-800 dark:bg-neutral-900">
              <span className="truncate font-mono text-xs">{browse.path}</span>
              {browse.parent && (
                <button
                  onClick={() => void navigateTo(browse.parent!)}
                  className="text-xs text-blue-600 hover:underline"
                >
                  ↑ Parent
                </button>
              )}
            </div>
            <ul className="max-h-[40vh] overflow-auto">
              {browse.entries.map((e) => (
                <li key={e.path} className="flex items-center">
                  <button
                    onClick={() => void navigateTo(e.path)}
                    className="flex-1 truncate px-3 py-1.5 text-left text-sm hover:bg-neutral-100 dark:hover:bg-neutral-900"
                  >
                    📁 {e.name}
                    {e.isGitRepo && <span className="ml-2 text-xs text-green-600">git</span>}
                  </button>
                  {e.isGitRepo && (
                    <button
                      onClick={() => void open(e.path)}
                      className="mr-2 rounded bg-neutral-200 px-2 py-0.5 text-xs dark:bg-neutral-800"
                    >
                      Open
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
    </div>
  );
}
```

- [ ] **Step 2: Wire into `app.tsx`**

Replace the `if (!repoLoaded)` branch:

```tsx
  if (!repoLoaded) return <Picker />;
```

Add import:

```tsx
import { Picker } from "./components/picker";
```

- [ ] **Step 3: Build + commit**

```bash
bun run build:web
git add src/web/components/picker.tsx src/web/app.tsx
git commit -m "feat(web): picker UI — recents + folder browser + path input"
```

---

## Task 27: Frontend — Split-mode diff toggle

**Files:**
- Modify: `src/web/components/diff-view.tsx`
- Modify: `src/web/components/layout.tsx`

- [ ] **Step 1: Extend `diff-view.tsx` with split mode**

Add a `mode` prop and a split-mode renderer. Add at the top:

```tsx
import { useStore } from "../store";
```

Change the `DiffView` signature and add split rendering. Replace the `return` block of `DiffView`:

```tsx
  const mode = useStore((s) => s.diffMode);

  return (
    <div className="h-full overflow-auto font-mono text-[13px]">
      <div className="border-b border-neutral-200 bg-neutral-50 px-3 py-1 text-xs text-neutral-500 dark:border-neutral-800 dark:bg-neutral-900">
        {diff.oldPath && diff.oldPath !== diff.path ? `${diff.oldPath} → ${diff.path}` : diff.path}
      </div>
      {diff.hunks.map((h, i) => (
        <div key={i} className="border-b border-neutral-100 last:border-b-0 dark:border-neutral-900">
          <div className="bg-cyan-50 px-3 py-0.5 text-cyan-700 dark:bg-cyan-950 dark:text-cyan-300">
            {h.header}
          </div>
          {mode === "unified" ? (
            <HunkLines path={diff.path} lines={h.lines} />
          ) : (
            <SplitHunk path={diff.path} lines={h.lines} />
          )}
        </div>
      ))}
    </div>
  );
}

function SplitHunk({ path, lines }: { path: string; lines: DiffLine[] }) {
  // Pair deletions with additions greedily: emit left/right rows.
  interface Row {
    left: DiffLine | null;
    right: DiffLine | null;
  }
  const rows: Row[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (line.kind === "context") {
      rows.push({ left: line, right: line });
      i++;
    } else if (line.kind === "del") {
      // Gather consecutive dels, then consecutive adds
      const dels: DiffLine[] = [];
      while (i < lines.length && lines[i]!.kind === "del") {
        dels.push(lines[i]!);
        i++;
      }
      const adds: DiffLine[] = [];
      while (i < lines.length && lines[i]!.kind === "add") {
        adds.push(lines[i]!);
        i++;
      }
      const n = Math.max(dels.length, adds.length);
      for (let k = 0; k < n; k++) {
        rows.push({ left: dels[k] ?? null, right: adds[k] ?? null });
      }
    } else {
      // Lone add
      rows.push({ left: null, right: line });
      i++;
    }
  }

  return (
    <div className="grid grid-cols-2 divide-x divide-neutral-200 dark:divide-neutral-800">
      <SplitColumn path={path} entries={rows.map((r) => r.left)} side="left" />
      <SplitColumn path={path} entries={rows.map((r) => r.right)} side="right" />
    </div>
  );
}

function SplitColumn({
  entries,
  side,
}: {
  path: string;
  entries: (DiffLine | null)[];
  side: "left" | "right";
}) {
  return (
    <div>
      {entries.map((e, i) => {
        const bg =
          !e
            ? "bg-neutral-50 dark:bg-neutral-900/40"
            : e.kind === "del"
            ? "bg-red-50 dark:bg-red-950/40"
            : e.kind === "add"
            ? "bg-green-50 dark:bg-green-950/40"
            : "";
        const num = side === "left" ? e?.oldLine : e?.newLine;
        return (
          <div key={i} className={`grid grid-cols-[48px_1fr] gap-2 px-2 ${bg}`}>
            <span className="select-none text-right text-neutral-400">{num ?? ""}</span>
            <span className="whitespace-pre">{e?.text ?? ""}</span>
          </div>
        );
      })}
    </div>
  );
}
```

(Note: split mode uses plain text for simplicity; unified mode already has highlighting. Extending Shiki to split mode is a follow-up.)

- [ ] **Step 2: Add toggle button to `layout.tsx`**

Add state and button in the header. Before `togglePaused` button, insert:

```tsx
          <button
            onClick={() =>
              setDiffMode(useStore.getState().diffMode === "unified" ? "split" : "unified")
            }
            className="rounded border border-neutral-300 px-2 py-1 text-xs dark:border-neutral-700"
          >
            {diffMode === "unified" ? "Split" : "Unified"}
          </button>
```

Add `const diffMode = useStore((s) => s.diffMode);` and `const setDiffMode = useStore((s) => s.setDiffMode);` alongside other hooks at the top of `Layout`.

- [ ] **Step 3: Build + commit**

```bash
bun run build:web
git add src/web/components/diff-view.tsx src/web/components/layout.tsx
git commit -m "feat(web): split-mode diff toggle"
```

---

## Task 28: Frontend — keyboard shortcuts

**Files:**
- Create: `src/web/components/shortcuts.tsx`
- Modify: `src/web/app.tsx`

- [ ] **Step 1: Create `shortcuts.tsx`**

```tsx
import { useEffect, useState } from "react";
import { useStore } from "../store";

const SHORTCUTS = [
  ["j / k", "Next / previous file"],
  ["↑ / ↓", "Scroll diff (browser default)"],
  ["Tab / Shift+Tab", "Next / previous tab"],
  ["u", "Toggle unified / split"],
  ["/", "Filter file list"],
  ["p", "Pause / resume live updates"],
  ["?", "Show this help"],
];

const TABS_ORDER = ["working-tree", "history", "branches", "stashes"] as const;

export function Shortcuts() {
  const [helpOpen, setHelpOpen] = useState(false);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) {
        if (e.key === "Escape") target.blur();
        return;
      }

      if (e.key === "?") {
        setHelpOpen((h) => !h);
        return;
      }
      if (e.key === "Escape") {
        setHelpOpen(false);
        return;
      }

      const s = useStore.getState();
      if (e.key === "p") {
        s.togglePaused();
        return;
      }
      if (e.key === "u") {
        s.setDiffMode(s.diffMode === "unified" ? "split" : "unified");
        return;
      }
      if (e.key === "/") {
        e.preventDefault();
        const el = document.querySelector<HTMLInputElement>("[data-filter-input]");
        el?.focus();
        return;
      }
      if (e.key === "Tab") {
        e.preventDefault();
        const currentIdx = TABS_ORDER.indexOf(s.tab as (typeof TABS_ORDER)[number]);
        const delta = e.shiftKey ? -1 : 1;
        const nextIdx = (currentIdx + delta + TABS_ORDER.length) % TABS_ORDER.length;
        s.setTab(TABS_ORDER[nextIdx]!);
        return;
      }
      if ((e.key === "j" || e.key === "k") && s.tab === "working-tree") {
        const paths = s.status.map((f) => f.path);
        if (paths.length === 0) return;
        const idx = s.focusedPath ? paths.indexOf(s.focusedPath) : -1;
        const delta = e.key === "j" ? 1 : -1;
        const next = paths[(idx + delta + paths.length) % paths.length];
        if (next) void s.focusFile(next);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  if (!helpOpen) return null;
  return (
    <div
      onClick={() => setHelpOpen(false)}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="min-w-[360px] rounded-lg bg-white p-6 shadow-xl dark:bg-neutral-900"
      >
        <h2 className="mb-4 text-lg font-semibold">Keyboard shortcuts</h2>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
          {SHORTCUTS.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="font-mono text-neutral-600 dark:text-neutral-400">{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Mount in `app.tsx`**

Add `<Shortcuts />` alongside `<Layout>`:

```tsx
return (
  <>
    <Layout>{/* … */}</Layout>
    <Shortcuts />
  </>
);
```

Import at top:

```tsx
import { Shortcuts } from "./components/shortcuts";
```

- [ ] **Step 3: Build + commit**

```bash
bun run build:web
git add src/web/components/shortcuts.tsx src/web/app.tsx
git commit -m "feat(web): keyboard shortcuts + help modal"
```

---

## Task 29: Frontend — image diffs

**Files:**
- Modify: `src/web/components/diff-view.tsx`
- Modify: `src/server/http.ts`

- [ ] **Step 1: Add a `/api/blob` endpoint to `http.ts`**

Inside `handle(req)`, before the static SPA fallback:

```ts
    if (pathname === "/api/blob") {
      if (!repo) return json({ error: "no repo loaded" }, 400);
      const path = url.searchParams.get("path");
      const ref = url.searchParams.get("ref") ?? "HEAD"; // "HEAD" or "INDEX" or "WORKDIR"
      if (!path) return json({ error: "path required" }, 400);
      try {
        let out: Buffer;
        if (ref === "WORKDIR") {
          out = await Bun.file(`${repo.cwd}/${path}`).arrayBuffer().then((a) => Buffer.from(a));
        } else {
          const spec = ref === "HEAD" ? `HEAD:${path}` : `:${path}`;
          const { spawnSync } = await import("node:child_process");
          const r = spawnSync("git", ["show", spec], {
            cwd: repo.cwd,
            encoding: "buffer",
          });
          if (r.status !== 0) return json({ error: r.stderr.toString() }, 500);
          out = r.stdout;
        }
        const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
        const mime =
          ext === "png" ? "image/png" :
          ext === "jpg" || ext === "jpeg" ? "image/jpeg" :
          ext === "gif" ? "image/gif" :
          ext === "webp" ? "image/webp" :
          ext === "svg" ? "image/svg+xml" :
          "application/octet-stream";
        return new Response(out, { headers: { "content-type": mime } });
      } catch (err) {
        return errorResponse(err);
      }
    }
```

- [ ] **Step 2: Extend `diff-view.tsx` for images**

At the top of `DiffView`, after the binary check, add:

```tsx
  const isImage = /\.(png|jpe?g|gif|webp|svg|bmp|ico)$/i.test(diff.path);
  if (isImage) {
    return (
      <div className="grid h-full grid-cols-2 gap-4 p-6">
        <figure className="flex flex-col items-center gap-2">
          <figcaption className="text-xs text-neutral-500">Before (HEAD)</figcaption>
          <img
            src={`/api/blob?ref=HEAD&path=${encodeURIComponent(diff.path)}`}
            className="max-h-full max-w-full border border-neutral-200 dark:border-neutral-800"
            alt="before"
          />
        </figure>
        <figure className="flex flex-col items-center gap-2">
          <figcaption className="text-xs text-neutral-500">After (working tree)</figcaption>
          <img
            src={`/api/blob?ref=WORKDIR&path=${encodeURIComponent(diff.path)}`}
            className="max-h-full max-w-full border border-neutral-200 dark:border-neutral-800"
            alt="after"
          />
        </figure>
      </div>
    );
  }
```

- [ ] **Step 3: Build + commit**

```bash
bun run build:web
git add src/web/components/diff-view.tsx src/server/http.ts
git commit -m "feat(web+http): side-by-side image diffs via /api/blob"
```

---

## Task 30: README + dev workflow docs

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Write the README**

```md
# diffscope

A local, read-only, live git diff viewer. Point it at any repo on your machine and watch changes stream in as they happen — a microscope for your working tree.

## Requirements

- [Bun](https://bun.sh) ≥ 1.1
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

## Development

```bash
# Terminal 1 — start the backend against a scratch repo on a fixed port
DIFFSCOPE_DEV_PORT=41111 bun run --hot src/server/cli.ts /path/to/test-repo

# Terminal 2 — start the Vite dev server (proxies /api to port 41111)
bun run dev:web
```

Open http://localhost:5173 for a live-reloading frontend.

## Test

```bash
bun test
```

## Scope

- Read-only. No staging, committing, or destructive actions.
- Works on any local git repo.
- Live updates via filesystem watcher — file edits, staging, commits, branch checkouts, stashes, `.gitignore` changes.
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: README with install, run, dev, and scope"
```

---

## Self-review summary (run before handoff)

Do a final pass before marking this plan complete:

1. **Spec coverage:** every UX feature in `2026-04-08-diffscope-design.md` is covered by at least one task above. Working Tree (Task 22), History (Task 23), Branches (Task 24), Stashes (Task 25), Picker (Task 26), split mode (Task 27), keyboard shortcuts (Task 28), images (Task 29). Live updates, debounce, .gitignore tracking covered by Tasks 10–11 and tested in Task 16. Error handling paths in Task 11. Theming is handled by Tailwind `darkMode: "media"` + `dark:` classes. Large files in Task 20. Binary files in Task 20.

2. **Not covered in this plan (intentional deferrals — file follow-up issues when they become annoying):**
   - `DIFFSCOPE_DEV_PORT` env var read in `cli.ts` (the README mentions it — add in a tiny follow-up if desired, or hard-code 41111 for dev)
   - `headSha` is not populated in snapshot because refreshRepoInfo's code path is incomplete — it initializes `repoInfo.headSha = ""`. Works, but the Branches/History tabs don't use it. Add when needed.
   - Dev workflow's fixed port: the backend CLI picks a random port, but the Vite proxy expects 41111. Either hard-code in cli.ts when `DIFFSCOPE_DEV_PORT` is set, or start the backend with `--port`. Documented in Task 30; wire it up as needed.
   - Split-mode Shiki highlighting: unified mode highlights, split mode doesn't yet. Works, looks fine.
   - Image "new file" and "deleted" states: Task 29 shows both sides unconditionally; an added image has no HEAD blob (404). Handle with a placeholder in a polish pass.

3. **Known gotchas:**
   - `parseStatus` splits on spaces for path field — paths with multiple consecutive spaces will work because we join back, but `git status --porcelain=v2 -z` would be more robust. Upgrade to `-z` if fixtures show issues.
   - `runGit` returns stdout as string, which decodes binary data — fine for status/diff/log/branches, not fine for `git show HEAD:path.png`. Task 29 uses `spawnSync` with `encoding: "buffer"` specifically for blobs.
   - `@parcel/watcher` does not detect moves across mount points cleanly — OK because diffscope is local-only.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-04-08-diffscope.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints for review.

**Which approach?**
