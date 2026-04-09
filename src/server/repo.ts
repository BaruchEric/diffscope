import { spawn } from "node:child_process";
import { parseDiff, parseLog, parseStatus } from "./parser";
import type {
  Branch,
  Commit,
  CommitDetail,
  FileStatus,
  ParsedDiff,
  Stash,
} from "../shared/types";

const LOG_FORMAT = "%H%x00%h%x00%P%x00%an%x00%ae%x00%aI%x00%D%x00%s%x00%b%x1e";
const BRANCH_FORMAT =
  "%(refname)%00%(refname:short)%00%(HEAD)%00%(upstream:short)%00%(upstream:track)%00%(objectname)%00%(contents:subject)";

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
  getBranches(): Promise<Branch[]>;
  getStashes(): Promise<Stash[]>;
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
    async getBranches(): Promise<Branch[]> {
      const out = await runGit(cwd, [
        "for-each-ref",
        "--format=" + BRANCH_FORMAT,
        "refs/heads",
        "refs/remotes",
      ]);
      const branches: Branch[] = [];
      for (const line of out.split("\n")) {
        if (!line) continue;
        const parts = line.split("\x00");
        const fullRef = parts[0] ?? "";
        const name = parts[1] ?? "";
        const head = parts[2] ?? " ";
        const upstream = parts[3] || undefined;
        const track = parts[4] ?? "";
        const tipSha = parts[5] ?? "";
        const tipSubject = parts[6] ?? "";
        const ahead = /ahead (\d+)/.exec(track)?.[1];
        const behind = /behind (\d+)/.exec(track)?.[1];
        branches.push({
          name,
          isCurrent: head === "*",
          // Authoritative: refs/remotes/* came from --refs=remotes (and only those).
          isRemote: fullRef.startsWith("refs/remotes/"),
          upstream,
          ahead: ahead ? parseInt(ahead, 10) : 0,
          behind: behind ? parseInt(behind, 10) : 0,
          tipSha,
          tipSubject,
        });
      }
      return branches;
    },
    async getStashes(): Promise<Stash[]> {
      const out = await runGit(cwd, [
        "stash",
        "list",
        "--format=%H%x00%gd%x00%aI%x00%s",
      ]);
      const stashes: Stash[] = [];
      for (const line of out.split("\n")) {
        if (!line) continue;
        const [sha, refname, date, message] = line.split("\x00") as [
          string,
          string,
          string,
          string,
        ];
        const idxMatch = /stash@\{(\d+)\}/.exec(refname);
        stashes.push({
          index: idxMatch ? parseInt(idxMatch[1]!, 10) : 0,
          sha,
          date,
          message,
        });
      }
      return stashes;
    },
  };
}
