// src/server/parser.ts
import type { FileChangeType, FileStatus } from "../shared/types";

const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp", ".ico"]);

function isImage(path: string): boolean {
  const lower = path.toLowerCase();
  const dot = lower.lastIndexOf(".");
  if (dot < 0) return false;
  return IMAGE_EXTS.has(lower.slice(dot));
}

function xyToChange(c: string): FileChangeType | null {
  switch (c) {
    case ".": return null;
    case "M": return "modified";
    case "A": return "added";
    case "D": return "deleted";
    case "R": return "renamed";
    case "C": return "copied";
    case "U": return "unmerged";
    case "T": return "modified"; // type change — treat as modified
    default: return null;
  }
}

function baseStatus(path: string): FileStatus {
  return {
    path,
    staged: null,
    unstaged: null,
    isUntracked: false,
    isImage: isImage(path),
    isBinary: false,
  };
}

export function parseStatus(raw: string): FileStatus[] {
  const result: FileStatus[] = [];
  for (const line of raw.split("\n")) {
    if (!line || line.startsWith("#")) continue;
    const kind = line[0];
    if (kind === "1") {
      // "1 XY <sub> <mH> <mI> <mW> <hH> <hI> <path>"
      const parts = line.split(" ");
      const xy = parts[1] ?? "..";
      const path = parts.slice(8).join(" ");
      const entry = baseStatus(path);
      entry.staged = xyToChange(xy[0] ?? ".");
      entry.unstaged = xyToChange(xy[1] ?? ".");
      result.push(entry);
    } else if (kind === "?") {
      // "? <path>"
      const path = line.slice(2);
      const entry = baseStatus(path);
      entry.unstaged = "added";
      entry.isUntracked = true;
      result.push(entry);
    } else if (kind === "!") {
      // ignored — still surface it so the UI can filter
      const path = line.slice(2);
      const entry = baseStatus(path);
      entry.unstaged = "added";
      result.push(entry);
    }
    // kind === "2" (rename) and "u" (unmerged) handled in Task 4
  }
  return result;
}
