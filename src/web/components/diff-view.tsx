import { useEffect, useState } from "react";
import type { DiffLine, ParsedDiff } from "@shared/types";
import { getHighlighter, langFromPath } from "../lib/highlight";
import { useStore } from "../store";

interface Props {
  diff: ParsedDiff | null;
  loading?: boolean;
}

const LARGE_HUNK_LINE_THRESHOLD = 5000;

export function DiffView({ diff, loading }: Props) {
  // All hooks must run unconditionally on every render (Rules of Hooks).
  const [userExpanded, setUserExpanded] = useState(false);
  const mode = useStore((s) => s.diffMode);

  if (loading) {
    return <div className="p-4 text-neutral-500">Loading diff…</div>;
  }
  if (!diff) {
    return <div className="p-4 text-neutral-500">Select a file to view its diff.</div>;
  }

  const isImage = /\.(png|jpe?g|gif|webp|svg|bmp|ico)$/i.test(diff.path);
  if (isImage) {
    return (
      <div className="grid h-full grid-cols-2 gap-4 p-6">
        <figure className="flex flex-col items-center gap-2">
          <figcaption className="text-xs text-neutral-500">Before (HEAD)</figcaption>
          <img
            src={`/api/blob?ref=HEAD&path=${encodeURIComponent(diff.path)}`}
            className="max-h-full max-w-full border border-neutral-200 dark:border-neutral-800"
            alt="before"
          />
        </figure>
        <figure className="flex flex-col items-center gap-2">
          <figcaption className="text-xs text-neutral-500">After (working tree)</figcaption>
          <img
            src={`/api/blob?ref=WORKDIR&path=${encodeURIComponent(diff.path)}`}
            className="max-h-full max-w-full border border-neutral-200 dark:border-neutral-800"
            alt="after"
          />
        </figure>
      </div>
    );
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
          {mode === "unified" ? (
            <HunkLines path={diff.path} lines={h.lines} />
          ) : (
            <SplitHunk lines={h.lines} />
          )}
        </div>
      ))}
    </div>
  );
}

interface SplitRow {
  left: DiffLine | null;
  right: DiffLine | null;
}

function SplitHunk({ lines }: { lines: DiffLine[] }) {
  // Pair deletions with additions greedily: emit left/right rows.
  const rows: SplitRow[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (line.kind === "context") {
      rows.push({ left: line, right: line });
      i++;
    } else if (line.kind === "del") {
      const dels: DiffLine[] = [];
      while (i < lines.length && lines[i]!.kind === "del") {
        dels.push(lines[i]!);
        i++;
      }
      const adds: DiffLine[] = [];
      while (i < lines.length && lines[i]!.kind === "add") {
        adds.push(lines[i]!);
        i++;
      }
      const n = Math.max(dels.length, adds.length);
      for (let k = 0; k < n; k++) {
        rows.push({ left: dels[k] ?? null, right: adds[k] ?? null });
      }
    } else {
      // Lone add (no preceding del)
      rows.push({ left: null, right: line });
      i++;
    }
  }

  return (
    <div className="grid grid-cols-2 divide-x divide-neutral-200 dark:divide-neutral-800">
      <SplitColumn entries={rows.map((r) => r.left)} side="left" />
      <SplitColumn entries={rows.map((r) => r.right)} side="right" />
    </div>
  );
}

function SplitColumn({
  entries,
  side,
}: {
  entries: (DiffLine | null)[];
  side: "left" | "right";
}) {
  return (
    <div>
      {entries.map((e, i) => {
        const bg =
          !e
            ? "bg-neutral-50 dark:bg-neutral-900/40"
            : e.kind === "del"
            ? "bg-red-50 dark:bg-red-950/40"
            : e.kind === "add"
            ? "bg-green-50 dark:bg-green-950/40"
            : "";
        const num = side === "left" ? e?.oldLine : e?.newLine;
        return (
          <div key={i} className={`grid grid-cols-[48px_1fr] gap-2 px-2 ${bg}`}>
            <span className="select-none text-right text-neutral-400">{num ?? ""}</span>
            <span className="whitespace-pre">{e?.text ?? ""}</span>
          </div>
        );
      })}
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
