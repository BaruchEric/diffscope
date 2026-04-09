// src/web/lib/use-pane-drag.ts
// Shared drag-to-resize mechanics for PaneSplit and PaneSplitVertical.
// Owns the mouse-event lifecycle, rAF throttling, resize-clamp, unmount
// cleanup, and writes the clamped pixel value through to useSettings.
import { useCallback, useEffect, useRef, useState } from "react";
import { useSettings, type Settings } from "../settings";

type NumericSettingsKey = {
  [K in keyof Settings]: Settings[K] extends number ? K : never;
}[keyof Settings];

type Axis = "x" | "y";

interface Options<K extends NumericSettingsKey> {
  axis: Axis;
  settingsKey: K;
  // Stable pure function (module-level or useCallback) that clamps a raw
  // pixel value against the current container/window. Called on every drag
  // tick and on window resize.
  clamp: (px: number) => number;
}

export function usePaneDrag<K extends NumericSettingsKey>({
  axis,
  settingsKey,
  clamp,
}: Options<K>) {
  const sizePx = useSettings((s) => s[settingsKey]) as number;
  const [dragging, setDragging] = useState(false);
  const rafRef = useRef<number | null>(null);
  const dragCleanupRef = useRef<(() => void) | null>(null);

  // Keep latest clamp in a ref so effects below can stay [] -deps and don't
  // tear down/rebuild listeners when the caller inlines a new clamp.
  const clampRef = useRef(clamp);
  useEffect(() => {
    clampRef.current = clamp;
  });

  const writeIfChanged = useCallback(
    (next: number) => {
      const current = useSettings.getState()[settingsKey] as number;
      if (next === current) return;
      useSettings.getState().set({ [settingsKey]: next } as Partial<Settings>);
    },
    [settingsKey],
  );

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

  // Clamp on window resize so a saved value doesn't overflow after the
  // window shrinks. rAF-throttled so rapid resizes don't thrash localStorage.
  useEffect(() => {
    let scheduled = false;
    const onResize = () => {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(() => {
        scheduled = false;
        const current = useSettings.getState()[settingsKey] as number;
        writeIfChanged(clampRef.current(current));
      });
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [settingsKey, writeIfChanged]);

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      setDragging(true);
      const startCoord = axis === "x" ? e.clientX : e.clientY;
      const startSize = useSettings.getState()[settingsKey] as number;

      const onMove = (me: MouseEvent) => {
        if (rafRef.current !== null) return;
        rafRef.current = requestAnimationFrame(() => {
          rafRef.current = null;
          const delta = (axis === "x" ? me.clientX : me.clientY) - startCoord;
          writeIfChanged(clampRef.current(startSize + delta));
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
    },
    [axis, settingsKey, writeIfChanged],
  );

  const onDoubleClick = useCallback(() => {
    useSettings.getState().reset([settingsKey]);
  }, [settingsKey]);

  return { sizePx, dragging, onMouseDown, onDoubleClick };
}
