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
