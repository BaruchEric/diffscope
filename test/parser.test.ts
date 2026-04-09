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
