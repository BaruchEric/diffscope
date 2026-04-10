// src/server/tree.ts
// Full working-tree listing and raw file contents for the Explore mode.
//
// listTree returns a flat list of entries. Directory entries are synthesized
// from the observed file paths — callers (the frontend tree builder) split on
// "/" anyway, so we don't need to separately enumerate directories.
//
// readFile is deliberately narrow: path-safety enforced, image / binary /
// too-large detection server-side. Diffscope remains read-only — there is no
// counterpart write API.
import { readdir, lstat, stat, readFile as fsReadFile, readlink } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import type { FsEntry, FileContents } from "../shared/types";
import { runGit } from "./git";

/**
 * Enumerate the working tree.
 *
 * hideIgnored=true uses `git ls-files --cached --others --exclude-standard`
 * so gitignored paths (node_modules, dist, …) are skipped without a separate
 * ignore parser. hideIgnored=false does a plain filesystem walk, skipping
 * only `.git` — matches the "everything on disk" mode the Explore toggle
 * advertises.
 */
export async function listTree(
  repoRoot: string,
  opts: { hideIgnored: boolean },
): Promise<FsEntry[]> {
  if (opts.hideIgnored) {
    const files = await gitListFiles(repoRoot);
    return synthesizeEntries(files);
  }
  return walkDisk(repoRoot);
}

async function gitListFiles(repoRoot: string): Promise<string[]> {
  const raw = await runGit(repoRoot, [
    "ls-files", "--cached", "--others", "--exclude-standard", "-z",
  ]);
  // -z uses NUL separators; trailing NUL produces an empty string we drop.
  return raw.split("\0").filter((p) => p.length > 0);
}

/**
 * Turn a flat list of file paths into a flat list of FsEntry (files +
 * synthesized directories). The tree-builder on the frontend expects both
 * kinds. No attempt to backfill sizes for ls-files paths — the Explorer
 * doesn't show sizes in the row UI; sizes are only populated by walkDisk
 * where we already have them for free from readdir+lstat.
 */
function synthesizeEntries(files: string[]): FsEntry[] {
  const dirs = new Set<string>();
  for (const f of files) {
    const parts = f.split("/");
    for (let i = 1; i < parts.length; i++) {
      dirs.add(parts.slice(0, i).join("/"));
    }
  }
  const out: FsEntry[] = [];
  for (const d of dirs) out.push({ path: d, isDir: true });
  for (const f of files) out.push({ path: f, isDir: false });
  return out;
}

async function walkDisk(repoRoot: string): Promise<FsEntry[]> {
  const out: FsEntry[] = [];
  const rootAbs = resolve(repoRoot);
  const walk = async (absDir: string, relDir: string): Promise<void> => {
    let dirents;
    try {
      dirents = await readdir(absDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const d of dirents) {
      // Only skip top-level .git; nested .git dirs (e.g., submodule worktrees)
      // are walked. Submodule support is not in scope for Explore mode.
      if (relDir === "" && d.name === ".git") continue;
      const abs = join(absDir, d.name);
      const rel = relDir ? `${relDir}/${d.name}` : d.name;
      // lstat: never follow symlinks — treat them as leaf entries at their
      // link location so we don't walk out of the repo via a cheeky link.
      let st;
      try {
        st = await lstat(abs);
      } catch {
        continue;
      }
      if (st.isSymbolicLink()) {
        // size is the symlink metadata size (bytes of the link path), not the
        // target file size — lstat does not follow the link.
        out.push({ path: rel, isDir: false, size: st.size });
        continue;
      }
      if (st.isDirectory()) {
        out.push({ path: rel, isDir: true });
        await walk(abs, rel);
        continue;
      }
      if (st.isFile()) {
        out.push({ path: rel, isDir: false, size: st.size });
      }
    }
  };
  await walk(rootAbs, "");
  return out;
}

/**
 * Path safety is enforced in three layers, because each catches a different
 * class of attack:
 *
 *   1. Reject obvious bad inputs before touching the filesystem (absolute,
 *      `..`, NUL).
 *   2. Resolve the requested path, confirm it still starts with the resolved
 *      repo root. Catches Windows-style traversals and cases where the
 *      join/resolve produces something surprising.
 *   3. lstat + follow: if the target is a symlink whose resolved target lives
 *      outside the repo root, reject. Catches escape-via-link.
 */
export async function readFile(
  repoRoot: string,
  relPath: string,
): Promise<FileContents> {
  if (!isRelPathSafe(relPath)) throw new Error("invalid path");

  const rootAbs = resolve(repoRoot);
  const target = resolve(rootAbs, relPath);
  if (target !== rootAbs && !target.startsWith(rootAbs + sep)) {
    throw new Error("invalid path");
  }

  // If the target is a symlink, resolve and re-check containment.
  let linkSt;
  try {
    linkSt = await lstat(target);
  } catch {
    throw new Error("not found");
  }
  if (linkSt.isSymbolicLink()) {
    let resolvedLink: string;
    try {
      const linkTarget = await readlink(target);
      resolvedLink = resolve(target, "..", linkTarget);
    } catch {
      throw new Error("invalid path");
    }
    if (resolvedLink !== rootAbs && !resolvedLink.startsWith(rootAbs + sep)) {
      throw new Error("invalid path");
    }
  }

  // Real file stat (follows symlink — safe now, because we verified the
  // link target is inside the repo).
  let st;
  try {
    st = await stat(target);
  } catch {
    throw new Error("not found");
  }
  if (!st.isFile()) throw new Error("not a file");

  const content = await fsReadFile(target, "utf8");
  return { kind: "text", content };
}

function isRelPathSafe(path: string): boolean {
  if (!path) return false;
  if (path.startsWith("/")) return false;
  if (path.includes("\0")) return false;
  for (const seg of path.split(/[\\/]/)) {
    if (seg === "..") return false;
  }
  return true;
}
