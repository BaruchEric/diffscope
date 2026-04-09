import type { SseEvent } from "@shared/types";

export interface SseClient {
  close(): void;
}

/**
 * Open a persistent SSE connection to /api/stream. EventSource handles
 * reconnect with its own backoff on network errors; we surface state
 * transitions via `onDown` / `onUp` so the store can flip the "live
 * updates off" badge cleanly when connectivity returns.
 */
export function openSseStream(
  onEvent: (event: SseEvent) => void,
  onDown?: () => void,
  onUp?: () => void,
): SseClient {
  const source = new EventSource("/api/stream");
  let wasDown = false;
  source.onopen = () => {
    if (wasDown) {
      wasDown = false;
      onUp?.();
    }
  };
  source.onmessage = (msg) => {
    try {
      const event = JSON.parse(msg.data) as SseEvent;
      onEvent(event);
    } catch {
      // malformed frame — ignore
    }
  };
  source.onerror = () => {
    if (!wasDown) {
      wasDown = true;
      onDown?.();
    }
  };
  return {
    close() {
      source.close();
    },
  };
}
