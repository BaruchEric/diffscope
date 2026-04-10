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

export type ConcreteThemeId = Exclude<ThemeId, "auto">;

/** Metadata for a concrete (non-`auto`) theme preset. */
export interface ThemeMeta {
  id: ConcreteThemeId;
  label: string;
  mode: "light" | "dark";
  accent: string;
  shikiTheme: string;
  description: string;
}

/**
 * Concrete preset metadata keyed by id. `auto` is not present here because
 * it carries no visual metadata of its own — it is a pointer to whichever
 * preset `resolveThemeId(id, prefersDark)` returns.
 */
export const CONCRETE_THEMES: Record<ConcreteThemeId, ThemeMeta> = {
  midnight: {
    id: "midnight",
    label: "Midnight",
    mode: "dark",
    accent: "#22d3ee",
    shikiTheme: "vitesse-dark",
    description: "Dark · refined editor",
  },
  paper: {
    id: "paper",
    label: "Paper",
    mode: "light",
    accent: "#ea580c",
    shikiTheme: "catppuccin-latte",
    description: "Light · editorial",
  },
  aperture: {
    id: "aperture",
    label: "Aperture",
    mode: "light",
    accent: "#d97706",
    shikiTheme: "rose-pine-dawn",
    description: "Light · premium",
  },
  neon: {
    id: "neon",
    label: "Neon",
    mode: "dark",
    accent: "#f72585",
    shikiTheme: "synthwave-84",
    description: "Dark · synthwave",
  },
};

/**
 * Settings-UI card entries (ordered). Auto shows up here alongside concrete
 * presets so the picker can offer it, but callers must `resolveThemeId` before
 * reading any visual metadata.
 */
export interface ThemeCard {
  id: ThemeId;
  label: string;
  description: string;
}

export const THEME_CARDS: ThemeCard[] = [
  { id: "auto", label: "Auto", description: "Follows your OS" },
  { id: "midnight", label: CONCRETE_THEMES.midnight.label, description: CONCRETE_THEMES.midnight.description },
  { id: "paper", label: CONCRETE_THEMES.paper.label, description: CONCRETE_THEMES.paper.description },
  { id: "aperture", label: CONCRETE_THEMES.aperture.label, description: CONCRETE_THEMES.aperture.description },
  { id: "neon", label: CONCRETE_THEMES.neon.label, description: CONCRETE_THEMES.neon.description },
];

const VALID_THEME_IDS = new Set<ThemeId>(["auto", ...Object.keys(CONCRETE_THEMES) as ConcreteThemeId[]]);

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
): ConcreteThemeId {
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
  terminalDrawerOpen: boolean;
  terminalDrawerHeightPx: number;
  terminalNoticeAcknowledged: boolean;
  workingTreeMode: "changes" | "explore";
  hideIgnored: boolean;
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
  terminalDrawerOpen: false,
  terminalDrawerHeightPx: 280,
  terminalNoticeAcknowledged: false,
  workingTreeMode: "changes",
  hideIgnored: true,
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

async function readServerSettings(): Promise<Partial<Settings>> {
  try {
    const res = await fetch("/api/settings");
    if (!res.ok) return {};
    const parsed = await res.json();
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
  // Fire-and-forget save to server for cross-session persistence.
  fetch("/api/settings", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(state),
  }).catch(() => {});
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

    // Async: merge in server-side settings (for when localStorage is empty
    // due to a port change but the server file has saved prefs).
    readServerSettings().then((server) => {
      if (!server || Object.keys(server).length === 0) return;
      const current = pickSettings(get());
      const local = readStoredSettings();
      // Only apply server values for keys that the user hasn't set locally
      // (i.e. localStorage was empty and we're on defaults).
      if (Object.keys(local).length > 0) return;
      const fromServer: Settings = {
        ...current,
        ...server,
        theme: migrateLegacyTheme((server as { theme?: unknown }).theme ?? current.theme),
      };
      writeThrough(fromServer);
      set(fromServer);
    });
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
