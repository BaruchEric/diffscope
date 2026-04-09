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

  test("getFileDiff returns parsed unstaged diff", async () => {
    temp.write("a.ts", "one\ntwo\nthree\n");
    temp.git("add", ".");
    temp.git("commit", "-m", "init");
    temp.write("a.ts", "one\nTWO\nthree\n");

    const repo = createRepo(temp.root);
    const diff = await repo.getFileDiff("a.ts", { staged: false });
    expect(diff).not.toBeNull();
    expect(diff!.path).toBe("a.ts");
    expect(diff!.hunks.length).toBeGreaterThan(0);
  });

  test("getFileDiff returns parsed staged diff", async () => {
    temp.write("a.ts", "one\n");
    temp.git("add", ".");
    temp.git("commit", "-m", "init");
    temp.write("a.ts", "one\ntwo\n");
    temp.git("add", "a.ts");

    const repo = createRepo(temp.root);
    const diff = await repo.getFileDiff("a.ts", { staged: true });
    expect(diff!.hunks[0]!.lines.some((l) => l.kind === "add")).toBe(true);
  });

  test("getFileDiff synthesizes an all-added diff for untracked files", async () => {
    temp.write("a.ts", "original\n");
    temp.git("add", ".");
    temp.git("commit", "-m", "init");
    // Never `git add`ed — fully untracked.
    temp.write("new.ts", "line one\nline two\n");

    const repo = createRepo(temp.root);
    const diff = await repo.getFileDiff("new.ts", { staged: false });
    expect(diff).not.toBeNull();
    expect(diff!.path).toBe("new.ts");
    // --no-index "new file" path should not be treated as a rename.
    expect(diff!.oldPath).toBeUndefined();
    const lines = diff!.hunks.flatMap((h) => h.lines);
    expect(lines.length).toBe(2);
    expect(lines.every((l) => l.kind === "add")).toBe(true);
    expect(lines.map((l) => l.text)).toEqual(["line one", "line two"]);
  });

  test("getLog returns commits with parents and subject", async () => {
    temp.write("a.ts", "1\n");
    temp.git("add", ".");
    temp.git("commit", "-m", "first");
    temp.write("a.ts", "2\n");
    temp.git("add", ".");
    temp.git("commit", "-m", "second");

    const repo = createRepo(temp.root);
    const commits = await repo.getLog({ limit: 10, offset: 0 });
    expect(commits).toHaveLength(2);
    expect(commits[0]!.subject).toBe("second");
    expect(commits[1]!.subject).toBe("first");
    expect(commits[0]!.parents).toHaveLength(1);
    expect(commits[1]!.parents).toHaveLength(0);
  });

  test("getCommit returns commit detail with diff", async () => {
    temp.write("a.ts", "original\n");
    temp.git("add", ".");
    temp.git("commit", "-m", "first");
    temp.write("a.ts", "changed\n");
    temp.git("add", ".");
    temp.git("commit", "-m", "second");
    const headSha = temp.git("rev-parse", "HEAD").stdout.trim();

    const repo = createRepo(temp.root);
    const detail = await repo.getCommit(headSha);
    expect(detail.sha).toBe(headSha);
    expect(detail.subject).toBe("second");
    expect(detail.diff.length).toBeGreaterThan(0);
  });

  test("getBranches returns local and remote branches with upstream info", async () => {
    temp.write("a.ts", "1\n");
    temp.git("add", ".");
    temp.git("commit", "-m", "init");
    temp.git("branch", "feature");

    const repo = createRepo(temp.root);
    const branches = await repo.getBranches();
    const names = branches.map((b) => b.name).sort();
    expect(names).toContain("main");
    expect(names).toContain("feature");
    const current = branches.find((b) => b.isCurrent);
    expect(current?.name).toBe("main");
  });

  test("getStashes returns stashes in order", async () => {
    temp.write("a.ts", "1\n");
    temp.git("add", ".");
    temp.git("commit", "-m", "init");
    temp.write("a.ts", "work in progress\n");
    temp.git("stash", "push", "-m", "wip1");
    temp.write("a.ts", "more\n");
    temp.git("stash", "push", "-m", "wip2");

    const repo = createRepo(temp.root);
    const stashes = await repo.getStashes();
    expect(stashes).toHaveLength(2);
    expect(stashes[0]!.message).toContain("wip2");
    expect(stashes[1]!.message).toContain("wip1");
  });
});
