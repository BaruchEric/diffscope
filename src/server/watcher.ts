// src/server/watcher.ts
import watcher from "@parcel/watcher";

export type WatcherEventKind =
  | "working-tree-changed"
  | "index-changed"
  | "head-changed"
  | "refs-changed"
  | "stashes-changed"
  | "gitignore-changed";

export interface WatcherEvent {
  kind: WatcherEventKind;
  paths: string[];
}

export type WatcherListener = (event: WatcherEvent) => void;

export interface WatcherHandle {
  stop(): Promise<void>;
}

interface PendingBatch {
  workingTree: Set<string>;
  index: boolean;
  head: boolean;
  refs: boolean;
  stashes: boolean;
  gitignore: boolean;
  timer: ReturnType<typeof setTimeout> | null;
}

function newBatch(): PendingBatch {
  return {
    workingTree: new Set(),
    index: false,
    head: false,
    refs: false,
    stashes: false,
    gitignore: false,
    timer: null,
  };
}

const DEBOUNCE_MS = 50;

export async function startWatcher(
  repoRoot: string,
  listener: WatcherListener,
  onError?: (err: Error) => void,
): Promise<WatcherHandle> {
  let batch = newBatch();

  const flush = () => {
    const current = batch;
    batch = newBatch();
    if (current.workingTree.size > 0) {
      listener({ kind: "working-tree-changed", paths: Array.from(current.workingTree) });
    }
    if (current.gitignore) listener({ kind: "gitignore-changed", paths: [] });
    if (current.index) listener({ kind: "index-changed", paths: [] });
    if (current.head) listener({ kind: "head-changed", paths: [] });
    if (current.refs) listener({ kind: "refs-changed", paths: [] });
    if (current.stashes) listener({ kind: "stashes-changed", paths: [] });
  };

  const schedule = () => {
    if (batch.timer) return;
    batch.timer = setTimeout(flush, DEBOUNCE_MS);
  };

  const HEAD_REFS = new Set(["HEAD", "ORIG_HEAD", "FETCH_HEAD", "MERGE_HEAD"]);
  const GIT_DIR = ".git";
  const GIT_PREFIX = ".git/";

  const classify = (path: string, relativeTo: string): void => {
    const rel = path.startsWith(relativeTo) ? path.slice(relativeTo.length + 1) : path;
    if (rel === GIT_DIR) return;
    if (rel.startsWith(GIT_PREFIX)) {
      const gitRel = rel.slice(GIT_PREFIX.length);
      if (HEAD_REFS.has(gitRel)) batch.head = true;
      if (gitRel.startsWith("refs/")) batch.refs = true;
      if (gitRel === "index") batch.index = true;
      if (gitRel === "refs/stash" || gitRel.startsWith("logs/refs/stash")) batch.stashes = true;
      return;
    }
    batch.workingTree.add(rel);
    if (rel === ".gitignore" || rel.endsWith("/.gitignore")) batch.gitignore = true;
  };

  try {
    const workingTreeSub = await watcher.subscribe(
      repoRoot,
      (err, events) => {
        if (err) {
          onError?.(err instanceof Error ? err : new Error(String(err)));
          return;
        }
        for (const e of events) classify(e.path, repoRoot);
        schedule();
      },
      {
        // Exclude common build/cache dirs that would otherwise flood the
        // watcher — a Rust project's `target/` or a Python `.venv/` emits
        // thousands of events per build and drowns out real edits. Keep
        // this list deliberately narrow; noisy repos can still drop entries
        // into their own `.gitignore`, which only helps `git status` and
        // not the watcher.
        ignore: [
          "node_modules",
          "dist",
          "build",
          "target",
          ".next",
          ".nuxt",
          ".cache",
          ".venv",
          "venv",
          "__pycache__",
          ".DS_Store",
        ],
      },
    );

    return {
      async stop() {
        if (batch.timer) clearTimeout(batch.timer);
        await workingTreeSub.unsubscribe();
      },
    };
  } catch (err) {
    onError?.(err instanceof Error ? err : new Error(String(err)));
    throw err;
  }
}
