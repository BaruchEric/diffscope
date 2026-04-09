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

function unquote(s: string): string {
  if (!s.startsWith('"') || !s.endsWith('"')) return s;
  // Minimal unescape: \" → ", \\ → \, \t → \t, \n → \n
  return s
    .slice(1, -1)
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, "\\")
    .replace(/\\t/g, "\t")
    .replace(/\\n/g, "\n");
}

export function parseStatus(raw: string): FileStatus[] {
  const result: FileStatus[] = [];
  for (const line of raw.split("\n")) {
    if (!line || line.startsWith("#")) continue;
    const kind = line[0];
    if (kind === "1") {
      const parts = line.split(" ");
      const xy = parts[1] ?? "..";
      const path = unquote(parts.slice(8).join(" "));
      const entry = baseStatus(path);
      entry.staged = xyToChange(xy[0] ?? ".");
      entry.unstaged = xyToChange(xy[1] ?? ".");
      result.push(entry);
    } else if (kind === "2") {
      // "2 XY <sub> <mH> <mI> <mW> <hH> <hI> <score> <path>\t<origPath>"
      const parts = line.split(" ");
      const xy = parts[1] ?? "..";
      const rest = parts.slice(9).join(" ");
      const tab = rest.indexOf("\t");
      const path = unquote(tab >= 0 ? rest.slice(0, tab) : rest);
      const oldPath = tab >= 0 ? unquote(rest.slice(tab + 1)) : undefined;
      const entry = baseStatus(path);
      if (oldPath) entry.oldPath = oldPath;
      entry.staged = xyToChange(xy[0] ?? ".");
      entry.unstaged = xyToChange(xy[1] ?? ".");
      result.push(entry);
    } else if (kind === "u") {
      // "u XY <sub> <m1> <m2> <m3> <mW> <h1> <h2> <h3> <path>"
      const parts = line.split(" ");
      const path = unquote(parts.slice(10).join(" "));
      const entry = baseStatus(path);
      entry.staged = "unmerged";
      entry.unstaged = "unmerged";
      result.push(entry);
    } else if (kind === "?") {
      const path = unquote(line.slice(2));
      const entry = baseStatus(path);
      entry.unstaged = "added";
      entry.isUntracked = true;
      result.push(entry);
    } else if (kind === "!") {
      const path = unquote(line.slice(2));
      const entry = baseStatus(path);
      entry.unstaged = "added";
      result.push(entry);
    }
  }
  return result;
}
