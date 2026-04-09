import { spawn } from "node:child_process";
import { parseStatus } from "./parser";
import type { FileStatus } from "../shared/types";

export class GitError extends Error {
  constructor(
    public code: number,
    public stderr: string,
    public args: readonly string[],
  ) {
    super(`git ${args.join(" ")} failed (${code}): ${stderr}`);
    this.name = "GitError";
  }
}

async function runGit(cwd: string, args: readonly string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", args as string[], { cwd });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d.toString("utf8")));
    child.stderr.on("data", (d) => (stderr += d.toString("utf8")));
    child.on("error", (err) => reject(err));
    child.on("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new GitError(code ?? -1, stderr, args));
    });
  });
}

export interface Repo {
  readonly cwd: string;
  getRepoRoot(): Promise<string>;
  getStatus(): Promise<FileStatus[]>;
}

export function createRepo(cwd: string): Repo {
  return {
    cwd,
    async getRepoRoot() {
      const out = await runGit(cwd, ["rev-parse", "--show-toplevel"]);
      return out.trim();
    },
    async getStatus() {
      const out = await runGit(cwd, ["status", "--porcelain=v2"]);
      return parseStatus(out);
    },
  };
}
