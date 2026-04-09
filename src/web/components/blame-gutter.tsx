// src/web/components/blame-gutter.tsx
import type { BlameLine } from "@shared/types";
import { useStore } from "../store";

export function BlameGutter({
  blame,
  lineNumber,
}: {
  blame: BlameLine[] | undefined;
  lineNumber: number | undefined;
}) {
  if (!blame || lineNumber === undefined) {
    return <span className="w-28 shrink-0 text-right text-neutral-400">—</span>;
  }
  const entry = blame[lineNumber - 1];
  if (!entry) {
    return <span className="w-28 shrink-0 text-right text-neutral-400">—</span>;
  }
  const rel = formatRelative(entry.authorTimeIso);
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
      className="w-28 shrink-0 overflow-hidden truncate text-right font-mono text-[10px] text-neutral-500 hover:text-blue-500"
    >
      <span>{entry.shaShort}</span>
      <span className="mx-1">{initials}</span>
      <span>{rel}</span>
    </button>
  );
}

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  const diff = Date.now() - then;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo`;
  const years = Math.floor(days / 365);
  return `${years}y`;
}
