import { useEffect, useMemo, useState } from "react";
import type { BlameLine, DiffLine, ParsedDiff } from "@shared/types";
import { getHighlighter, langFromPath } from "../lib/highlight";
import { escapeHtml } from "../lib/html";
import { useStore } from "../store";
import { useSettings } from "../settings";
import { BlameGutter } from "./blame-gutter";
import {
  OpenInEditorLineIcon,
  OpenInEditorHeaderButton,
} from "./open-in-editor";

interface Props {
  diff: ParsedDiff | null;
  loading?: boolean;
}

const LARGE_HUNK_LINE_THRESHOLD = 5000;

export function DiffView({ diff, loading }: Props) {
  // All hooks must run unconditionally on every render (Rules of Hooks).
  const [userExpanded, setUserExpanded] = useState(false);
  const mode = useStore((s) => s.diffMode);
  const focusedPath = useStore((s) => s.focusedPath);
  const blameOnFor = useStore((s) => s.blameOnFor);
  const blameCache = useStore((s) => s.blameCache);
  const repo = useStore((s) => s.repo);

  if (loading) {
    return <div className="p-4 text-neutral-500">Loading diff…</div>;
  }
  if (!diff) {
    return <div className="p-4 text-neutral-500">Select a file to view its diff.</div>;
  }

  const isImage = /\.(png|jpe?g|gif|webp|svg|bmp|ico)$/i.test(diff.path);
  if (isImage) {
    return <ImageDiff diff={diff} />;
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

  const isFocused = focusedPath === diff.path;
  const blameOnForThis = isFocused && blameOnFor.has(diff.path);
  const blameKey = isFocused && repo ? `${diff.path}@${repo.headSha}` : null;
  const blameLines = blameKey ? blameCache.get(blameKey) : undefined;
  const absPathForEditor =
    isFocused && repo ? `${repo.root}/${diff.path}` : null;

  return (
    <div className="h-full overflow-auto font-mono text-[13px]">
      <div className="flex items-center justify-between border-b border-neutral-200 bg-neutral-50 px-3 py-1 text-xs text-neutral-500 dark:border-neutral-800 dark:bg-neutral-900">
        <span>
          {diff.oldPath && diff.oldPath !== diff.path ? `${diff.oldPath} → ${diff.path}` : diff.path}
        </span>
        <DiffViewHeaderControls diff={diff} />
      </div>
      {diff.hunks.map((h) => (
        <div
          key={`${h.oldStart}-${h.newStart}-${h.header}`}
          className="border-b border-neutral-100 last:border-b-0 dark:border-neutral-900"
        >
          <div className="bg-cyan-50 px-3 py-0.5 text-cyan-700 dark:bg-cyan-950 dark:text-cyan-300">
            {h.header}
          </div>
          {mode === "unified" ? (
            <HunkLines
              path={diff.path}
              lines={h.lines}
              blameOn={blameOnForThis}
              blame={blameLines}
              absPath={absPathForEditor}
            />
          ) : (
            <SplitHunk path={diff.path} lines={h.lines} />
          )}
        </div>
      ))}
    </div>
  );
}

function DiffViewHeaderControls({ diff }: { diff: ParsedDiff }) {
  const focusedPath = useStore((s) => s.focusedPath);
  const blameOnFor = useStore((s) => s.blameOnFor);
  const repo = useStore((s) => s.repo);
  const toggleBlame = useStore((s) => s.toggleBlame);

  // Only show controls when the diff is for the currently focused file.
  if (!focusedPath || focusedPath !== diff.path) return null;

  const blameOn = blameOnFor.has(focusedPath);
  const firstLine = diff.hunks[0]?.newStart ?? 1;
  const absPath = `${repo?.root ?? ""}/${focusedPath}`;

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={() => toggleBlame(focusedPath)}
        aria-pressed={blameOn}
        title="Toggle blame (HEAD only) — b"
        className={
          "rounded px-2 py-0.5 text-xs " +
          (blameOn
            ? "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-200"
            : "hover:bg-neutral-100 dark:hover:bg-neutral-800")
        }
      >
        Blame
      </button>
      <OpenInEditorHeaderButton absPath={absPath} firstLine={firstLine} />
    </div>
  );
}

interface SplitRow {
  left: DiffLine | null;
  right: DiffLine | null;
}

function SplitHunk({ path, lines }: { path: string; lines: DiffLine[] }) {
  // Memoize the row pairing so re-renders (e.g. from unrelated store updates)
  // don't rebuild `rows` and hand new array identities to `SplitColumn`,
  // which in turn would fire `useHighlightedTexts` effects unnecessarily.
  const rows = useMemo(() => pairRows(lines), [lines]);
  const leftEntries = useMemo(() => rows.map((r) => r.left), [rows]);
  const rightEntries = useMemo(() => rows.map((r) => r.right), [rows]);

  return (
    <div className="grid grid-cols-2 divide-x divide-neutral-200 dark:divide-neutral-800">
      <SplitColumn path={path} entries={leftEntries} side="left" />
      <SplitColumn path={path} entries={rightEntries} side="right" />
    </div>
  );
}

function pairRows(lines: DiffLine[]): SplitRow[] {
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
  return rows;
}

function SplitColumn({
  path,
  entries,
  side,
}: {
  path: string;
  entries: (DiffLine | null)[];
  side: "left" | "right";
}) {
  const texts = useMemo(() => entries.map((e) => e?.text ?? ""), [entries]);
  const highlighted = useHighlightedTexts(path, texts);
  return (
    <table className="w-max min-w-full border-collapse">
      <tbody>
        {entries.map((e, i) => {
          const bg =
            !e
              ? "bg-neutral-50 dark:bg-neutral-900/40"
              : e.kind === "del"
              ? "bg-red-100 dark:bg-red-900"
              : e.kind === "add"
              ? "bg-green-100 dark:bg-green-900"
              : "";
          const num = side === "left" ? e?.oldLine : e?.newLine;
          return (
            <tr key={i} className={bg}>
              <td className="w-12 select-none px-2 text-right align-top text-neutral-400">
                {num ?? ""}
              </td>
              <td
                className="whitespace-pre pr-2 align-top [&_pre]:inline [&_pre]:!bg-transparent [&_code]:!bg-transparent"
                dangerouslySetInnerHTML={{
                  __html: highlighted?.[i] ?? escapeHtml(e?.text ?? ""),
                }}
              />
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function HunkLines({
  path,
  lines,
  blameOn,
  blame,
  absPath,
}: {
  path: string;
  lines: DiffLine[];
  blameOn: boolean;
  blame: BlameLine[] | undefined;
  absPath: string | null;
}) {
  const texts = useMemo(() => lines.map((l) => l.text), [lines]);
  const highlighted = useHighlightedTexts(path, texts);
  return (
    <table className="w-max min-w-full border-collapse">
      <tbody>
        {lines.map((l, i) => (
          <tr
            key={i}
            className={
              "group " +
              (l.kind === "add"
                ? "bg-green-100 dark:bg-green-900"
                : l.kind === "del"
                ? "bg-red-100 dark:bg-red-900"
                : "")
            }
          >
            {blameOn && (
              <td className="select-none px-2 align-top">
                <BlameGutter blame={blame} lineNumber={l.newLine ?? l.oldLine} />
              </td>
            )}
            <td className="w-12 select-none px-2 text-right align-top text-neutral-400">
              {l.oldLine ?? ""}
            </td>
            <td className="w-12 select-none px-2 text-right align-top text-neutral-400">
              {l.newLine ?? ""}
            </td>
            <td
              className="whitespace-pre pr-2 align-top [&_pre]:inline [&_pre]:!bg-transparent [&_code]:!bg-transparent"
              dangerouslySetInnerHTML={{
                __html: highlighted?.[i] ?? escapeHtml(l.text),
              }}
            />
            {absPath && l.newLine !== undefined && (
              <td className="w-6 align-top">
                <OpenInEditorLineIcon absPath={absPath} line={l.newLine} />
              </td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function resolveShikiTheme(setting: "system" | "light" | "dark"): "github-dark" | "github-light" {
  if (setting === "dark") return "github-dark";
  if (setting === "light") return "github-light";
  const isDark =
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-color-scheme: dark)").matches;
  return isDark ? "github-dark" : "github-light";
}

/**
 * Async-highlight an array of text lines via Shiki, returning HTML strings or
 * null while loading. Used by both unified and split diff renderers. Reacts
 * to the user's theme setting so toggling light/dark re-highlights.
 */
function useHighlightedTexts(path: string, texts: string[]): string[] | null {
  const [highlighted, setHighlighted] = useState<string[] | null>(null);
  const themeSetting = useSettings((s) => s.theme);
  // Cheap stable key — texts arrays are line-by-line, joining with NUL is
  // cheap and avoids re-running the effect on every parent render.
  const key = useMemo(() => texts.join("\x00"), [texts]);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const highlighter = await getHighlighter();
      const lang = langFromPath(path);
      const theme = resolveShikiTheme(themeSetting);
      const html = texts.map((text) => {
        try {
          return highlighter.codeToHtml(text, { lang, theme });
        } catch {
          return escapeHtml(text);
        }
      });
      if (!cancelled) setHighlighted(html);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, key, themeSetting]);
  return highlighted;
}

function ImageDiff({ diff }: { diff: ParsedDiff }) {
  const [beforeMissing, setBeforeMissing] = useState(false);
  const [afterMissing, setAfterMissing] = useState(false);
  const beforeUrl = `/api/blob?ref=HEAD&path=${encodeURIComponent(diff.oldPath ?? diff.path)}`;
  const afterUrl = `/api/blob?ref=WORKDIR&path=${encodeURIComponent(diff.path)}`;
  return (
    <div className="grid h-full grid-cols-2 gap-4 p-6">
      <figure className="flex flex-col items-center gap-2 overflow-hidden">
        <figcaption className="text-xs text-neutral-500">
          {beforeMissing ? "(new file — no previous version)" : "Before (HEAD)"}
        </figcaption>
        {beforeMissing ? (
          <ImagePlaceholder label="Added" />
        ) : (
          <img
            src={beforeUrl}
            onError={() => setBeforeMissing(true)}
            className="max-h-full max-w-full border border-neutral-200 dark:border-neutral-800"
            alt="before"
          />
        )}
      </figure>
      <figure className="flex flex-col items-center gap-2 overflow-hidden">
        <figcaption className="text-xs text-neutral-500">
          {afterMissing ? "(deleted — no current version)" : "After (working tree)"}
        </figcaption>
        {afterMissing ? (
          <ImagePlaceholder label="Deleted" />
        ) : (
          <img
            src={afterUrl}
            onError={() => setAfterMissing(true)}
            className="max-h-full max-w-full border border-neutral-200 dark:border-neutral-800"
            alt="after"
          />
        )}
      </figure>
    </div>
  );
}

function ImagePlaceholder({ label }: { label: string }) {
  return (
    <div className="flex h-32 w-full items-center justify-center rounded border border-dashed border-neutral-300 text-sm text-neutral-500 dark:border-neutral-700">
      {label}
    </div>
  );
}

