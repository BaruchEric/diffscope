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
    expect(tree.children.map((c) => c.name)).toEqual(["src", "README.md"]);
    const src = tree.children.find((c) => c.name === "src")!;
    expect(src.isDir).toBe(true);
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
  test("returns only visible descendants respecting isExpanded", () => {
    const tree = buildTreeFromPaths<Item>([
      { path: "src/web/app.tsx" },
      { path: "src/server/cli.ts" },
    ]);
    const closed = flattenVisible(tree, () => false);
    expect(closed.map((v) => v.node.name)).toEqual(["src"]);

    const srcOnly = flattenVisible(tree, (d) => d === "src");
    expect(srcOnly.map((v) => v.node.name)).toEqual(["src", "server", "web"]);

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
