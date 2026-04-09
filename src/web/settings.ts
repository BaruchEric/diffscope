// src/web/settings.ts
// Centralized, persisted user preferences.
// One storage key, one setter, one loader.
import { create } from "zustand";

export type ThemeId = "auto" | "midnight" | "paper" | "aperture" | "neon";
export type Editor = "none" | "vscode" | "cursor" | "zed" | "idea" | "subl";
export type FileListMode = "flat" | "tree";
export type DefaultTab =
  | "last-used"
  | "working-tree"
  | "history"
  | "branches"
  | "stashes";

export interface ThemeMeta {
  id: ThemeId;
  label: string;
  mode: "light" | "dark";
  accent: string;
  shikiTheme: string;
  description: string;
}

// `auto` carries no visual metadata of its own — it is a pointer to
// whichever concrete preset `applyTheme` resolves to. Code that wants to
// render a swatch or decide a mode for `auto` must resolve it first via
// `resolveThemeId(id)`.
export const THEMES: ThemeMeta[] = [
  {
    id: "auto",
    label: "Auto",
    mode: "dark",
    accent: "#22d3ee",
    shikiTheme: "vitesse-dark",
    description: "Follows your OS",
  },
  {
    id: "midnight",
    label: "Midnight",
    mode: "dark",
    accent: "#22d3ee",
    shikiTheme: "vitesse-dark",
    description: "Dark · refined editor",
  },
  {
    id: "paper",
    label: "Paper",
    mode: "light",
    accent: "#ea580c",
    shikiTheme: "catppuccin-latte",
    description: "Light · editorial",
  },
  {
    id: "aperture",
    label: "Aperture",
    mode: "light",
    accent: "#d97706",
    shikiTheme: "rose-pine-dawn",
    description: "Light · premium",
  },
  {
    id: "neon",
    label: "Neon",
    mode: "dark",
    accent: "#f72585",
    shikiTheme: "synthwave-84",
    description: "Dark · synthwave",
  },
];

const VALID_THEME_IDS = new Set<ThemeId>([
  "auto",
  "midnight",
  "paper",
  "aperture",
  "neon",
]);

/**
 * Migrate legacy theme values from earlier versions to the new ThemeId set.
 * Pure function — no DOM or localStorage access. Safe to call repeatedly.
 */
export function migrateLegacyTheme(value: unknown): ThemeId {
  if (typeof value !== "string") return "auto";
  if (VALID_THEME_IDS.has(value as ThemeId)) return value as ThemeId;
  if (value === "dark") return "midnight";
  if (value === "light") return "paper";
  if (value === "system") return "auto";
  return "auto";
}

/**
 * Resolve `auto` to a concrete theme based on the provided mediaQuery match
 * result. The caller owns the mediaQuery — keeping this pure makes it
 * trivially testable and safe to call during SSR.
 */
export function resolveThemeId(
  id: ThemeId,
  prefersDark: boolean,
): Exclude<ThemeId, "auto"> {
  if (id !== "auto") return id;
  return prefersDark ? "midnight" : "paper";
}

export interface Settings {
  theme: ThemeId;
  defaultTab: DefaultTab;
  fileListMode: FileListMode;
  editor: Editor;
  blameStickyOn: boolean;
  fileListWidthPx: number;
  commitDetailHeightPx: number;
  lastUsedTab: "working-tree" | "history" | "branches" | "stashes";
  diffMode: "unified" | "split";
}

const STORAGE_KEY = "diffscope:settings:v1";

const DEFAULTS: Settings = {
  theme: "auto",
  defaultTab: "last-used",
  fileListMode: "flat",
  editor: "none",
  blameStickyOn: false,
  fileListWidthPx: 320,
  commitDetailHeightPx: 180,
  lastUsedTab: "working-tree",
  diffMode: "unified",
};

const SETTINGS_KEYS = Object.keys(DEFAULTS) as (keyof Settings)[];

function pickSettings(state: SettingsStore): Settings {
  const out: Record<string, unknown> = {};
  for (const k of SETTINGS_KEYS) out[k] = state[k];
  return out as unknown as Settings;
}

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
    const merged: Settings = {
      ...DEFAULTS,
      ...stored,
      // Migrate theme value in case stored value is from an older version
      // (e.g., "system" / "dark" / "light" from v1 users).
      theme: migrateLegacyTheme((stored as { theme?: unknown }).theme),
    };
    // Write the migrated value back so the next load is a no-op fast path.
    writeThrough(merged);
    set({ ...merged, loaded: true });
  },

  set(partial) {
    const next: Settings = { ...pickSettings(get()), ...partial };
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
  return pickSettings(useSettings.getState());
}
