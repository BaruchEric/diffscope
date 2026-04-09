import { mkdtempSync, realpathSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";

export interface TempRepo {
  root: string;
  write(path: string, content: string): void;
  git(...args: string[]): { stdout: string; stderr: string; code: number };
  /**
   * Convenience: write a batch of files, `git add` them, and commit with
   * the given message. Collapses the `write + add + commit` triple that
   * every test file was hand-rolling.
   */
  commit(files: Record<string, string>, message: string): void;
  cleanup(): void;
}

export function createTempRepo(): TempRepo {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "diffscope-test-")));
  const git = (...args: string[]) => {
    const r = spawnSync("git", args, { cwd: root, encoding: "utf8" });
    return { stdout: r.stdout ?? "", stderr: r.stderr ?? "", code: r.status ?? -1 };
  };
  const write = (path: string, content: string) => {
    const full = join(root, path);
    // Use path.dirname so files at the repo root (no separator) don't get
    // skipped and Windows-style separators still work.
    const dir = dirname(full);
    if (dir && dir !== root) mkdirSync(dir, { recursive: true });
    writeFileSync(full, content);
  };
  git("init", "-q", "-b", "main");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Test");
  git("config", "commit.gpgsign", "false");
  return {
    root,
    write,
    git,
    commit(files, message) {
      for (const [path, content] of Object.entries(files)) write(path, content);
      git("add", ".");
      git("commit", "-m", message);
    },
    cleanup() {
      try {
        rmSync(root, { recursive: true, force: true });
      } catch {
        // best-effort — test teardown should never throw and mask the real
        // failure.
      }
    },
  };
}
