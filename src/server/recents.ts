// src/server/recents.ts
import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

const RECENTS_DIR = join(homedir(), ".config", "diffscope");
const RECENTS_FILE = join(RECENTS_DIR, "recents.json");
// Legacy location — checked as a fallback on first load so existing installs
// don't lose their recents list.
const LEGACY_RECENTS_FILE = join(homedir(), ".diffscope", "recents.json");
const MAX_RECENTS = 20;

export interface Recent {
  path: string;
  lastOpenedAt: string;
}

// In-memory cache. The recents file is owned by this process, so we can
// write-through on mutation instead of re-reading the file on every call.
// `null` before the first load so tests / fresh processes still hit disk
// once.
let cache: Recent[] | null = null;

function readJsonFile(path: string): Recent[] {
  if (!existsSync(path)) return [];
  try {
    const raw = readFileSync(path, "utf8");
    const data = JSON.parse(raw);
    if (!Array.isArray(data)) return [];
    return data.filter(
      (e): e is Recent => typeof e?.path === "string" && typeof e?.lastOpenedAt === "string",
    );
  } catch {
    return [];
  }
}

function readFromDisk(): Recent[] {
  const current = readJsonFile(RECENTS_FILE);
  if (current.length > 0) return current;
  return readJsonFile(LEGACY_RECENTS_FILE);
}

export function loadRecents(): Recent[] {
  if (cache === null) cache = readFromDisk();
  return cache;
}

export function saveRecents(recents: Recent[]): void {
  if (!existsSync(RECENTS_DIR)) mkdirSync(RECENTS_DIR, { recursive: true });
  writeFileSync(RECENTS_FILE, JSON.stringify(recents, null, 2));
  cache = recents;
}

export function addRecent(path: string): Recent[] {
  const now = new Date().toISOString();
  const existing = loadRecents().filter((r) => r.path !== path);
  const next = [{ path, lastOpenedAt: now }, ...existing].slice(0, MAX_RECENTS);
  saveRecents(next);
  return next;
}

export function removeRecent(path: string): Recent[] {
  const next = loadRecents().filter((r) => r.path !== path);
  saveRecents(next);
  return next;
}
