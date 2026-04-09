// src/web/settings.ts
// Centralized, persisted user preferences.
// One storage key, one setter, one loader.
import { create } from "zustand";

export type Theme = "system" | "light" | "dark";
export type Editor = "none" | "vscode" | "cursor" | "zed" | "idea" | "subl";
export type FileListMode = "flat" | "tree";
export type DefaultTab =
  | "last-used"
  | "working-tree"
  | "history"
  | "branches"
  | "stashes";

export interface Settings {
  theme: Theme;
  defaultTab: DefaultTab;
  fileListMode: FileListMode;
  editor: Editor;
  blameStickyOn: boolean;
  fileListWidthPx: number;
  lastUsedTab: "working-tree" | "history" | "branches" | "stashes";
  diffMode: "unified" | "split";
}

const STORAGE_KEY = "diffscope:settings:v1";

const DEFAULTS: Settings = {
  theme: "system",
  defaultTab: "last-used",
  fileListMode: "flat",
  editor: "none",
  blameStickyOn: false,
  fileListWidthPx: 320,
  lastUsedTab: "working-tree",
  diffMode: "unified",
};

interface SettingsStore extends Settings {
  loaded: boolean;
  load(): void;
  set(partial: Partial<Settings>): void;
  reset(keys: (keyof Settings)[]): void;
}

function readStoredSettings(): Partial<Settings> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object") return parsed as Partial<Settings>;
    return {};
  } catch {
    return {};
  }
}

function migrateLegacyKeys(): void {
  try {
    localStorage.removeItem("diffscope:tab");
    localStorage.removeItem("diffscope:diffMode");
  } catch {
    // ignore
  }
}

function writeThrough(state: Settings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // quota / disabled storage — drop silently
  }
}

export const useSettings = create<SettingsStore>((set, get) => ({
  ...DEFAULTS,
  loaded: false,

  load() {
    migrateLegacyKeys();
    const stored = readStoredSettings();
    const merged: Settings = { ...DEFAULTS, ...stored };
    set({ ...merged, loaded: true });
  },

  set(partial) {
    const { loaded: _l, load: _load, set: _set, reset: _reset, ...current } =
      get();
    const next: Settings = { ...current, ...partial };
    writeThrough(next);
    set(partial);
  },

  reset(keys) {
    const partial: Partial<Settings> = {};
    for (const k of keys) partial[k] = DEFAULTS[k] as never;
    get().set(partial);
  },
}));

// Non-hook accessor for use outside React components (shortcuts, event handlers).
export function getSettings(): Settings {
  const s = useSettings.getState();
  const { loaded: _l, load: _load, set: _set, reset: _reset, ...rest } = s;
  return rest;
}
