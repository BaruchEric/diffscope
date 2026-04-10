import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseDiff, parseLog, parseStatus } from "./parser";
import { runGit, runGitBuffer, runGitLenient } from "./git";
import type {
  Branch,
  Commit,
  CommitDetail,
  FileStatus,
  ParsedDiff,
  Stash,
} from "../shared/types";

export { GitError } from "./git";

const LOG_FORMAT = "%H%x00%h%x00%P%x00%an%x00%ae%x00%aI%x00%D%x00%s%x00%b%x1e";
const BRANCH_FORMAT =
  "%(refname)%00%(refname:short)%00%(HEAD)%00%(upstream:short)%00%(upstream:track)%00%(objectname)%00%(contents:subject)";

/**
 * Walk upward from `start` looking for `.git`. Returns the containing
 * directory or null if not inside a repo.
 */
export function findRepoRoot(start: string): string | null {
  let current = resolve(start);
  while (true) {
    if (existsSync(join(current, ".git"))) return current;
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

export interface Repo {
  readonly cwd: string;
  getRepoRoot(): Promise<string>;
  getHeadSha(): Promise<string | null>;
  getStatus(): Promise<FileStatus[]>;
  getFileDiff(path: string, opts: { staged: boolean }): Promise<ParsedDiff | null>;
  getLog(opts: { limit: number; offset: number }): Promise<Commit[]>;
  getCommit(sha: string): Promise<CommitDetail>;
  getBranches(): Promise<Branch[]>;
  getStashes(): Promise<Stash[]>;
  showBlob(ref: "HEAD" | "INDEX", path: string): Promise<Buffer>;
}

export function createRepo(cwd: string): Repo {
  return {
    cwd,
    async getRepoRoot() {
      const out = await runGit(cwd, ["rev-parse", "--show-toplevel"]);
      return out.trim();
    },
    async getHeadSha() {
      try {
        const out = await runGit(cwd, ["rev-parse", "HEAD"]);
        const sha = out.trim();
        return sha.length > 0 ? sha : null;
      } catch {
        return null;
      }
    },
    async showBlob(ref, path) {
      const spec = ref === "HEAD" ? `HEAD:${path}` : `:${path}`;
      return runGitBuffer(cwd, ["show", spec]);
    },
    async getStatus() {
      const [statusOut, numstatOut] = await Promise.all([
        runGit(cwd, ["status", "--porcelain=v2"]),
        runGit(cwd, ["diff", "--numstat", "HEAD"]).catch(() => ""),
      ]);
      const status = parseStatus(statusOut);
      // Merge --numstat output: each line is "<added>\t<deleted>\t<path>".
      // Binary files show as "-\t-\t<path>" which we leave as undefined.
      const stats = new Map<string, { added: number; deleted: number }>();
      for (const line of numstatOut.split("\n")) {
        if (!line) continue;
        const m = /^(\d+|-)\t(\d+|-)\t(.+)$/.exec(line);
        if (!m) continue;
        const added = m[1] === "-" ? 0 : parseInt(m[1]!, 10);
        const deleted = m[2] === "-" ? 0 : parseInt(m[2]!, 10);
        stats.set(m[3]!, { added, deleted });
      }
      for (const f of status) {
        const s = stats.get(f.path);
        if (s) {
          f.added = s.added;
          f.deleted = s.deleted;
        }
      }
      return status;
    },
    async getFileDiff(path, { staged }) {
      const args = ["diff", "--patch", "--no-color"];
      if (staged) args.push("--cached");
      args.push("--", path);
      const out = await runGit(cwd, args);
      if (out.trim()) {
        const parsed = parseDiff(out);
        return parsed[0] ?? null;
      }
      // Empty output on an unstaged diff usually means the file is untracked
      // (git diff only considers tracked files). Fall back to --no-index
      // against /dev/null so the user can see untracked content as an
      // all-added diff — and so binary/image handlers still fire.
      if (staged) return null;
      const res = await runGitLenient(cwd, [
        "diff",
        "--no-index",
        "--patch",
        "--no-color",
        "--",
        "/dev/null",
        path,
      ]);
      // --no-index exits 0 (identical) or 1 (differs); anything else is a real
      // error (missing file, bad path, etc.).
      if (res.code > 1) return null;
      if (!res.stdout.trim()) return null;
      const parsed = parseDiff(res.stdout);
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
        // --first-parent -m: for merge commits, show the diff against the
        // first parent (the branch you were on). Without this, `git show`
        // on a clean merge produces an empty diff because there are no
        // conflict resolutions to display.
        runGit(cwd, [
          "show", "--patch", "--format=", "--no-color",
          "--first-parent", "-m", sha,
        ]),
      ]);
      const meta = parseLog(metaRaw)[0];
      if (!meta) throw new Error(`commit ${sha} not found`);
      const diff = parseDiff(diffRaw);
      return { ...meta, diff };
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
