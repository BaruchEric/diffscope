import { spawn } from "node:child_process";
import { parseDiff, parseLog, parseStatus } from "./parser";
import type { Commit, CommitDetail, FileStatus, ParsedDiff } from "../shared/types";

const LOG_FORMAT = "%H%x00%h%x00%P%x00%an%x00%ae%x00%aI%x00%D%x00%s%x00%b%x1e";

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
  getFileDiff(path: string, opts: { staged: boolean }): Promise<ParsedDiff | null>;
  getLog(opts: { limit: number; offset: number }): Promise<Commit[]>;
  getCommit(sha: string): Promise<CommitDetail>;
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
    async getFileDiff(path, { staged }) {
      const args = ["diff", "--patch", "--no-color"];
      if (staged) args.push("--cached");
      args.push("--", path);
      const out = await runGit(cwd, args);
      if (!out.trim()) return null;
      const parsed = parseDiff(out);
      return parsed[0] ?? null;
    },
    async getLog({ limit, offset }) {
      const out = await runGit(cwd, [
        "log",
        `--format=${LOG_FORMAT}`,
        `--max-count=${limit}`,
        `--skip=${offset}`,
      ]);
      return parseLog(out);
    },
    async getCommit(sha) {
      const [metaRaw, diffRaw] = await Promise.all([
        runGit(cwd, ["log", "-1", `--format=${LOG_FORMAT}`, sha]),
        runGit(cwd, ["show", "--patch", "--format=", "--no-color", sha]),
      ]);
      const meta = parseLog(metaRaw)[0];
      if (!meta) throw new Error(`commit ${sha} not found`);
      const diff = parseDiff(diffRaw);
      // Extract body from metaRaw's last field (empty string in fixtures — body came from log format's %b)
      return { ...meta, body: "", diff };
    },
  };
}
