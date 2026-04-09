// src/server/blame.ts
import { spawn } from "node:child_process";
import type { BlameLine } from "../shared/types";

async function runGit(cwd: string, args: readonly string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", args as string[], { cwd });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d.toString("utf8")));
    child.stderr.on("data", (d) => (stderr += d.toString("utf8")));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`git blame failed (${code}): ${stderr}`));
    });
  });
}

interface CommitMeta {
  author: string;
  authorTimeIso: string;
  summary: string;
}

/**
 * Parse `git blame --porcelain` output into a flat BlameLine[].
 */
export function parseBlamePorcelain(raw: string): BlameLine[] {
  const out: BlameLine[] = [];
  const metaBySha = new Map<string, CommitMeta>();
  let currentSha = "";
  let currentFinalLine = 0;
  let partialMeta: Partial<CommitMeta> = {};

  const lines = raw.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (line === "") continue;

    if (line.startsWith("\t")) {
      // Content line — emit one BlameLine using the current sha + cached meta.
      const meta = metaBySha.get(currentSha);
      if (!meta) {
        // Shouldn't happen, but be defensive.
        continue;
      }
      out.push({
        lineNumber: currentFinalLine,
        sha: currentSha,
        shaShort: currentSha.slice(0, 7),
        author: meta.author,
        authorTimeIso: meta.authorTimeIso,
        summary: meta.summary,
      });
      continue;
    }

    // A line that starts with a 40-char hex sha followed by two or three numbers
    // is a header.
    const headerMatch = /^([0-9a-f]{40}) (\d+) (\d+)(?: (\d+))?$/.exec(line);
    if (headerMatch) {
      currentSha = headerMatch[1]!;
      currentFinalLine = parseInt(headerMatch[3]!, 10);
      if (!metaBySha.has(currentSha)) {
        partialMeta = {};
      }
      continue;
    }

    // Metadata lines for the current sha, only needed on first sight.
    if (!metaBySha.has(currentSha)) {
      if (line.startsWith("author ")) {
        partialMeta.author = line.slice("author ".length);
      } else if (line.startsWith("author-time ")) {
        const unix = parseInt(line.slice("author-time ".length), 10);
        partialMeta.authorTimeIso = new Date(unix * 1000).toISOString();
      } else if (line.startsWith("summary ")) {
        partialMeta.summary = line.slice("summary ".length);
      }
      // other metadata ignored

      // When we have all three required fields, commit the meta to the cache.
      if (
        partialMeta.author !== undefined &&
        partialMeta.authorTimeIso !== undefined &&
        partialMeta.summary !== undefined
      ) {
        metaBySha.set(currentSha, {
          author: partialMeta.author,
          authorTimeIso: partialMeta.authorTimeIso,
          summary: partialMeta.summary,
        });
      }
    }
  }

  return out;
}

/**
 * Blame a file at HEAD. Throws if the file has no HEAD version
 * (untracked, deleted, etc.).
 */
export async function blameFile(
  cwd: string,
  path: string,
): Promise<BlameLine[]> {
  const out = await runGit(cwd, ["blame", "--porcelain", "HEAD", "--", path]);
  return parseBlamePorcelain(out);
}

// Bounded LRU cache keyed by `${path}@${headSha}`.
const CACHE_MAX = 256;
const blameCache = new Map<string, BlameLine[]>();

export function getCachedBlame(
  path: string,
  headSha: string,
): BlameLine[] | undefined {
  const key = `${path}@${headSha}`;
  const hit = blameCache.get(key);
  if (hit === undefined) return undefined;
  // LRU touch
  blameCache.delete(key);
  blameCache.set(key, hit);
  return hit;
}

export function setCachedBlame(
  path: string,
  headSha: string,
  lines: BlameLine[],
): void {
  const key = `${path}@${headSha}`;
  blameCache.set(key, lines);
  while (blameCache.size > CACHE_MAX) {
    const oldest = blameCache.keys().next().value;
    if (oldest !== undefined) blameCache.delete(oldest);
  }
}

export function invalidateBlameCache(): void {
  blameCache.clear();
}
