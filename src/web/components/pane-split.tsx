// src/web/components/pane-split.tsx
// Two-child horizontal split with a draggable divider.
// Left child width is persisted via useSettings.fileListWidthPx.
import { type ReactNode } from "react";
import { usePaneDrag } from "../lib/use-pane-drag";

const MIN_WIDTH = 160;
const MAX_FRACTION = 0.4;
// Below this viewport, the file-list pane should be allowed to collapse to
// a very tight width so the diff area isn't completely crowded out.
const NARROW_VIEWPORT = 720;
const NARROW_MIN_WIDTH = 120;

function effectiveMin(): number {
  return window.innerWidth < NARROW_VIEWPORT ? NARROW_MIN_WIDTH : MIN_WIDTH;
}

function clampWidth(px: number): number {
  const min = effectiveMin();
  const max = Math.max(min + 80, Math.floor(window.innerWidth * MAX_FRACTION));
  return Math.min(Math.max(px, min), max);
}

export function PaneSplit({
  left,
  right,
}: {
  left: ReactNode;
  right: ReactNode;
}) {
  const { sizePx, dragging, onMouseDown, onDoubleClick } = usePaneDrag({
    axis: "x",
    settingsKey: "fileListWidthPx",
    clamp: clampWidth,
  });

  return (
    <div className="flex h-full min-h-0 w-full">
      <div
        className="h-full min-h-0 shrink-0 overflow-hidden"
        style={{ width: sizePx }}
      >
        {left}
      </div>
      <div
        role="separator"
        aria-orientation="vertical"
        onMouseDown={onMouseDown}
        onDoubleClick={onDoubleClick}
        className="group relative flex h-full w-1 shrink-0 cursor-col-resize items-center justify-center"
        title="Drag to resize, double-click to reset"
      >
        <div
          className={
            "h-full w-px transition-colors " +
            (dragging ? "bg-accent" : "bg-border group-hover:bg-accent")
          }
        />
        <div
          className={
            "pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 transition-opacity " +
            (dragging ? "opacity-100" : "opacity-0 group-hover:opacity-100")
          }
        >
          <div className="flex h-6 w-1 flex-col items-center justify-center gap-0.5">
            <div className="h-0.5 w-0.5 rounded-full bg-accent-fg" />
            <div className="h-0.5 w-0.5 rounded-full bg-accent-fg" />
            <div className="h-0.5 w-0.5 rounded-full bg-accent-fg" />
          </div>
        </div>
      </div>
      <div className="h-full min-h-0 min-w-0 flex-1 overflow-hidden">{right}</div>
    </div>
  );
}
