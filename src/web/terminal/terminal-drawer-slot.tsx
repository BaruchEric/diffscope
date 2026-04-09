// src/web/terminal/terminal-drawer-slot.tsx
// Always-loaded shell that decides whether to render the drawer. Uses
// React.lazy so xterm.js and the rest of the drawer code land in a
// separate Vite chunk loaded only when drawerOpen flips true.
import { Suspense, lazy } from "react";
import { useSettings } from "../settings";
import { usePaneDrag } from "../lib/use-pane-drag";

const TerminalDrawer = lazy(() => import("./terminal-drawer"));

const MIN_HEIGHT = 120;
const MAX_HEIGHT_FRACTION = 0.8;

function clampHeight(px: number): number {
  const max = Math.max(
    MIN_HEIGHT + 60,
    Math.floor(window.innerHeight * MAX_HEIGHT_FRACTION),
  );
  return Math.min(Math.max(px, MIN_HEIGHT), max);
}

export function TerminalDrawerSlot() {
  const open = useSettings((s) => s.terminalDrawerOpen);
  const { sizePx, dragging, onMouseDown, onDoubleClick } = usePaneDrag({
    axis: "y",
    settingsKey: "terminalDrawerHeightPx",
    clamp: clampHeight,
  });

  if (!open) return null;

  return (
    <div className="flex shrink-0 flex-col" style={{ height: sizePx }}>
      <div
        role="separator"
        aria-orientation="horizontal"
        onMouseDown={onMouseDown}
        onDoubleClick={onDoubleClick}
        className="group relative flex h-1 w-full shrink-0 cursor-row-resize items-center justify-center"
        title="Drag to resize, double-click to reset"
      >
        <div
          className={`h-px w-full transition-colors ${
            dragging ? "bg-accent" : "bg-border group-hover:bg-accent"
          }`}
        />
      </div>
      <div className="min-h-0 flex-1">
        <Suspense
          fallback={
            <div className="flex h-full items-center justify-center text-[12px] text-fg-subtle">
              Loading terminal…
            </div>
          }
        >
          <TerminalDrawer />
        </Suspense>
      </div>
    </div>
  );
}
