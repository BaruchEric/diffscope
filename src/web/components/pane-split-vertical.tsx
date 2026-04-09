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
        className={
          "relative h-1 w-full shrink-0 cursor-row-resize bg-neutral-200 hover:bg-blue-400 dark:bg-neutral-800" +
          (dragging ? " bg-blue-500 dark:bg-blue-500" : "")
        }
        title="Drag to resize, double-click to reset"
      />
      <div className="h-full min-h-0 w-full min-w-0 flex-1 overflow-hidden">
        {bottom}
      </div>
    </div>
  );
}
