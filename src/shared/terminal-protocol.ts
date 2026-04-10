// src/shared/terminal-protocol.ts
// Wire protocol for the terminal WebSocket at /api/terminal/ws.
// Both sides import from this file so frame shapes can't drift.

/** A single predefined script surfaced in the + dropdown. */
export interface ScriptEntry {
  name: string;
  command: string;
  group: "package" | "builtin" | "user";
  cwd?: string;
}

export interface ScriptsResponse {
  entries: ScriptEntry[];
  /** Non-fatal parse warning surfaced at the top of the dropdown. */
  warning?: string;
}

/** Client → server frames. */
export type TerminalClientFrame =
  | { op: "attach"; ids: string[] }
  | {
      op: "spawn";
      /** Client-allocated id so the client can pre-create the pane UI. */
      id: string;
      kind: "shell" | "script";
      scriptName?: string;
      cols: number;
      rows: number;
      /** Title shown in the tab strip; falls back to the resolved command. */
      title?: string;
    }
  | { op: "data"; id: string; b64: string }
  | { op: "resize"; id: string; cols: number; rows: number }
  | { op: "kill"; id: string }
  | { op: "close"; id: string };

/** Server → client frames. */
export type TerminalServerFrame =
  | { op: "spawned"; id: string; title: string }
  | { op: "replay"; id: string; b64: string }
  | { op: "data"; id: string; b64: string }
  | { op: "exit"; id: string; code: number | null }
  | { op: "gone"; id: string }
  | { op: "error"; id?: string; message: string };
