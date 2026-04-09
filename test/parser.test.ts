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
