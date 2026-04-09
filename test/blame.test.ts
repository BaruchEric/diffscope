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
    temp.commit({ "a.ts": "one\ntwo\nthree\n" }, "init");

    const lines = await blameFile(temp.root, "a.ts");
    expect(lines).toHaveLength(3);
    expect(lines[0]!.lineNumber).toBe(1);
    expect(lines[0]!.author).toBe("Test");
    expect(lines[0]!.summary).toBe("init");
    expect(lines[0]!.shaShort).toHaveLength(7);
    expect(lines[0]!.sha).toHaveLength(40);
  });

  test("attributes different lines to different commits", async () => {
    temp.commit({ "a.ts": "one\ntwo\n" }, "first");
    temp.commit({ "a.ts": "one\ntwo\nTHREE\n" }, "second");

    const lines = await blameFile(temp.root, "a.ts");
    expect(lines).toHaveLength(3);
    expect(lines[0]!.summary).toBe("first");
    expect(lines[1]!.summary).toBe("first");
    expect(lines[2]!.summary).toBe("second");
  });

  test("throws for a file with no HEAD version", async () => {
    temp.commit({ "a.ts": "hello\n" }, "init");
    temp.write("b.ts", "new\n");
    // b.ts is untracked — assert we throw an actual Error, not just any
    // defined value (the previous `toBeDefined` passed for literally anything).
    await expect(blameFile(temp.root, "b.ts")).rejects.toThrow(Error);
  });
});
