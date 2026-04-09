// src/web/theme.ts
// Applies the active theme to the document root.
// `auto` follows OS preference at runtime; all other values are concrete.
import { resolveThemeId, type ThemeId } from "./settings";

let mediaQuery: MediaQueryList | null = null;
let mediaListener: ((e: MediaQueryListEvent) => void) | null = null;

function writeAttribute(resolved: Exclude<ThemeId, "auto">): void {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute("data-theme", resolved);
}

export function applyTheme(id: ThemeId): void {
  // Detach any prior system listener — we'll re-attach only if still `auto`.
  if (mediaQuery && mediaListener) {
    mediaQuery.removeEventListener("change", mediaListener);
    mediaListener = null;
    mediaQuery = null;
  }

  if (id === "auto") {
    if (typeof window === "undefined") {
      writeAttribute("midnight");
      return;
    }
    mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    writeAttribute(resolveThemeId("auto", mediaQuery.matches));
    mediaListener = (e) => writeAttribute(resolveThemeId("auto", e.matches));
    mediaQuery.addEventListener("change", mediaListener);
    return;
  }

  writeAttribute(id);
}
