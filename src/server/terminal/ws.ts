// src/server/terminal/ws.ts
// Bun ServerWebSocket handler for the terminal channel.
// One connection multiplexes many terminal ids; frames are JSON
// TerminalClientFrame / TerminalServerFrame.
import type { ServerWebSocket, WebSocketHandler } from "bun";
import type {
  TerminalClientFrame,
  TerminalServerFrame,
  ScriptEntry,
} from "../../shared/terminal-protocol";
import type { PtyRegistry } from "./pty";

export interface WsDeps {
  registry: PtyRegistry;
  repoRoot: string;
  resolveScript: (name: string) => Promise<ScriptEntry | undefined>;
}

export interface TerminalSocketData {
  /** termId → unsubscribe function for PTY data fan-out. */
  subscriptions: Map<string, () => void>;
}

function send(
  ws: ServerWebSocket<TerminalSocketData>,
  frame: TerminalServerFrame,
): void {
  ws.send(JSON.stringify(frame));
}

function toB64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

function fromB64(b64: string): Uint8Array {
  return new Uint8Array(Buffer.from(b64, "base64"));
}

function attachSubscribers(
  ws: ServerWebSocket<TerminalSocketData>,
  registry: PtyRegistry,
  id: string,
): void {
  if (ws.data.subscriptions.has(id)) return;
  const unsubData = registry.subscribe(id, (bytes) => {
    send(ws, { op: "data", id, b64: toB64(bytes) });
  });
  const unsubExit = registry.onExit(id, (code) => {
    send(ws, { op: "exit", id, code });
  });
  ws.data.subscriptions.set(id, () => {
    unsubData();
    unsubExit();
  });
}

function detachSubscribers(
  ws: ServerWebSocket<TerminalSocketData>,
  id: string,
): void {
  const unsub = ws.data.subscriptions.get(id);
  if (unsub) {
    unsub();
    ws.data.subscriptions.delete(id);
  }
}

export function createTerminalWsHandler(
  deps: WsDeps,
): WebSocketHandler<TerminalSocketData> {
  return {
    open(ws) {
      ws.data = { subscriptions: new Map() };
    },

    async message(ws, raw) {
      let frame: TerminalClientFrame;
      try {
        frame = JSON.parse(String(raw)) as TerminalClientFrame;
      } catch {
        send(ws, { op: "error", message: "malformed frame" });
        return;
      }

      switch (frame.op) {
        case "attach": {
          for (const id of frame.ids) {
            const session = deps.registry.get(id);
            if (!session) {
              send(ws, { op: "gone", id });
              continue;
            }
            const scrollback = deps.registry.readScrollback(id);
            send(ws, { op: "replay", id, b64: toB64(scrollback) });
            attachSubscribers(ws, deps.registry, id);
            if (session.exitCode !== null) {
              send(ws, { op: "exit", id, code: session.exitCode });
            }
          }
          return;
        }

        case "spawn": {
          let command: string;
          let args: string[];
          let title = frame.title ?? "terminal";
          let scriptName: string | undefined;

          if (frame.kind === "shell") {
            command = process.env.SHELL || "/bin/zsh";
            args = ["-l"];
            title = frame.title ?? command.split("/").pop() ?? "shell";
          } else {
            if (!frame.scriptName) {
              send(ws, {
                op: "error",
                id: frame.id,
                message: "scriptName required",
              });
              return;
            }
            const entry = await deps.resolveScript(frame.scriptName);
            if (!entry) {
              send(ws, {
                op: "error",
                id: frame.id,
                message: `unknown script: ${frame.scriptName}`,
              });
              return;
            }
            // Route through the user's shell so shell features (pipes,
            // env expansion, &&) work without quoting gymnastics.
            command = process.env.SHELL || "/bin/zsh";
            args = ["-l", "-c", entry.command];
            title = frame.title ?? entry.name;
            scriptName = entry.name;
          }

          try {
            const session = deps.registry.spawn({
              id: frame.id,
              command,
              args,
              cwd: deps.repoRoot,
              cols: frame.cols,
              rows: frame.rows,
              title,
              scriptName,
            });
            attachSubscribers(ws, deps.registry, session.id);
            send(ws, { op: "spawned", id: session.id, title: session.title });
          } catch (err) {
            send(ws, {
              op: "error",
              id: frame.id,
              message: err instanceof Error ? err.message : String(err),
            });
          }
          return;
        }

        case "data": {
          deps.registry.write(frame.id, fromB64(frame.b64));
          return;
        }

        case "resize": {
          deps.registry.resize(frame.id, frame.cols, frame.rows);
          return;
        }

        case "kill": {
          deps.registry.kill(frame.id);
          return;
        }

        case "close": {
          detachSubscribers(ws, frame.id);
          deps.registry.close(frame.id);
          return;
        }
      }
    },

    close(ws) {
      for (const unsub of ws.data.subscriptions.values()) unsub();
      ws.data.subscriptions.clear();
    },
  };
}
