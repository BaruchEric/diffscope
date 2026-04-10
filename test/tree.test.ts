import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
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

  test("allows symlinks pointing inside the repo root", async () => {
    temp.write("real.ts", "real content\n");
    symlinkSync("real.ts", join(temp.root, "alias.ts"));

    const result = await readFile(temp.root, "alias.ts");
    expect(result.kind).toBe("text");
    if (result.kind === "text") expect(result.content).toBe("real content\n");
  });

  test("rejects chained symlinks whose final target escapes the repo", async () => {
    // link1 -> link2 (inside repo) -> /etc/passwd (outside)
    symlinkSync("/etc/passwd", join(temp.root, "hop2.txt"));
    symlinkSync("hop2.txt", join(temp.root, "hop1.txt"));

    await expect(readFile(temp.root, "hop1.txt")).rejects.toThrow(/invalid path/i);
  });

  test("throws 'not found' for missing file", async () => {
    await expect(readFile(temp.root, "ghost.ts")).rejects.toThrow(/not found/i);
  });
});

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

  test("large image file → tooLarge (not image)", async () => {
    // 3 MB PNG-shaped file — must be tooLarge, not image, because the size
    // check runs before the image-extension check.
    const big = Buffer.alloc(3 * 1024 * 1024, 0x89);
    writeFileSync(join(temp.root, "big.png"), big);
    temp.git("add", ".");
    temp.git("commit", "-m", "init");

    const result = await readFile(temp.root, "big.png");
    expect(result.kind).toBe("tooLarge");
  });
});
