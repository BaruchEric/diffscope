// src/web/components/pane-split.tsx
// Two-child split with a draggable divider. `axis="x"` places the divider
// vertically (resizes left pane width); `axis="y"` places it horizontally
// (resizes top pane height). The two callsites keep their own clamp to match
// their content constraints; everything else (drag mechanics, knob, a11y)
// lives here.
import { useCallback, useRef, type ReactNode } from "react";
import { usePaneDrag } from "../lib/use-pane-drag";

const MIN_WIDTH = 160;
const MAX_WIDTH_FRACTION = 0.4;
// Below this viewport, the file-list pane should be allowed to collapse to
// a very tight width so the diff area isn't completely crowded out.
const NARROW_VIEWPORT = 720;
const NARROW_MIN_WIDTH = 120;

function clampWidth(px: number): number {
  const min = window.innerWidth < NARROW_VIEWPORT ? NARROW_MIN_WIDTH : MIN_WIDTH;
  const max = Math.max(min + 80, Math.floor(window.innerWidth * MAX_WIDTH_FRACTION));
  return Math.min(Math.max(px, min), max);
}

const MIN_HEIGHT = 44;
const MAX_HEIGHT_FRACTION = 0.75;

interface PaneSplitProps {
  axis: "x" | "y";
  /** First child — left (axis=x) or top (axis=y). */
  a: ReactNode;
  /** Second child — right (axis=x) or bottom (axis=y). */
  b: ReactNode;
}

/**
 * Horizontal split: `axis="x"` — divider is vertical, the left pane's width
 * is persisted to `fileListWidthPx`. Matches the width clamp from the
 * working-tree pane.
 *
 * Vertical split: `axis="y"` — divider is horizontal, the top pane's height
 * is persisted to `commitDetailHeightPx`. The height clamp is derived from
 * the enclosing container so a tight viewport can still leave room for the
 * diff area below.
 */
export function PaneSplit({ axis, a, b }: PaneSplitProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  const clampHeight = useCallback((px: number): number => {
    const containerH = containerRef.current?.clientHeight ?? window.innerHeight;
    const max = Math.max(MIN_HEIGHT + 40, Math.floor(containerH * MAX_HEIGHT_FRACTION));
    return Math.min(Math.max(px, MIN_HEIGHT), max);
  }, []);

  const { sizePx, dragging, onMouseDown, onDoubleClick } = usePaneDrag(
    axis === "x"
      ? { axis, settingsKey: "fileListWidthPx", clamp: clampWidth }
      : { axis, settingsKey: "commitDetailHeightPx", clamp: clampHeight },
  );

  const isX = axis === "x";
  const wrapperClass = isX
    ? "flex h-full min-h-0 w-full"
    : "flex h-full min-h-0 w-full flex-col";
  const paneAClass = isX
    ? "h-full min-h-0 shrink-0 overflow-hidden"
    : "w-full min-w-0 shrink-0 overflow-hidden";
  const paneAStyle = isX ? { width: sizePx } : { height: sizePx };
  const separatorClass = isX
    ? "group relative flex h-full w-1 shrink-0 cursor-col-resize items-center justify-center"
    : "group relative flex h-1 w-full shrink-0 cursor-row-resize items-center justify-center";
  const separatorBarClass = isX
    ? "h-full w-px transition-colors "
    : "h-px w-full transition-colors ";
  const knobClass = isX
    ? "flex h-6 w-1 flex-col items-center justify-center gap-0.5"
    : "flex h-1 w-6 flex-row items-center justify-center gap-0.5";
  const paneBClass = isX
    ? "h-full min-h-0 min-w-0 flex-1 overflow-hidden"
    : "h-full min-h-0 w-full min-w-0 flex-1 overflow-hidden";

  return (
    <div ref={containerRef} className={wrapperClass}>
      <div className={paneAClass} style={paneAStyle}>
        {a}
      </div>
      <div
        role="separator"
        aria-orientation={isX ? "vertical" : "horizontal"}
        onMouseDown={onMouseDown}
        onDoubleClick={onDoubleClick}
        className={separatorClass}
        title="Drag to resize, double-click to reset"
      >
        <div
          className={
            separatorBarClass +
            (dragging ? "bg-accent" : "bg-border group-hover:bg-accent")
          }
        />
        <div
          className={
            "pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 transition-opacity " +
            (dragging ? "opacity-100" : "opacity-0 group-hover:opacity-100")
          }
        >
          <div className={knobClass}>
            <div className="h-0.5 w-0.5 rounded-full bg-accent-fg" />
            <div className="h-0.5 w-0.5 rounded-full bg-accent-fg" />
            <div className="h-0.5 w-0.5 rounded-full bg-accent-fg" />
          </div>
        </div>
      </div>
      <div className={paneBClass}>{b}</div>
    </div>
  );
}
