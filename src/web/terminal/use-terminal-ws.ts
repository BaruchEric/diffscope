// src/web/terminal/use-terminal-ws.ts
// Singleton WebSocket client for /api/terminal/ws. The socket and
// subscriber registry live at module scope so every terminal pane shares
// one connection; the protocol multiplexes by termId.
import { useEffect, useState } from "react";
import type {
  TerminalClientFrame,
  TerminalServerFrame,
} from "../../shared/terminal-protocol";

type PerIdHandler = (frame: TerminalServerFrame) => void;

let socket: WebSocket | null = null;
let connecting = false;
const handlersById = new Map<string, Set<PerIdHandler>>();
// Frames that arrived before a subscriber registered for their id. Small
// buffer so the replay-on-attach flow doesn't lose data if a pane mounts a
// microtask after `attach` fires.
const pendingById = new Map<string, TerminalServerFrame[]>();
const MAX_PENDING_PER_ID = 64;
const openWaiters: (() => void)[] = [];
let reconnectDelay = 250;
const RECONNECT_MAX = 4000;

function wsUrl(): string {
  const loc = window.location;
  const protocol = loc.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${loc.host}/api/terminal/ws`;
}

function flushPending(id: string, handler: PerIdHandler): void {
  const queue = pendingById.get(id);
  if (!queue) return;
  for (const f of queue) handler(f);
  pendingById.delete(id);
}

function onMessage(evt: MessageEvent): void {
  let frame: TerminalServerFrame;
  try {
    frame = JSON.parse(String(evt.data)) as TerminalServerFrame;
  } catch {
    return;
  }
  const id = "id" in frame && typeof frame.id === "string" ? frame.id : undefined;
  if (!id) return;
  const set = handlersById.get(id);
  if (set && set.size > 0) {
    for (const h of set) h(frame);
    return;
  }
  const queue = pendingById.get(id) ?? [];
  if (queue.length < MAX_PENDING_PER_ID) {
    queue.push(frame);
    pendingById.set(id, queue);
  }
}

function open(): Promise<void> {
  if (socket && socket.readyState === WebSocket.OPEN) return Promise.resolve();
  if (connecting) {
    return new Promise((resolve) => openWaiters.push(resolve));
  }
  connecting = true;
  return new Promise((resolve) => {
    const ws = new WebSocket(wsUrl());
    socket = ws;
    ws.onopen = () => {
      connecting = false;
      reconnectDelay = 250;
      resolve();
      while (openWaiters.length > 0) openWaiters.shift()!();
    };
    ws.onmessage = onMessage;
    ws.onclose = () => {
      connecting = false;
      socket = null;
      setTimeout(() => {
        if (handlersById.size > 0 || pendingById.size > 0) void open();
      }, reconnectDelay);
      reconnectDelay = Math.min(reconnectDelay * 2, RECONNECT_MAX);
    };
    ws.onerror = () => {
      // onclose will handle the retry.
    };
  });
}

export function sendFrame(frame: TerminalClientFrame): void {
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(frame));
  } else {
    void open().then(() => socket?.send(JSON.stringify(frame)));
  }
}

export function subscribe(id: string, handler: PerIdHandler): () => void {
  let set = handlersById.get(id);
  if (!set) {
    set = new Set();
    handlersById.set(id, set);
  }
  set.add(handler);
  flushPending(id, handler);
  return () => {
    const current = handlersById.get(id);
    if (!current) return;
    current.delete(handler);
    if (current.size === 0) handlersById.delete(id);
  };
}

/**
 * Open the socket (if not already open) and send `attach` for the given
 * ids. Idempotent.
 */
export function attachIds(ids: string[]): void {
  if (ids.length === 0) {
    void open();
    return;
  }
  void open().then(() => {
    sendFrame({ op: "attach", ids });
  });
}

/**
 * React hook exposing connection readiness. Components that only need to
 * send/subscribe can import the module functions directly; this hook is
 * for re-rendering on connection state.
 */
export function useTerminalWs(): { ready: boolean } {
  const [ready, setReady] = useState(
    socket !== null && socket.readyState === WebSocket.OPEN,
  );
  useEffect(() => {
    let cancelled = false;
    void open().then(() => {
      if (!cancelled) setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return { ready };
}
