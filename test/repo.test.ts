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
