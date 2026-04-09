// src/shared/types.ts
// Shared between server and web. Keep pure — no runtime code.

export type FileChangeType =
  | "added"
  | "modified"
  | "deleted"
  | "renamed"
  | "copied"
  | "untracked"
  | "ignored"
  | "unmerged";

export interface FileStatus {
  /** Repo-root-relative path (post-rename for renames). */
  path: string;
  /** For renames/copies, the original path. */
  oldPath?: string;
  /** Change relative to HEAD/index on the staged side. */
  staged: FileChangeType | null;
  /** Change relative to index/working tree on the unstaged side. */
  unstaged: FileChangeType | null;
  /** True if the file is new to the index (never committed). */
  isUntracked: boolean;
  /** True for image file extensions — web renders side-by-side. */
  isImage: boolean;
  /** True if git reports binary. */
  isBinary: boolean;
  /** File size in bytes of the current working-tree version, if known. */
  sizeBytes?: number;
}

export interface DiffLine {
  kind: "context" | "add" | "del";
  oldLine?: number;
  newLine?: number;
  text: string;
}

export interface DiffHunk {
  header: string; // e.g. "@@ -12,7 +12,9 @@ export function main()"
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: DiffLine[];
}

export interface ParsedDiff {
  path: string;
  oldPath?: string;
  hunks: DiffHunk[];
  /** Set when git reports a binary diff. */
  binary?: { oldSize?: number; newSize?: number };
  /** True when the diff was collapsed because the file was too large. */
  truncated?: boolean;
}

export interface Commit {
  sha: string;
  shortSha: string;
  author: string;
  authorEmail: string;
  date: string; // ISO 8601
  subject: string;
  parents: string[];
  refs: string[]; // e.g. ["HEAD -> main", "origin/main"]
}

export interface CommitDetail extends Commit {
  body: string;
  diff: ParsedDiff[];
}

export interface Branch {
  name: string;
  isCurrent: boolean;
  isRemote: boolean;
  upstream?: string;
  ahead: number;
  behind: number;
  tipSha: string;
  tipSubject: string;
}

export interface Stash {
  index: number;
  sha: string;
  message: string;
  date: string;
}

export interface RepoInfo {
  root: string;
  headSha: string;
  currentBranch: string | null;
}

export type SseEvent =
  | { type: "snapshot"; status: FileStatus[]; repo: RepoInfo }
  | { type: "file-updated"; path: string; status: FileStatus; diff?: ParsedDiff }
  | { type: "file-removed"; path: string }
  | { type: "head-changed"; headSha: string; status: FileStatus[]; branches: Branch[] }
  | { type: "refs-changed"; branches: Branch[] }
  | { type: "stashes-changed"; stashes: Stash[] }
  | { type: "watcher-down" }
  | { type: "watcher-up" }
  | { type: "repo-error"; reason: string }
  | { type: "warning"; message: string };

export interface BrowseEntry {
  name: string;
  path: string;
  isGitRepo: boolean;
}

export interface BrowseResult {
  path: string;
  entries: BrowseEntry[];
  /** Parent directory, or null if at filesystem root. */
  parent: string | null;
}
