import { createHighlighter, type Highlighter } from "shiki";

let highlighterPromise: Promise<Highlighter> | null = null;

export function getHighlighter(): Promise<Highlighter> {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighter({
      themes: ["github-light", "github-dark"],
      langs: [
        "typescript",
        "tsx",
        "javascript",
        "jsx",
        "json",
        "css",
        "html",
        "markdown",
        "shell",
        "python",
        "rust",
        "go",
      ],
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
    sh: "shell",
    bash: "shell",
    zsh: "shell",
    py: "python",
    rs: "rust",
    go: "go",
  };
  return map[ext] ?? "text";
}
