// src/web/components/blame-gutter.tsx
import type { BlameLine } from "@shared/types";
import { useStore } from "../store";
import { useSettings } from "../settings";
import { relativeTime } from "../lib/relative-time";

// Module-level cache: one BlameGutter renders per line, so a 2000-line file
// calls this 2000 times per render. Memoizing by author name collapses those
// into a handful of computations — author count per file is typically <20.
const initialsCache = new Map<string, string>();
function authorInitials(author: string): string {
  const cached = initialsCache.get(author);
  if (cached !== undefined) return cached;
  const initials = author
    .split(" ")
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  initialsCache.set(author, initials);
  return initials;
}

export function BlameGutter({
  blame,
  lineNumber,
}: {
  blame: BlameLine[] | undefined;
  lineNumber: number | undefined;
}) {
  if (!blame || lineNumber === undefined) {
    return <span className="w-28 shrink-0 text-right text-fg-subtle">—</span>;
  }
  const entry = blame[lineNumber - 1];
  if (!entry) {
    return <span className="w-28 shrink-0 text-right text-fg-subtle">—</span>;
  }
  const rel = relativeTime(entry.authorTimeIso, "short");
  const initials = authorInitials(entry.author);
  return (
    <button
      onClick={() => {
        useStore.getState().focusCommit(entry.sha);
        useSettings.getState().set({ lastUsedTab: "history" });
      }}
      title={`${entry.author} • ${entry.authorTimeIso}\n${entry.summary}`}
      className="w-28 shrink-0 overflow-hidden truncate text-right font-mono text-[10px] text-fg-muted hover:text-accent"
    >
      <span>{entry.shaShort}</span>
      <span className="mx-1">{initials}</span>
      <span>{rel}</span>
    </button>
  );
}
