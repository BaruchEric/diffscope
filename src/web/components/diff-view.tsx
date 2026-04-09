import { useEffect, useState } from "react";
import type { DiffLine, ParsedDiff } from "@shared/types";
import { getHighlighter, langFromPath } from "../lib/highlight";

interface Props {
  diff: ParsedDiff | null;
  loading?: boolean;
}

const LARGE_HUNK_LINE_THRESHOLD = 5000;

export function DiffView({ diff, loading }: Props) {
  // All hooks must run unconditionally on every render (Rules of Hooks).
  const [userExpanded, setUserExpanded] = useState(false);

  if (loading) {
    return <div className="p-4 text-neutral-500">Loading diff…</div>;
  }
  if (!diff) {
    return <div className="p-4 text-neutral-500">Select a file to view its diff.</div>;
  }

  if (diff.binary) {
    return (
      <div className="p-4 text-sm text-neutral-500">
        Binary file changed{" "}
        {diff.binary.oldSize !== undefined && diff.binary.newSize !== undefined
          ? `(${diff.binary.oldSize}B → ${diff.binary.newSize}B)`
          : ""}
      </div>
    );
  }

  const totalLines = diff.hunks.reduce((n, h) => n + h.lines.length, 0);
  const isLarge = totalLines > LARGE_HUNK_LINE_THRESHOLD;
  const expanded = !isLarge || userExpanded;

  if (isLarge && !expanded) {
    return (
      <div className="p-4">
        <p className="text-sm text-neutral-500">
          Large diff ({totalLines} lines) — collapsed by default.
        </p>
        <button
          onClick={() => setUserExpanded(true)}
          className="mt-2 rounded bg-neutral-200 px-3 py-1 text-sm dark:bg-neutral-800"
        >
          Expand anyway
        </button>
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto font-mono text-[13px]">
      <div className="border-b border-neutral-200 bg-neutral-50 px-3 py-1 text-xs text-neutral-500 dark:border-neutral-800 dark:bg-neutral-900">
        {diff.oldPath && diff.oldPath !== diff.path ? `${diff.oldPath} → ${diff.path}` : diff.path}
      </div>
      {diff.hunks.map((h, i) => (
        <div key={i} className="border-b border-neutral-100 last:border-b-0 dark:border-neutral-900">
          <div className="bg-cyan-50 px-3 py-0.5 text-cyan-700 dark:bg-cyan-950 dark:text-cyan-300">
            {h.header}
          </div>
          <HunkLines path={diff.path} lines={h.lines} />
        </div>
      ))}
    </div>
  );
}

function HunkLines({ path, lines }: { path: string; lines: DiffLine[] }) {
  const [highlighted, setHighlighted] = useState<string[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      const highlighter = await getHighlighter();
      const lang = langFromPath(path);
      const isDark = window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
      const theme = isDark ? "github-dark" : "github-light";
      const html = lines.map((l) => {
        try {
          return highlighter.codeToHtml(l.text, { lang, theme });
        } catch {
          return escapeHtml(l.text);
        }
      });
      if (!cancelled) setHighlighted(html);
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [path, lines]);

  return (
    <div>
      {lines.map((l, i) => (
        <div
          key={i}
          className={`grid grid-cols-[48px_48px_1fr] gap-2 px-2 ${
            l.kind === "add"
              ? "bg-green-50 dark:bg-green-950/40"
              : l.kind === "del"
              ? "bg-red-50 dark:bg-red-950/40"
              : ""
          }`}
        >
          <span className="select-none text-right text-neutral-400">{l.oldLine ?? ""}</span>
          <span className="select-none text-right text-neutral-400">{l.newLine ?? ""}</span>
          <span
            className="whitespace-pre [&_pre]:inline [&_pre]:bg-transparent"
            dangerouslySetInnerHTML={{ __html: highlighted?.[i] ?? escapeHtml(l.text) }}
          />
        </div>
      ))}
    </div>
  );
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
