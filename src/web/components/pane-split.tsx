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
        className={
          "relative h-full w-1 shrink-0 cursor-col-resize bg-neutral-200 hover:bg-blue-400 dark:bg-neutral-800" +
          (dragging ? " bg-blue-500 dark:bg-blue-500" : "")
        }
        title="Drag to resize, double-click to reset"
      />
      <div className="h-full min-h-0 min-w-0 flex-1 overflow-hidden">{right}</div>
    </div>
  );
}
