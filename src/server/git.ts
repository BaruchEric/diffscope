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

// Internal spawn helper — every public wrapper pushes stdout chunks into a
// single Buffer array so we avoid the O(n²) string concat that the previous
// `stdout += chunk.toString()` pattern suffered on large outputs like
// `git show` on big commits or `git log` on deep histories.
function spawnGit(
  cwd: string,
  args: readonly string[],
): Promise<{ code: number; stdoutChunks: Buffer[]; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", [...BASE_FLAGS, ...args], { cwd });
    const stdoutChunks: Buffer[] = [];
    let stderr = "";
    child.stdout.on("data", (d: Buffer) => stdoutChunks.push(d));
    child.stderr.on("data", (d) => (stderr += d.toString("utf8")));
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ code: code ?? -1, stdoutChunks, stderr });
    });
  });
}

export async function runGit(
  cwd: string,
  args: readonly string[],
): Promise<string> {
  const { code, stdoutChunks, stderr } = await spawnGit(cwd, args);
  if (code !== 0) throw new GitError(code, stderr, args);
  return Buffer.concat(stdoutChunks).toString("utf8");
}

export async function runGitBuffer(
  cwd: string,
  args: readonly string[],
): Promise<Buffer> {
  const { code, stdoutChunks, stderr } = await spawnGit(cwd, args);
  if (code !== 0) throw new GitError(code, stderr, args);
  return Buffer.concat(stdoutChunks);
}

/**
 * Run git and return stdout plus the raw exit code. Unlike runGit, this does
 * not reject on non-zero exits — needed for commands like `git diff --no-index`
 * which exit with 1 whenever files differ (which is the point).
 */
export async function runGitLenient(
  cwd: string,
  args: readonly string[],
): Promise<{ code: number; stdout: string; stderr: string }> {
  const { code, stdoutChunks, stderr } = await spawnGit(cwd, args);
  return { code, stdout: Buffer.concat(stdoutChunks).toString("utf8"), stderr };
}
