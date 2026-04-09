import { create } from "zustand";
import type {
  BlameLine,
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

export interface Toast {
  id: number;
  kind: "warning" | "error";
  message: string;
}

// Monotonic toast id counter — avoids Date.now() collisions when multiple
// toasts land in the same millisecond.
let nextToastId = 1;
function makeToast(kind: Toast["kind"], message: string): Toast {
  return { id: nextToastId++, kind, message };
}

// Cap the toast stack so a chatty watcher-warning storm can't balloon the
// array (and re-spread every subscriber per push). Old toasts age out of
// view; the user can still dismiss the survivors.
const MAX_TOASTS = 10;
function pushToast(toasts: Toast[], next: Toast): Toast[] {
  const trimmed = toasts.length >= MAX_TOASTS ? toasts.slice(-(MAX_TOASTS - 1)) : toasts;
  return [...trimmed, next];
}

interface StoreState {
  repo: RepoInfo | null;
  repoLoaded: boolean;
  paused: boolean;
  status: FileStatus[];
  focusedPath: string | null;
  focusedDiff: ParsedDiff | null;
  /** Monotonic counter — every focusFile call increments this; stale
   *  diff resolves are detected by comparing against the latest value. */
  focusedPathToken: number;
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
  blameOnFor: Set<string>;
  blameCache: Map<string, BlameLine[]>; // key: `${path}@${headSha}`
  blameLoading: Set<string>;
  toggleBlame: (path: string) => void;
  ensureBlameLoaded: (path: string) => Promise<void>;
  sse: SseClient | null;
  paletteOpen: boolean;
  settingsOpen: boolean;
  openPalette: () => void;
  closePalette: () => void;
  openSettings: () => void;
  closeSettings: () => void;

  togglePaused: () => void;
  focusFile: (path: string) => Promise<void>;
  focusCommit: (sha: string) => Promise<void>;
  focusBranch: (name: string) => void;
  focusStash: (index: number) => void;
  loadLog: () => Promise<void>;
  initialize: () => Promise<void>;
  teardown: () => void;
}

export const useStore = create<StoreState>((set, get) => ({
  repo: null,
  repoLoaded: false,
  paused: false,
  status: [],
  focusedPath: null,
  focusedDiff: null,
  focusedPathToken: 0,
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
  blameOnFor: new Set<string>(),
  blameCache: new Map<string, BlameLine[]>(),
  blameLoading: new Set<string>(),
  sse: null,
  paletteOpen: false,
  settingsOpen: false,
  openPalette: () => set({ paletteOpen: true }),
  closePalette: () => set({ paletteOpen: false }),
  openSettings: () => set({ settingsOpen: true }),
  closeSettings: () => set({ settingsOpen: false }),

  togglePaused: () => set((s) => ({ paused: !s.paused })),

  focusFile: async (path) => {
    const token = get().focusedPathToken + 1;
    set({ focusedPath: path, focusedDiff: null, focusedPathToken: token });
    const sticky = useSettings.getState().blameStickyOn;
    if (sticky) {
      const on = new Set(get().blameOnFor);
      if (!on.has(path)) on.add(path);
      set({ blameOnFor: on });
      void get().ensureBlameLoaded(path);
    }
    const entry = get().status.find((f) => f.path === path);
    // Prefer the unstaged diff when the working tree has changes;
    // fall back to the staged diff only when nothing is unstaged.
    const staged = entry != null && entry.staged !== null && entry.unstaged === null;
    const diff = await api.diff(path, staged).catch(() => null);
    // Only commit the fetched diff if no newer focusFile call has started.
    if (get().focusedPathToken === token) set({ focusedDiff: diff });
  },

  toggleBlame: (path) => {
    const s = get();
    const on = new Set(s.blameOnFor);
    const wasOn = on.has(path);
    if (wasOn) on.delete(path);
    else on.add(path);
    set({ blameOnFor: on });
    if (!wasOn) void s.ensureBlameLoaded(path);
  },

  ensureBlameLoaded: async (path) => {
    const s = get();
    const headShaBefore = s.repo?.headSha ?? "";
    const keyBefore = `${path}@${headShaBefore}`;
    if (s.blameCache.has(keyBefore)) return;
    if (s.blameLoading.has(path)) return;
    const loading = new Set(s.blameLoading);
    loading.add(path);
    set({ blameLoading: loading });
    try {
      const lines = await api.blame(path);
      // HEAD may have moved while we were awaiting — drop the result if the
      // sha changed (a head-changed event has already cleared blameCache and
      // we'd just be writing stale data under the old key).
      const headShaAfter = get().repo?.headSha ?? "";
      if (headShaAfter !== headShaBefore) return;
      const keyAfter = `${path}@${headShaAfter}`;
      const cache = new Map(get().blameCache);
      // Re-check that no one else landed first for this same key (parallel
      // loads would otherwise stomp each other's entries).
      if (!cache.has(keyAfter)) cache.set(keyAfter, lines);
      set({ blameCache: cache });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      set({
        toasts: pushToast(get().toasts, makeToast("warning", `Blame failed: ${msg}`)),
      });
      // Turn blame off for this file so we don't spin.
      const on = new Set(get().blameOnFor);
      on.delete(path);
      set({ blameOnFor: on });
    } finally {
      const loading2 = new Set(get().blameLoading);
      loading2.delete(path);
      set({ blameLoading: loading2 });
    }
  },

  focusCommit: async (sha) => {
    set({ focusedCommitSha: sha });
    // Commit detail fetched inside the History tab component on demand
  },

  focusBranch: (name) => set({ focusedBranch: name }),
  focusStash: (index) => set({ focusedStashIndex: index }),

  loadLog: async () => {
    const rows = await api.log(200, 0).catch(() => [] as Commit[]);
    // Skip the set if the result is shape-equal to what we already have —
    // otherwise every log refresh re-renders subscribers on a no-op.
    const prev = get().log;
    if (
      prev.length === rows.length &&
      prev[0]?.sha === rows[0]?.sha &&
      prev[prev.length - 1]?.sha === rows[rows.length - 1]?.sha
    ) {
      return;
    }
    set({ log: rows });
  },

  initialize: async () => {
    // Apply `defaultTab` to the persistent `lastUsedTab` so the app opens
    // on the user's chosen default. Once initialized, everything reads
    // `useSettings(s => s.lastUsedTab)` directly — no parallel store field.
    const s = getSettings();
    if (s.defaultTab !== "last-used" && s.defaultTab !== s.lastUsedTab) {
      useSettings.getState().set({ lastUsedTab: s.defaultTab });
    }
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
      () => set({ watcherDown: false }),
    );
    set({ sse });
  },

  teardown: () => {
    get().sse?.close();
    set({ sse: null });
  },
}));

function fileStatusEqual(a: FileStatus, b: FileStatus): boolean {
  return (
    a.path === b.path &&
    a.oldPath === b.oldPath &&
    a.staged === b.staged &&
    a.unstaged === b.unstaged &&
    a.isUntracked === b.isUntracked &&
    a.isImage === b.isImage &&
    a.isBinary === b.isBinary &&
    a.added === b.added &&
    a.deleted === b.deleted
  );
}

function handleEvent(
  event: SseEvent,
  set: (partial: Partial<StoreState>) => void,
  get: () => StoreState,
): void {
  // Pause freezes *live file churn* only — HEAD/refs/stashes updates, errors,
  // and watcher status must still flow through so the user doesn't resume
  // onto a silently desynced UI.
  if (
    get().paused &&
    (event.type === "file-updated" ||
      event.type === "file-removed" ||
      event.type === "snapshot")
  ) {
    return;
  }
  switch (event.type) {
    case "snapshot": {
      set({
        status: event.status,
        repo: event.repo,
        branches: event.branches,
        stashes: event.stashes,
      });
      // If the focused file vanished from the new snapshot, drop the focus
      // so the user doesn't stare at a stale diff for a path that no longer
      // exists after an external checkout/reset.
      const focused = get().focusedPath;
      if (focused && !event.status.some((f) => f.path === focused)) {
        set({ focusedPath: null, focusedDiff: null });
      }
      break;
    }
    case "file-updated": {
      const existing = get().status;
      const idx = existing.findIndex((f) => f.path === event.path);
      // Skip rebuilding `status` if the entry is shape-equal to the one
      // we already hold. The server already filters duplicates, but its
      // snapshot can lag behind ours after rapid resubscribes — this
      // keeps every status subscriber from re-rendering on a no-op.
      const same = idx >= 0 && fileStatusEqual(existing[idx]!, event.status);
      if (!same) {
        const next = [...existing];
        if (idx >= 0) next[idx] = event.status;
        else next.push(event.status);
        set({ status: next });
      }
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
      // Drop the blame cache (keyed by HEAD sha) but keep the user's blame
      // toggles — otherwise committing on one file turns off blame for
      // every other file the user had opened it on.
      set({
        status: event.status,
        branches: event.branches,
        blameCache: new Map(),
        repo: get().repo ? { ...get().repo!, headSha: event.headSha } : get().repo,
      });
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
        toasts: pushToast(get().toasts, makeToast("error", event.reason)),
      });
      break;
    case "warning":
      set({
        toasts: pushToast(get().toasts, makeToast("warning", event.message)),
      });
      break;
  }
}
