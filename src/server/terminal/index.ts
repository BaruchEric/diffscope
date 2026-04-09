// src/server/terminal/index.ts
// Factory that bundles the registry, scripts resolver, HTTP handler, and
// WebSocket handler so http.ts can wire the whole subsystem in one import.
import type { WebSocketHandler } from "bun";
import { createPtyRegistry, type PtyRegistry } from "./pty";
import { resolveScripts } from "./scripts";
import { createTerminalWsHandler, type TerminalSocketData } from "./ws";
import type { ScriptsResponse } from "../../shared/terminal-protocol";

export interface TerminalModuleOptions {
  repoRoot: string;
}

export interface TerminalModule {
  registry: PtyRegistry;
  websocket: WebSocketHandler<TerminalSocketData>;
  handleScriptsRequest(): Promise<Response>;
  shutdown(): Promise<void>;
}

export function createTerminalModule(opts: TerminalModuleOptions): TerminalModule {
  const registry = createPtyRegistry();

  const resolveScript = async (name: string) => {
    const entries = await resolveScripts(opts.repoRoot);
    return entries.find((e) => e.name === name);
  };

  const websocket = createTerminalWsHandler({
    registry,
    repoRoot: opts.repoRoot,
    resolveScript,
  });

  const handleScriptsRequest = async (): Promise<Response> => {
    const result = await resolveScripts(opts.repoRoot, { withWarning: true });
    const body: ScriptsResponse = {
      entries: result.entries,
      warning: result.warning,
    };
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  const shutdown = async () => {
    await registry.shutdown();
  };

  return { registry, websocket, handleScriptsRequest, shutdown };
}
