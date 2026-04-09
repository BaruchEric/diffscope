// src/web/components/pane-split-vertical.tsx
// Two-child vertical split with a draggable horizontal divider.
// Top child height is persisted via useSettings.commitDetailHeightPx.
import { useCallback, useRef, type ReactNode } from "react";
import { usePaneDrag } from "../lib/use-pane-drag";

const MIN_HEIGHT = 44;
const MAX_FRACTION = 0.75;

export function PaneSplitVertical({
  top,
  bottom,
}: {
  top: ReactNode;
  bottom: ReactNode;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  const clampHeight = useCallback((px: number): number => {
    const containerH =
      containerRef.current?.clientHeight ?? window.innerHeight;
    const max = Math.max(
      MIN_HEIGHT + 40,
      Math.floor(containerH * MAX_FRACTION),
    );
    return Math.min(Math.max(px, MIN_HEIGHT), max);
  }, []);

  const { sizePx, dragging, onMouseDown, onDoubleClick } = usePaneDrag({
    axis: "y",
    settingsKey: "commitDetailHeightPx",
    clamp: clampHeight,
  });

  return (
    <div ref={containerRef} className="flex h-full min-h-0 w-full flex-col">
      <div
        className="w-full min-w-0 shrink-0 overflow-hidden"
        style={{ height: sizePx }}
      >
        {top}
      </div>
      <div
        role="separator"
        aria-orientation="horizontal"
        onMouseDown={onMouseDown}
        onDoubleClick={onDoubleClick}
        className="group relative flex h-1 w-full shrink-0 cursor-row-resize items-center justify-center"
        title="Drag to resize, double-click to reset"
      >
        <div
          className={
            "h-px w-full transition-colors " +
            (dragging ? "bg-accent" : "bg-border group-hover:bg-accent")
          }
        />
        <div
          className={
            "pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 transition-opacity " +
            (dragging ? "opacity-100" : "opacity-0 group-hover:opacity-100")
          }
        >
          <div className="flex h-1 w-6 flex-row items-center justify-center gap-0.5">
            <div className="h-0.5 w-0.5 rounded-full bg-accent-fg" />
            <div className="h-0.5 w-0.5 rounded-full bg-accent-fg" />
            <div className="h-0.5 w-0.5 rounded-full bg-accent-fg" />
          </div>
        </div>
      </div>
      <div className="h-full min-h-0 w-full min-w-0 flex-1 overflow-hidden">
        {bottom}
      </div>
    </div>
  );
}
