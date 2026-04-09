// src/web/components/blame-gutter.tsx
import type { BlameLine } from "@shared/types";
import { useStore } from "../store";
import { relativeTime } from "../lib/relative-time";

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
  const initials = entry.author
    .split(" ")
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  return (
    <button
      onClick={() => {
        useStore.getState().focusCommit(entry.sha);
        useStore.getState().setTab("history");
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
