import { createHighlighterCore, type HighlighterCore } from "shiki/core";
import { createOnigurumaEngine } from "shiki/engine/oniguruma";
import { CONCRETE_THEMES, resolveThemeId, useSettings } from "../settings";
import { getPrefersDark } from "./use-prefers-dark";

// Use Shiki's granular API so the bundler only ships the languages we list,
// not every language Shiki ships out of the box. The high-level
// `createHighlighter` from "shiki" pulls in all 200+ language grammars
// (including 600KB+ chunks for cpp, emacs-lisp, wolfram, etc.) — using
// `createHighlighterCore` with explicit imports keeps the bundle small.
//
// All three theme-preset shiki themes are preloaded up front so a
// theme swap doesn't require a second async fetch — `codeToHtml` just
// takes the per-call `theme` name and the active preset is resolved via
// `activeShikiTheme()` below.

let highlighterPromise: Promise<HighlighterCore> | null = null;

export function getHighlighter(): Promise<HighlighterCore> {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighterCore({
      themes: [
        import("@shikijs/themes/vitesse-dark"),
        import("@shikijs/themes/catppuccin-latte"),
        import("@shikijs/themes/rose-pine-dawn"),
        import("@shikijs/themes/synthwave-84"),
      ],
      langs: [
        import("@shikijs/langs/typescript"),
        import("@shikijs/langs/tsx"),
        import("@shikijs/langs/javascript"),
        import("@shikijs/langs/jsx"),
        import("@shikijs/langs/json"),
        import("@shikijs/langs/css"),
        import("@shikijs/langs/html"),
        import("@shikijs/langs/markdown"),
        import("@shikijs/langs/shellscript"),
        import("@shikijs/langs/python"),
        import("@shikijs/langs/rust"),
        import("@shikijs/langs/go"),
      ],
      engine: createOnigurumaEngine(import("shiki/wasm")),
    });
  }
  return highlighterPromise;
}

/**
 * Resolve the shiki theme name for the currently-active diffscope theme
 * preset. Reads the latest settings value at call time (no subscription)
 * so callers should include their settings selector in their effect deps
 * to re-run when the theme changes.
 */
export function activeShikiTheme(): string {
  const id = useSettings.getState().theme;
  const resolved = resolveThemeId(id, getPrefersDark());
  return CONCRETE_THEMES[resolved].shikiTheme;
}

const LANG_BY_EXT: Record<string, string> = {
  ts: "typescript",
  tsx: "tsx",
  js: "javascript",
  jsx: "jsx",
  mjs: "javascript",
  cjs: "javascript",
  json: "json",
  css: "css",
  html: "html",
  md: "markdown",
  markdown: "markdown",
  sh: "shellscript",
  bash: "shellscript",
  zsh: "shellscript",
  py: "python",
  rs: "rust",
  go: "go",
};

export function langFromPath(path: string): string {
  const dot = path.lastIndexOf(".");
  const ext = dot >= 0 ? path.slice(dot + 1).toLowerCase() : "";
  return LANG_BY_EXT[ext] ?? "plaintext";
}
