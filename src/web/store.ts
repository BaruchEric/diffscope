import { create } from "zustand";
import type {
  Branch,
  Commit,
  FileStatus,
  ParsedDiff,
  RepoInfo,
  SseEvent,
  Stash,
} from "@shared/types";
import { api } from "./lib/api";
import { openSseStream, type SseClient } from "./lib/sse-client";
import { useSettings, getSettings } from "./settings";

export type Tab = "working-tree" | "history" | "branches" | "stashes";
export type DiffMode = "unified" | "split";

export interface Toast {
  id: number;
  kind: "warning" | "error";
  message: string;
}

interface StoreState {
  repo: RepoInfo | null;
  repoLoaded: boolean;
  tab: Tab;
  diffMode: DiffMode;
  paused: boolean;
  status: FileStatus[];
  focusedPath: string | null;
  focusedDiff: ParsedDiff | null;
  log: Commit[];
  focusedCommitSha: string | null;
  branches: Branch[];
  focusedBranch: string | null;
  stashes: Stash[];
  focusedStashIndex: number | null;
  watcherDown: boolean;
  error: string | null;
  toasts: Toast[];
  dismissToast: (id: number) => void;
  sse: SseClient | null;

  setTab: (tab: Tab) => void;
  setDiffMode: (mode: DiffMode) => void;
  togglePaused: () => void;
  focusFile: (path: string) => Promise<void>;
  focusCommit: (sha: string) => Promise<void>;
  focusBranch: (name: string) => void;
  focusStash: (index: number) => void;
  initialize: () => Promise<void>;
  teardown: () => void;
}

export const useStore = create<StoreState>((set, get) => ({
  repo: null,
  repoLoaded: false,
  tab: "working-tree",
  diffMode: "unified",
  paused: false,
  status: [],
  focusedPath: null,
  focusedDiff: null,
  log: [],
  focusedCommitSha: null,
  branches: [],
  focusedBranch: null,
  stashes: [],
  focusedStashIndex: null,
  watcherDown: false,
  error: null,
  toasts: [],
  dismissToast: (id) =>
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  sse: null,

  setTab: (tab) => {
    useSettings.getState().set({ lastUsedTab: tab });
    set({ tab });
  },
  setDiffMode: (mode) => {
    useSettings.getState().set({ diffMode: mode });
    set({ diffMode: mode });
  },
  togglePaused: () => set((s) => ({ paused: !s.paused })),

  focusFile: async (path) => {
    set({ focusedPath: path, focusedDiff: null });
    const entry = get().status.find((f) => f.path === path);
    const staged = entry?.staged !== null && entry?.unstaged === null;
    const diff = await api.diff(path, staged).catch(() => null);
    if (get().focusedPath === path) set({ focusedDiff: diff });
  },

  focusCommit: async (sha) => {
    set({ focusedCommitSha: sha });
    // Commit detail fetched inside the History tab component on demand
  },

  focusBranch: (name) => set({ focusedBranch: name }),
  focusStash: (index) => set({ focusedStashIndex: index }),

  initialize: async () => {
    const s = getSettings();
    const initialTab: Tab =
      s.defaultTab === "last-used" ? s.lastUsedTab : s.defaultTab;
    set({ tab: initialTab, diffMode: s.diffMode });
    const info = await api
      .info()
      .catch(() => ({ loaded: false }) as { loaded: boolean; root?: string });
    if (!info.loaded) {
      set({ repoLoaded: false });
      return;
    }
    const [status, branches, stashes] = await Promise.all([
      api.status(),
      api.branches().catch(() => []),
      api.stashes().catch(() => []),
    ]);
    set({
      repoLoaded: true,
      status,
      branches,
      stashes,
      repo: {
        root: info.root ?? "",
        headSha: "",
        currentBranch: branches.find((b) => b.isCurrent)?.name ?? null,
      },
    });
    const sse = openSseStream(
      (event) => handleEvent(event, set, get),
      () => set({ watcherDown: true }),
    );
    set({ sse });
  },

  teardown: () => {
    get().sse?.close();
    set({ sse: null });
  },
}));

function handleEvent(
  event: SseEvent,
  set: (partial: Partial<StoreState>) => void,
  get: () => StoreState,
): void {
  if (get().paused) return;
  switch (event.type) {
    case "snapshot":
      set({ status: event.status, repo: event.repo });
      break;
    case "file-updated": {
      const existing = get().status;
      const idx = existing.findIndex((f) => f.path === event.path);
      const next = [...existing];
      if (idx >= 0) next[idx] = event.status;
      else next.push(event.status);
      set({ status: next });
      if (get().focusedPath === event.path && event.diff) {
        set({ focusedDiff: event.diff });
      }
      break;
    }
    case "file-removed": {
      set({ status: get().status.filter((f) => f.path !== event.path) });
      if (get().focusedPath === event.path) {
        set({ focusedPath: null, focusedDiff: null });
      }
      break;
    }
    case "head-changed":
      set({ status: event.status, branches: event.branches });
      break;
    case "refs-changed":
      set({ branches: event.branches });
      break;
    case "stashes-changed":
      set({ stashes: event.stashes });
      break;
    case "watcher-down":
      set({ watcherDown: true });
      break;
    case "watcher-up":
      set({ watcherDown: false });
      break;
    case "repo-error":
      set({
        error: event.reason,
        toasts: [
          ...get().toasts,
          { id: Date.now(), kind: "error", message: event.reason },
        ],
      });
      break;
    case "warning":
      set({
        toasts: [
          ...get().toasts,
          { id: Date.now() + Math.random(), kind: "warning", message: event.message },
        ],
      });
      break;
  }
}
