import { memo, useCallback, useEffect, useMemo, useState } from "react";
import type { BlameLine, DiffLine, ParsedDiff } from "@shared/types";
import { activeShikiTheme, getHighlighter, langFromPath } from "../lib/highlight";
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
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
}

const LARGE_HUNK_LINE_THRESHOLD = 5000;
// Two side-by-side code panes each need ~400px to be legible, plus gutters.
// Measured from DiffView's own container, not the viewport, because the
// file-list pane can eat 300+px of the window.
const SPLIT_MIN_CONTAINER_WIDTH = 900;

export function DiffView({
  diff,
  loading,
  collapsed: collapsedProp,
  onToggleCollapsed,
}: Props) {
  const [userExpanded, setUserExpanded] = useState(false);
  const [internalCollapsed, setInternalCollapsed] = useState(false);
  const collapsed = collapsedProp ?? internalCollapsed;
  const toggleCollapsed = useCallback(() => {
    if (onToggleCollapsed) onToggleCollapsed();
    else setInternalCollapsed((v) => !v);
  }, [onToggleCollapsed]);
  const mode = useStore((s) => s.diffMode);
  const focusedPath = useStore((s) => s.focusedPath);
  const blameOnFor = useStore((s) => s.blameOnFor);
  const blameCache = useStore((s) => s.blameCache);
  const repo = useStore((s) => s.repo);

  // Callback ref because the outer <div> only mounts after the loading/empty
  // early returns — the effect re-runs when the element attaches.
  const [containerEl, setContainerEl] = useState<HTMLDivElement | null>(null);
  const [containerNarrow, setContainerNarrow] = useState(
    () => window.innerWidth < SPLIT_MIN_CONTAINER_WIDTH + 320,
  );
  useEffect(() => {
    if (!containerEl) return;
    const ro = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0;
      setContainerNarrow(width > 0 && width < SPLIT_MIN_CONTAINER_WIDTH);
    });
    ro.observe(containerEl);
    return () => ro.disconnect();
  }, [containerEl]);

  if (loading) {
    return <div className="p-4 text-fg-muted">Loading diff…</div>;
  }
  if (!diff) {
    return <div className="p-4 text-fg-muted">Select a file to view its diff.</div>;
  }

  const isImage = /\.(png|jpe?g|gif|webp|svg|bmp|ico)$/i.test(diff.path);
  if (isImage) {
    return <ImageDiff diff={diff} />;
  }

  if (diff.binary) {
    return (
      <div className="p-4 text-sm text-fg-muted">
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
        <p className="text-sm text-fg-muted">
          Large diff ({totalLines} lines) — collapsed by default.
        </p>
        <button
          onClick={() => setUserExpanded(true)}
          className="mt-2 rounded bg-surface-hover px-3 py-1 text-sm text-fg"
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
  // Force unified when too narrow, but keep the user's preference so widening
  // the window flips split back automatically.
  const effectiveMode = containerNarrow ? "unified" : mode;

  return (
    <div ref={setContainerEl} className="font-mono text-[13px]">
      <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-y border-border bg-surface/95 px-4 py-2 text-sm backdrop-blur">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <button
            onClick={toggleCollapsed}
            className="shrink-0 rounded px-1 text-xs text-fg-muted hover:bg-surface-hover"
            title={collapsed ? "Expand file" : "Collapse file"}
            aria-expanded={!collapsed}
          >
            {collapsed ? "▸" : "▾"}
          </button>
          <FilePathLabel path={diff.path} oldPath={diff.oldPath} />
        </div>
        <DiffViewHeaderControls diff={diff} />
      </div>
      {!collapsed &&
        diff.hunks.map((h) => (
        <div
          key={`${h.oldStart}-${h.newStart}-${h.header}`}
          className="border-b border-border last:border-b-0"
        >
          <div className="bg-hunk-bg px-3 py-0.5 text-hunk-fg">
            {h.header}
          </div>
          {effectiveMode === "unified" ? (
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

function FilePathLabel({ path, oldPath }: { path: string; oldPath?: string }) {
  return (
    <span className="min-w-0 flex-1 truncate font-mono">
      {oldPath && oldPath !== path && (
        <>
          <PathParts path={oldPath} muted />
          <span className="mx-2 text-fg-muted">→</span>
        </>
      )}
      <PathParts path={path} />
    </span>
  );
}

function PathParts({ path, muted }: { path: string; muted?: boolean }) {
  const slash = path.lastIndexOf("/");
  const dir = slash >= 0 ? path.slice(0, slash + 1) : "";
  const name = slash >= 0 ? path.slice(slash + 1) : path;
  const dirClass = muted
    ? "text-fg-subtle"
    : "text-fg-muted";
  const nameClass = muted
    ? "text-fg-subtle line-through"
    : "font-semibold text-fg";
  return (
    <>
      {dir && <span className={dirClass}>{dir}</span>}
      <span className={nameClass}>{name}</span>
    </>
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
            ? "bg-accent-soft text-accent"
            : "hover:bg-surface-hover")
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

const SPLIT_CELL_CLASS =
  "overflow-hidden whitespace-pre pr-2 align-top [&_pre]:inline [&_pre]:!bg-transparent [&_code]:!bg-transparent";
const SPLIT_GUTTER_CLASS =
  "select-none px-2 text-right align-top text-fg-subtle";
const SPLIT_EMPTY_BG = "bg-bg-elevated";

function sideBg(line: DiffLine | null, kind: "del" | "add"): string {
  if (!line) return SPLIT_EMPTY_BG;
  if (line.kind === kind) {
    return kind === "del"
      ? "bg-diff-del-bg"
      : "bg-diff-add-bg";
  }
  return "";
}

// Single table (not two side-by-side) so left/right cells in a row share
// height via normal table row-height rules. `table-fixed` + colgroup pins the
// two text columns to 50/50; without it, auto layout creates a dead gap when
// one side's lines are longer than the other. Long lines clip inside each
// cell — users can switch to unified view to read them.
const SplitHunk = memo(function SplitHunk({
  path,
  lines,
}: {
  path: string;
  lines: DiffLine[];
}) {
  const rows = useMemo(() => pairRows(lines), [lines]);
  const leftTexts = useMemo(() => rows.map((r) => r.left?.text ?? ""), [rows]);
  const rightTexts = useMemo(() => rows.map((r) => r.right?.text ?? ""), [rows]);
  const leftHighlighted = useHighlightedTexts(path, leftTexts);
  const rightHighlighted = useHighlightedTexts(path, rightTexts);

  return (
    <table className="w-full table-fixed border-collapse">
      <colgroup>
        <col style={{ width: "3rem" }} />
        <col />
        <col style={{ width: "3rem" }} />
        <col />
      </colgroup>
      <tbody>
        {rows.map((row, i) => {
          const leftBg = sideBg(row.left, "del");
          const rightBg = sideBg(row.right, "add");
          return (
            <tr key={i}>
              <td className={`${SPLIT_GUTTER_CLASS} ${leftBg}`}>
                {row.left?.oldLine ?? ""}
              </td>
              <td
                className={`${SPLIT_CELL_CLASS} ${leftBg}`}
                title={row.left?.text}
                dangerouslySetInnerHTML={{
                  __html:
                    leftHighlighted?.[i] ?? escapeHtml(row.left?.text ?? ""),
                }}
              />
              <td
                className={`${SPLIT_GUTTER_CLASS} border-l border-border ${rightBg}`}
              >
                {row.right?.newLine ?? ""}
              </td>
              <td
                className={`${SPLIT_CELL_CLASS} ${rightBg}`}
                title={row.right?.text}
                dangerouslySetInnerHTML={{
                  __html:
                    rightHighlighted?.[i] ?? escapeHtml(row.right?.text ?? ""),
                }}
              />
            </tr>
          );
        })}
      </tbody>
    </table>
  );
});

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
                ? "diff-row-add bg-diff-add-bg text-diff-add-fg"
                : l.kind === "del"
                ? "diff-row-del bg-diff-del-bg text-diff-del-fg"
                : "")
            }
          >
            {blameOn && (
              <td className="select-none px-2 align-top">
                <BlameGutter blame={blame} lineNumber={l.newLine ?? l.oldLine} />
              </td>
            )}
            <td className="w-12 select-none px-2 text-right align-top text-fg-subtle">
              {l.oldLine ?? ""}
            </td>
            <td className="w-12 select-none px-2 text-right align-top text-fg-subtle">
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

/**
 * Async-highlight an array of text lines via Shiki, returning HTML strings or
 * null while loading. Used by both unified and split diff renderers. Reacts
 * to the user's theme setting so toggling themes re-highlights with the
 * shiki theme declared in the active preset's THEMES entry.
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
      const theme = activeShikiTheme();
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
        <figcaption className="text-xs text-fg-muted">
          {beforeMissing ? "(new file — no previous version)" : "Before (HEAD)"}
        </figcaption>
        {beforeMissing ? (
          <ImagePlaceholder label="Added" />
        ) : (
          <img
            src={beforeUrl}
            onError={() => setBeforeMissing(true)}
            className="max-h-full max-w-full border border-border"
            alt="before"
          />
        )}
      </figure>
      <figure className="flex flex-col items-center gap-2 overflow-hidden">
        <figcaption className="text-xs text-fg-muted">
          {afterMissing ? "(deleted — no current version)" : "After (working tree)"}
        </figcaption>
        {afterMissing ? (
          <ImagePlaceholder label="Deleted" />
        ) : (
          <img
            src={afterUrl}
            onError={() => setAfterMissing(true)}
            className="max-h-full max-w-full border border-border"
            alt="after"
          />
        )}
      </figure>
    </div>
  );
}

function ImagePlaceholder({ label }: { label: string }) {
  return (
    <div className="flex h-32 w-full items-center justify-center rounded border border-dashed border-border-strong text-sm text-fg-muted">
      {label}
    </div>
  );
}

