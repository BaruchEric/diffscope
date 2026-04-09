// src/web/theme.ts
// Applies theme to the document root.
// `system` follows OS at runtime.
import type { Theme } from "./settings";

let mediaQuery: MediaQueryList | null = null;
let mediaListener: ((e: MediaQueryListEvent) => void) | null = null;

function resolveSystem(): "light" | "dark" {
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function writeAttribute(resolved: "light" | "dark"): void {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute("data-theme", resolved);
}

export function applyTheme(theme: Theme): void {
  // Detach any prior system listener — we'll re-attach only if needed.
  if (mediaQuery && mediaListener) {
    mediaQuery.removeEventListener("change", mediaListener);
    mediaListener = null;
    mediaQuery = null;
  }

  if (theme === "system") {
    writeAttribute(resolveSystem());
    if (typeof window !== "undefined") {
      mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
      mediaListener = (e) => writeAttribute(e.matches ? "dark" : "light");
      mediaQuery.addEventListener("change", mediaListener);
    }
    return;
  }
  writeAttribute(theme);
}
