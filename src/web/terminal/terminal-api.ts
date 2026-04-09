// src/web/terminal/terminal-api.ts
// Fetch wrapper for terminal REST endpoints (currently just scripts).
import type { ScriptsResponse } from "../../shared/terminal-protocol";

export async function fetchScripts(): Promise<ScriptsResponse> {
  const res = await fetch("/api/terminal/scripts");
  if (!res.ok) {
    throw new Error(`/api/terminal/scripts: ${res.status}`);
  }
  return (await res.json()) as ScriptsResponse;
}
