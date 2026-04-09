// src/server/git.ts
// Shared git subprocess wrapper. Every call is prefixed with
// `-c core.quotepath=false` so git never C-escapes non-ASCII filenames.
import { spawn } from "node:child_process";

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

const BASE_FLAGS = ["-c", "core.quotepath=false"] as const;

export function runGit(
  cwd: string,
  args: readonly string[],
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", [...BASE_FLAGS, ...args], { cwd });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d.toString("utf8")));
    child.stderr.on("data", (d) => (stderr += d.toString("utf8")));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new GitError(code ?? -1, stderr, args));
    });
  });
}

export function runGitBuffer(
  cwd: string,
  args: readonly string[],
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", [...BASE_FLAGS, ...args], { cwd });
    const chunks: Buffer[] = [];
    let stderr = "";
    child.stdout.on("data", (d: Buffer) => chunks.push(d));
    child.stderr.on("data", (d) => (stderr += d.toString("utf8")));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(Buffer.concat(chunks));
      else reject(new GitError(code ?? -1, stderr, args));
    });
  });
}
