import { useEffect, useRef } from "react";
import { useStore } from "../store";

const TOAST_TTL_MS = 5000;

export function Toasts() {
  const toasts = useStore((s) => s.toasts);
  const dismissToast = useStore((s) => s.dismissToast);
  const timersRef = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  // Schedule exactly one TTL timer per toast id. Without this, a new toast
  // triggered the old effect's cleanup, which cleared every running timer
  // and rescheduled them — so older toasts never expired under load.
  useEffect(() => {
    const timers = timersRef.current;
    const alive = new Set(toasts.map((t) => t.id));
    // Schedule timers for new toasts.
    for (const t of toasts) {
      if (timers.has(t.id)) continue;
      timers.set(
        t.id,
        setTimeout(() => {
          timers.delete(t.id);
          dismissToast(t.id);
        }, TOAST_TTL_MS),
      );
    }
    // Clear timers for toasts that have been dismissed externally.
    for (const [id, timer] of timers) {
      if (!alive.has(id)) {
        clearTimeout(timer);
        timers.delete(id);
      }
    }
  }, [toasts, dismissToast]);

  // On unmount, clear all pending timers.
  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
    };
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div className="pointer-events-none fixed bottom-10 right-4 z-50 flex flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`pointer-events-auto flex max-w-sm items-start gap-2 rounded border px-3 py-2 text-sm shadow-lg ${
            t.kind === "error"
              ? "border-red-300 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-100"
              : "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100"
          }`}
        >
          <span className="flex-1 break-words">{t.message}</span>
          <button
            onClick={() => dismissToast(t.id)}
            className="shrink-0 text-xs opacity-60 hover:opacity-100"
            aria-label="Dismiss"
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
