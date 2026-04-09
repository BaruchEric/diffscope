// src/server/events.ts
import type {
  Branch,
  Commit,
  FileStatus,
  ParsedDiff,
  RepoInfo,
  SseEvent,
  Stash,
} from "../shared/types";
import type { Repo } from "./repo";
import { GitError } from "./repo";
import { startWatcher, type WatcherEvent, type WatcherHandle } from "./watcher";

type Subscriber = (event: SseEvent) => void;

export interface EventHub {
  start(): Promise<void>;
  stop(): Promise<void>;
  subscribe(fn: Subscriber): { snapshot: SseEvent; unsubscribe: () => void };
}

export function createEventHub(repo: Repo): EventHub {
  const subscribers = new Set<Subscriber>();
  let statusSnapshot: FileStatus[] = [];
  let branchesSnapshot: Branch[] = [];
  let stashesSnapshot: Stash[] = [];
  let repoInfo: RepoInfo = { root: repo.cwd, headSha: "", currentBranch: null };
  let watcherHandle: WatcherHandle | null = null;

  const emit = (event: SseEvent) => {
    for (const sub of subscribers) sub(event);
  };

  const diffStatuses = (
    prev: FileStatus[],
    next: FileStatus[],
  ): { updated: FileStatus[]; removed: string[] } => {
    const prevByPath = new Map(prev.map((f) => [f.path, f]));
    const updated: FileStatus[] = [];
    const nextPaths = new Set<string>();
    for (const f of next) {
      nextPaths.add(f.path);
      const p = prevByPath.get(f.path);
      if (!p || JSON.stringify(p) !== JSON.stringify(f)) updated.push(f);
    }
    const removed = [...prevByPath.keys()].filter((p) => !nextPaths.has(p));
    return { updated, removed };
  };

  const refreshRepoInfo = async () => {
    try {
      const [latestCommits, branches] = await Promise.all([
        repo.getLog({ limit: 1, offset: 0 }).catch(() => [] as Commit[]),
        repo.getBranches().catch(() => [] as Branch[]),
      ]);
      branchesSnapshot = branches;
      repoInfo = {
        root: repo.cwd,
        headSha: latestCommits[0]?.sha ?? "",
        currentBranch: branches.find((b) => b.isCurrent)?.name ?? null,
      };
    } catch (err) {
      if (err instanceof GitError) emit({ type: "warning", message: err.stderr });
    }
  };

  const refreshStatus = async (opts: { withDiffs?: boolean; pathsToDiff?: string[] } = {}) => {
    try {
      const next = await repo.getStatus();
      const { updated, removed } = diffStatuses(statusSnapshot, next);
      statusSnapshot = next;
      for (const f of updated) {
        let diff: ParsedDiff | undefined;
        if (opts.withDiffs && (!opts.pathsToDiff || opts.pathsToDiff.includes(f.path))) {
          try {
            diff = (await repo.getFileDiff(f.path, { staged: false })) ?? undefined;
          } catch (err) {
            if (err instanceof GitError) emit({ type: "warning", message: err.stderr });
          }
        }
        emit({ type: "file-updated", path: f.path, status: f, diff });
      }
      for (const p of removed) emit({ type: "file-removed", path: p });
    } catch (err) {
      if (err instanceof GitError) {
        if (/not a git repository/i.test(err.stderr)) {
          emit({ type: "repo-error", reason: err.stderr });
        } else {
          emit({ type: "warning", message: err.stderr });
        }
      }
    }
  };

  const handleWatcherEvent = async (event: WatcherEvent) => {
    switch (event.kind) {
      case "working-tree-changed":
      case "gitignore-changed":
      case "index-changed":
        await refreshStatus({ withDiffs: true, pathsToDiff: event.paths });
        break;
      case "head-changed":
        await refreshRepoInfo();
        await refreshStatus({ withDiffs: false });
        emit({
          type: "head-changed",
          headSha: repoInfo.headSha,
          status: statusSnapshot,
          branches: branchesSnapshot,
        });
        break;
      case "refs-changed":
        try {
          branchesSnapshot = await repo.getBranches();
          emit({ type: "refs-changed", branches: branchesSnapshot });
        } catch (err) {
          if (err instanceof GitError) emit({ type: "warning", message: err.stderr });
        }
        break;
      case "stashes-changed":
        try {
          stashesSnapshot = await repo.getStashes();
          emit({ type: "stashes-changed", stashes: stashesSnapshot });
        } catch (err) {
          if (err instanceof GitError) emit({ type: "warning", message: err.stderr });
        }
        break;
    }
  };

  return {
    async start() {
      await refreshRepoInfo();
      statusSnapshot = await repo.getStatus();
      try {
        stashesSnapshot = await repo.getStashes();
      } catch {
        // empty / no stash ref yet — ignore
      }
      // Serialize handler dispatch — concurrent handlers would race on
      // statusSnapshot/branchesSnapshot/etc. and could emit duplicate or
      // out-of-order events. Chaining onto an inflight promise guarantees
      // each event sees the result of the previous one.
      let inflight: Promise<void> = Promise.resolve();
      watcherHandle = await startWatcher(
        repo.cwd,
        (event) => {
          inflight = inflight
            .then(() => handleWatcherEvent(event))
            .catch(() => {});
        },
        (err) => emit({ type: "warning", message: err.message }),
      );
    },
    async stop() {
      await watcherHandle?.stop();
    },
    subscribe(fn) {
      subscribers.add(fn);
      const snapshot: SseEvent = {
        type: "snapshot",
        status: statusSnapshot,
        repo: repoInfo,
      };
      return {
        snapshot,
        unsubscribe: () => {
          subscribers.delete(fn);
        },
      };
    },
  };
}
