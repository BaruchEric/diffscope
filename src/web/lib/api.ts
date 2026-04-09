import type {
  BlameLine,
  Branch,
  BrowseResult,
  Commit,
  CommitDetail,
  FileStatus,
  ParsedDiff,
  Stash,
} from "@shared/types";
import type { ScriptsResponse } from "../../shared/terminal-protocol";

/** Shared recent-repo shape — the server and web both consume this. */
export interface RecentEntry {
  path: string;
  lastOpenedAt: string;
}

// Wedge-prevention default: if the backend takes longer than this to answer,
// abort so the UI can surface an error instead of spinning forever. Callers
// can pass their own AbortSignal to override (e.g. long-running endpoints).
const DEFAULT_TIMEOUT_MS = 15_000;

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  // If the caller passed their own signal, chain aborts.
  const callerSignal = init?.signal;
  if (callerSignal) {
    if (callerSignal.aborted) controller.abort();
    else callerSignal.addEventListener("abort", () => controller.abort());
  }
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`${res.status} ${url}: ${text}`);
    }
    const ct = res.headers.get("content-type") ?? "";
    if (!ct.includes("application/json")) {
      throw new Error(`${url}: expected JSON, got ${ct || "no content-type"}`);
    }
    return (await res.json()) as T;
  } finally {
    clearTimeout(timeout);
  }
}

export const api = {
  info: () =>
    fetchJson<{ loaded: boolean; root?: string; cwd?: string }>("/api/info"),
  status: () => fetchJson<FileStatus[]>("/api/status"),
  diff: (path: string, staged: boolean) =>
    fetchJson<ParsedDiff | null>(
      `/api/diff?path=${encodeURIComponent(path)}&staged=${staged}`,
    ),
  blame: (path: string) =>
    fetchJson<BlameLine[]>(`/api/blame?path=${encodeURIComponent(path)}`),
  log: (limit = 50, offset = 0) =>
    fetchJson<Commit[]>(`/api/log?limit=${limit}&offset=${offset}`),
  commit: (sha: string) => fetchJson<CommitDetail>(`/api/commit/${sha}`),
  branches: () => fetchJson<Branch[]>("/api/branches"),
  stashes: () => fetchJson<Stash[]>("/api/stashes"),
  browse: (path?: string) =>
    fetchJson<BrowseResult>(`/api/browse${path ? `?path=${encodeURIComponent(path)}` : ""}`),
  recents: () => fetchJson<RecentEntry[]>("/api/recents"),
  removeRecent: (path: string) =>
    fetchJson<RecentEntry[]>(
      `/api/recents?path=${encodeURIComponent(path)}`,
      { method: "DELETE" },
    ),
  open: (path: string) =>
    fetchJson<{ ok: true; root: string }>("/api/open", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path }),
    }),
  terminalScripts: () => fetchJson<ScriptsResponse>("/api/terminal/scripts"),
};
