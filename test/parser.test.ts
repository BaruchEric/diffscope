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
});

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
      body: "",
    });
    expect(commits[1]!.parents).toEqual([]);
    expect(commits[1]!.refs).toEqual([]);
    expect(commits[1]!.author).toBe("Bob Smith");
    expect(commits[1]!.body).toBe("Longer body\nwith multiple lines");
  });
});
