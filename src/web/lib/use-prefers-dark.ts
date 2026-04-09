// src/web/lib/use-prefers-dark.ts
// Subscribe to the OS dark-mode preference. Re-renders the caller whenever
// the user flips their OS theme — lets components that render via
// `resolveThemeId(..., prefersDark)` stay in sync without manual wiring.
import { useSyncExternalStore } from "react";

const QUERY = "(prefers-color-scheme: dark)";

function subscribe(cb: () => void): () => void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return () => {};
  }
  const mq = window.matchMedia(QUERY);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}

function getSnapshot(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  return window.matchMedia(QUERY).matches;
}

function getServerSnapshot(): boolean {
  return false;
}

export function usePrefersDark(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
