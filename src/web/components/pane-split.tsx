// src/web/components/pane-split.tsx
// Two-child horizontal split with a draggable divider.
// Left child width is persisted via useSettings.fileListWidthPx.
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useSettings } from "../settings";

const MIN_WIDTH = 180;
const MAX_FRACTION = 0.4;
const DEFAULT_WIDTH = 320;

function clamp(px: number): number {
  const max = Math.max(MIN_WIDTH + 100, Math.floor(window.innerWidth * MAX_FRACTION));
  return Math.min(Math.max(px, MIN_WIDTH), max);
}

export function PaneSplit({
  left,
  right,
}: {
  left: ReactNode;
  right: ReactNode;
}) {
  const widthPx = useSettings((s) => s.fileListWidthPx);
  const [dragging, setDragging] = useState(false);
  const rafRef = useRef<number | null>(null);
  const dragCleanupRef = useRef<(() => void) | null>(null);

  // Unmount cleanup — stops any in-flight drag.
  useEffect(() => {
    return () => {
      dragCleanupRef.current?.();
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, []);

  // Clamp on window resize so a saved width doesn't overflow after window
  // shrinks. rAF-throttled so rapid resizes don't thrash localStorage.
  useEffect(() => {
    let scheduled = false;
    const onResize = () => {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(() => {
        scheduled = false;
        const current = useSettings.getState().fileListWidthPx;
        const clamped = clamp(current);
        if (clamped !== current) {
          useSettings.getState().set({ fileListWidthPx: clamped });
        }
      });
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setDragging(true);
    const startX = e.clientX;
    const startWidth = useSettings.getState().fileListWidthPx;

    const onMove = (me: MouseEvent) => {
      if (rafRef.current !== null) return;
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        const next = clamp(startWidth + (me.clientX - startX));
        useSettings.getState().set({ fileListWidthPx: next });
      });
    };
    const cleanup = () => {
      setDragging(false);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      dragCleanupRef.current = null;
    };
    const onUp = () => cleanup();
    dragCleanupRef.current = cleanup;
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, []);

  const onDoubleClick = useCallback(() => {
    useSettings.getState().set({ fileListWidthPx: DEFAULT_WIDTH });
  }, []);

  return (
    <div className="flex h-full min-h-0 w-full">
      <div
        className="h-full min-h-0 shrink-0 overflow-hidden"
        style={{ width: widthPx }}
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
