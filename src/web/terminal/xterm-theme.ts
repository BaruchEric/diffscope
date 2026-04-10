// src/web/terminal/xterm-theme.ts
// Read xterm-friendly colors from the CSS variables the app already
// defines for each theme. Pulled once per theme change and handed to
// each Terminal instance via .options.theme = ...
import type { ITheme } from "@xterm/xterm";

function readVar(name: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

export function currentXtermTheme(): ITheme {
  return {
    background: readVar("--bg", "#111"),
    foreground: readVar("--fg", "#eee"),
    cursor: readVar("--accent", "#22d3ee"),
    cursorAccent: readVar("--bg", "#111"),
    selectionBackground: readVar("--accent", "#22d3ee") + "40",
  };
}
