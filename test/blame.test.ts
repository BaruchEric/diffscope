import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createTempRepo, type TempRepo } from "./helpers/temp-repo";
import { blameFile } from "../src/server/blame";

describe("blameFile", () => {
  let temp: TempRepo;
  beforeEach(() => {
    temp = createTempRepo();
  });
  afterEach(() => {
    temp.cleanup();
  });

  test("returns one BlameLine per HEAD line", async () => {
    temp.write("a.ts", "one\ntwo\nthree\n");
    temp.git("add", ".");
    temp.git("commit", "-m", "init");

    const lines = await blameFile(temp.root, "a.ts");
    expect(lines).toHaveLength(3);
    expect(lines[0]!.lineNumber).toBe(1);
    expect(lines[0]!.author).toBe("Test");
    expect(lines[0]!.summary).toBe("init");
    expect(lines[0]!.shaShort).toHaveLength(7);
    expect(lines[0]!.sha).toHaveLength(40);
  });

  test("attributes different lines to different commits", async () => {
    temp.write("a.ts", "one\ntwo\n");
    temp.git("add", ".");
    temp.git("commit", "-m", "first");
    temp.write("a.ts", "one\ntwo\nTHREE\n");
    temp.git("add", ".");
    temp.git("commit", "-m", "second");

    const lines = await blameFile(temp.root, "a.ts");
    expect(lines).toHaveLength(3);
    expect(lines[0]!.summary).toBe("first");
    expect(lines[1]!.summary).toBe("first");
    expect(lines[2]!.summary).toBe("second");
  });

  test("throws for a file with no HEAD version", async () => {
    temp.write("a.ts", "hello\n");
    temp.git("add", ".");
    temp.git("commit", "-m", "init");
    temp.write("b.ts", "new\n");
    // b.ts is untracked
    await expect(blameFile(temp.root, "b.ts")).rejects.toBeDefined();
  });
});
