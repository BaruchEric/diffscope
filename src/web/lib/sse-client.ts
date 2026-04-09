import type { SseEvent } from "@shared/types";

export interface SseClient {
  close(): void;
}

export function openSseStream(
  onEvent: (event: SseEvent) => void,
  onError?: (err: Event) => void,
): SseClient {
  const source = new EventSource("/api/stream");
  source.onmessage = (msg) => {
    try {
      const event = JSON.parse(msg.data) as SseEvent;
      onEvent(event);
    } catch {
      // malformed frame — ignore
    }
  };
  source.onerror = (err) => onError?.(err);
  return {
    close() {
      source.close();
    },
  };
}
