import { useEffect, useRef } from "react";
import { useStore, type Toast } from "../store";

const TOAST_TTL_MS = 5000;

// Variant styles keyed by the store's Toast["kind"] union. Add a new entry
// here only after widening the store type — the Record constraint enforces
// that the two stay in sync.
const VARIANT_CLASSES: Record<Toast["kind"], string> = {
  warning: "bg-accent-soft text-accent border-accent",
  error: "bg-diff-del-bg text-diff-del-fg border-diff-del-sign",
};

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
      {toasts.map((t) => {
        const variant = VARIANT_CLASSES[t.kind];
        return (
          <div
            key={t.id}
            className={`pointer-events-auto flex max-w-sm items-start gap-2 rounded border px-3 py-2 text-sm shadow-soft ${variant}`}
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
        );
      })}
    </div>
  );
}
