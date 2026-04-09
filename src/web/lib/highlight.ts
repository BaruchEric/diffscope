import { createHighlighterCore, type HighlighterCore } from "shiki/core";
import { createOnigurumaEngine } from "shiki/engine/oniguruma";

// Use Shiki's granular API so the bundler only ships the languages we list,
// not every language Shiki ships out of the box. The high-level
// `createHighlighter` from "shiki" pulls in all 200+ language grammars
// (including 600KB+ chunks for cpp, emacs-lisp, wolfram, etc.) — using
// `createHighlighterCore` with explicit imports keeps the bundle small.

let highlighterPromise: Promise<HighlighterCore> | null = null;

export function getHighlighter(): Promise<HighlighterCore> {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighterCore({
      themes: [
        import("@shikijs/themes/github-light"),
        import("@shikijs/themes/github-dark"),
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

export function langFromPath(path: string): string {
  const dot = path.lastIndexOf(".");
  const ext = dot >= 0 ? path.slice(dot + 1).toLowerCase() : "";
  const map: Record<string, string> = {
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
  return map[ext] ?? "plaintext";
}
