// src/server/parser.ts
import type { DiffHunk, DiffLine, FileChangeType, FileStatus, ParsedDiff } from "../shared/types";

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

const FILE_HEADER_RE = /^diff --git a\/(.+?) b\/(.+?)$/;
const HUNK_HEADER_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

export function parseDiff(raw: string): ParsedDiff[] {
  const results: ParsedDiff[] = [];
  const lines = raw.split("\n");

  let i = 0;
  while (i < lines.length) {
    const header = lines[i]!;
    const m = header.match(FILE_HEADER_RE);
    if (!m) {
      i++;
      continue;
    }
    const oldBPath = m[1]!;
    const newBPath = m[2]!;
    const current: ParsedDiff = { path: newBPath, hunks: [] };
    if (oldBPath !== newBPath) current.oldPath = oldBPath;

    i++;
    // Skip extended headers (index, mode, similarity, rename, ---, +++)
    while (i < lines.length && !lines[i]!.startsWith("@@") && !lines[i]!.startsWith("diff --git")) {
      if (lines[i]!.startsWith("Binary files ")) {
        current.binary = {};
      }
      i++;
    }

    // Hunks
    while (i < lines.length && lines[i]!.startsWith("@@")) {
      const hm = lines[i]!.match(HUNK_HEADER_RE);
      if (!hm) break;
      const hunk: DiffHunk = {
        header: lines[i]!,
        oldStart: parseInt(hm[1]!, 10),
        oldLines: hm[2] ? parseInt(hm[2], 10) : 1,
        newStart: parseInt(hm[3]!, 10),
        newLines: hm[4] ? parseInt(hm[4], 10) : 1,
        lines: [],
      };
      i++;
      let oldLine = hunk.oldStart;
      let newLine = hunk.newStart;
      while (i < lines.length && !lines[i]!.startsWith("diff --git") && !lines[i]!.startsWith("@@")) {
        const l = lines[i]!;
        if (l.startsWith("\\")) {
          // "\ No newline at end of file" — metadata marker; drop
          i++;
          continue;
        }
        let diffLine: DiffLine;
        if (l.startsWith("+")) {
          diffLine = { kind: "add", newLine: newLine++, text: l.slice(1) };
        } else if (l.startsWith("-")) {
          diffLine = { kind: "del", oldLine: oldLine++, text: l.slice(1) };
        } else if (l.startsWith(" ")) {
          diffLine = {
            kind: "context",
            oldLine: oldLine++,
            newLine: newLine++,
            text: l.slice(1),
          };
        } else if (l === "") {
          // Trailing blank — end of hunk
          break;
        } else {
          // Unknown marker — skip defensively
          i++;
          continue;
        }
        hunk.lines.push(diffLine);
        i++;
      }
      current.hunks.push(hunk);
    }

    results.push(current);
  }

  return results;
}
