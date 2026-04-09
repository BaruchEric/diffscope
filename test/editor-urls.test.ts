import { describe, expect, test } from "bun:test";
import { editorUrl } from "../src/web/lib/editor-urls";

describe("editorUrl", () => {
  test("vscode format", () => {
    expect(editorUrl("vscode", "/a/b/c.ts", 10, 1)).toBe(
      "vscode://file/a/b/c.ts:10:1",
    );
  });
  test("cursor format", () => {
    expect(editorUrl("cursor", "/a/b/c.ts", 10, 1)).toBe(
      "cursor://file/a/b/c.ts:10:1",
    );
  });
  test("zed format", () => {
    expect(editorUrl("zed", "/a/b/c.ts", 10, 1)).toBe(
      "zed://file/a/b/c.ts:10:1",
    );
  });
  test("idea format", () => {
    expect(editorUrl("idea", "/a/b/c.ts", 10, 1)).toBe(
      "idea://open?file=/a/b/c.ts&line=10&column=1",
    );
  });
  test("subl format", () => {
    expect(editorUrl("subl", "/a/b/c.ts", 10, 1)).toBe(
      "subl://open?url=file:///a/b/c.ts&line=10&column=1",
    );
  });
  test("none returns null", () => {
    expect(editorUrl("none", "/a/b/c.ts", 10, 1)).toBe(null);
  });
  test("encodes path with spaces", () => {
    expect(editorUrl("vscode", "/a b/c.ts", 1, 1)).toBe(
      "vscode://file/a%20b/c.ts:1:1",
    );
  });
});
