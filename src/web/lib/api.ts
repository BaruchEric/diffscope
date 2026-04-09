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

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status} ${url}: ${text}`);
  }
  return (await res.json()) as T;
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
  recents: () => fetchJson<{ path: string; lastOpenedAt: string }[]>("/api/recents"),
  removeRecent: (path: string) =>
    fetchJson<{ path: string; lastOpenedAt: string }[]>(
      `/api/recents?path=${encodeURIComponent(path)}`,
      { method: "DELETE" },
    ),
  open: (path: string) =>
    fetchJson<{ ok: true; root: string }>("/api/open", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path }),
    }),
};
