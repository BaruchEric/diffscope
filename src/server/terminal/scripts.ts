// src/server/terminal/scripts.ts
// Merges built-in, package.json, and .diffscope/scripts.json entries.
// Later sources override earlier ones on name collision.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ScriptEntry } from "../../shared/terminal-protocol";

const BUILTINS: ScriptEntry[] = [
  { name: "git status", command: "git status", group: "builtin" },
  { name: "git log --oneline -20", command: "git log --oneline -20", group: "builtin" },
  { name: "git diff --stat", command: "git diff --stat", group: "builtin" },
  { name: "git fetch --all --prune", command: "git fetch --all --prune", group: "builtin" },
];

interface UserConfig {
  scripts?: { name?: unknown; command?: unknown; cwd?: unknown }[];
}

interface PackageJson {
  scripts?: Record<string, unknown>;
}

async function readJsonWithError<T>(
  path: string,
): Promise<{ value: T | null; parseError: boolean }> {
  try {
    const raw = await readFile(path, "utf8");
    try {
      return { value: JSON.parse(raw) as T, parseError: false };
    } catch {
      return { value: null, parseError: true };
    }
  } catch {
    return { value: null, parseError: false };
  }
}

import { existsSync } from "node:fs";

function detectRunner(repoRoot: string): string {
  if (existsSync(join(repoRoot, "pnpm-lock.yaml"))) return "pnpm run";
  if (existsSync(join(repoRoot, "yarn.lock"))) return "yarn run";
  if (existsSync(join(repoRoot, "package-lock.json"))) return "npm run";
  return "bun run";
}

function fromPackageJson(pkg: PackageJson | null, runner: string): ScriptEntry[] {
  if (!pkg || typeof pkg.scripts !== "object" || pkg.scripts === null) return [];
  const out: ScriptEntry[] = [];
  for (const name of Object.keys(pkg.scripts)) {
    if (!name) continue;
    out.push({
      name,
      command: `${runner} ${name}`,
      group: "package",
    });
  }
  return out;
}

function fromUserConfig(cfg: UserConfig | null): ScriptEntry[] {
  if (!cfg || !Array.isArray(cfg.scripts)) return [];
  const out: ScriptEntry[] = [];
  for (const entry of cfg.scripts) {
    if (typeof entry?.name !== "string" || entry.name.length === 0) continue;
    if (typeof entry?.command !== "string" || entry.command.length === 0) continue;
    out.push({
      name: entry.name,
      command: entry.command,
      group: "user",
      cwd: typeof entry.cwd === "string" ? entry.cwd : undefined,
    });
  }
  return out;
}

function mergeByName(groups: ScriptEntry[][]): ScriptEntry[] {
  // Later groups win. Build a map, iterate through in order, and let each
  // later write replace the earlier entry for the same name.
  const map = new Map<string, ScriptEntry>();
  for (const group of groups) {
    for (const entry of group) {
      map.set(entry.name, entry);
    }
  }
  return [...map.values()];
}

export interface ResolveResult {
  entries: ScriptEntry[];
  warning?: string;
}

export async function resolveScripts(repoRoot: string): Promise<ResolveResult> {
  // Read both files in parallel — the dropdown open latency is dominated
  // by these two round-trips.
  const [pkgResult, userResult] = await Promise.all([
    readJsonWithError<PackageJson>(join(repoRoot, "package.json")),
    readJsonWithError<UserConfig>(join(repoRoot, ".diffscope/scripts.json")),
  ]);

  const runner = detectRunner(repoRoot);
  const entries = mergeByName([
    BUILTINS,
    fromPackageJson(pkgResult.value, runner),
    fromUserConfig(userResult.value),
  ]);

  const warnings: string[] = [];
  if (pkgResult.parseError) warnings.push("package.json: parse error");
  if (userResult.parseError) {
    warnings.push(".diffscope/scripts.json: parse error");
  }
  const warning = warnings.length > 0 ? warnings.join("; ") : undefined;

  return warning ? { entries, warning } : { entries };
}
