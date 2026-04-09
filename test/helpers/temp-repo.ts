import { mkdtempSync, realpathSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

export interface TempRepo {
  root: string;
  write(path: string, content: string): void;
  git(...args: string[]): { stdout: string; stderr: string; code: number };
  cleanup(): void;
}

export function createTempRepo(): TempRepo {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "diffscope-test-")));
  const git = (...args: string[]) => {
    const r = spawnSync("git", args, { cwd: root, encoding: "utf8" });
    return { stdout: r.stdout ?? "", stderr: r.stderr ?? "", code: r.status ?? -1 };
  };
  git("init", "-q", "-b", "main");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Test");
  git("config", "commit.gpgsign", "false");
  return {
    root,
    write(path, content) {
      const full = join(root, path);
      const dir = full.substring(0, full.lastIndexOf("/"));
      if (dir) mkdirSync(dir, { recursive: true });
      writeFileSync(full, content);
    },
    git,
    cleanup() {
      rmSync(root, { recursive: true, force: true });
    },
  };
}
