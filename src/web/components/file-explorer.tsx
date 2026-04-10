// src/web/components/file-explorer.tsx
// Full working-directory tree view. Structurally mirrors FileTree but
// without change-count badges — every entry is a file or directory
// straight from listTree.
import { useMemo, useState } from "react";
import type { FsEntry } from "@shared/types";
import {
  buildTreeFromPaths,
  collectAllDirs,
  flattenVisible,
} from "../lib/tree";

export function FileExplorer({
  entries,
  focusedPath,
  onFileClick,
}: {
  entries: FsEntry[];
  focusedPath: string | null;
  onFileClick: (path: string) => void;
}) {
  const tree = useMemo(() => buildTreeFromPaths(entries), [entries]);

  // Start fully collapsed — Explore has no "interesting" signal like
  // "expand ancestors of changed files". The user clicks to expand.
  const [override, setOverride] = useState<Map<string, boolean>>(() => new Map());

  const visible = useMemo(() => {
    const isExpanded = (dir: string): boolean => override.get(dir) === true;
    return flattenVisible(tree, isExpanded);
  }, [tree, override]);

  const isExpanded = (dir: string): boolean => override.get(dir) === true;

  const toggle = (dirPath: string) => {
    setOverride((prev) => {
      const next = new Map(prev);
      next.set(dirPath, prev.get(dirPath) !== true);
      return next;
    });
  };

  const expandAll = () => {
    const all = collectAllDirs(tree);
    setOverride(new Map(all.map((d) => [d, true])));
  };
  const collapseAll = () => setOverride(new Map());

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-1 border-b border-border px-2 py-1 text-xs">
        <button
          className="rounded px-1 text-fg-muted hover:bg-surface-hover hover:text-fg"
          onClick={expandAll}
          title="Expand all"
        >
          ＋
        </button>
        <button
          className="rounded px-1 text-fg-muted hover:bg-surface-hover hover:text-fg"
          onClick={collapseAll}
          title="Collapse all"
        >
          −
        </button>
      </div>
      <ul className="flex-1 overflow-auto font-mono text-xs">
        {visible.map(({ node, depth }) => (
          <li key={node.fullPath}>
            {node.isDir ? (
              <button
                onClick={() => toggle(node.fullPath)}
                className="flex w-full items-center gap-1 px-2 py-0.5 text-left text-fg-muted hover:bg-surface-hover hover:text-fg"
                style={{ paddingLeft: 8 + depth * 12 }}
              >
                <span className="w-3 text-fg-subtle">
                  {isExpanded(node.fullPath) ? "▾" : "▸"}
                </span>
                <span className="text-fg">{node.name}</span>
              </button>
            ) : (
              <button
                onClick={() => onFileClick(node.fullPath)}
                className={
                  "flex w-full items-center gap-1 px-2 py-0.5 text-left border-l-2 " +
                  (focusedPath === node.fullPath
                    ? "bg-surface-hover text-fg border-accent"
                    : "text-fg-muted hover:bg-surface-hover hover:text-fg border-transparent")
                }
                style={{ paddingLeft: 8 + (depth + 1) * 12 }}
              >
                <span className="truncate">{node.name}</span>
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Visible file paths — used by shortcuts for j/k in Explore mode. */
export function visibleExploreFilePaths(
  entries: FsEntry[],
  expanded: Set<string>,
): string[] {
  const tree = buildTreeFromPaths(entries);
  const flat = flattenVisible(tree, (dir) => expanded.has(dir));
  return flat
    .filter((v) => !v.node.isDir)
    .map((v) => v.node.data?.path ?? v.node.fullPath);
}

/** All directory paths in the Explore tree — used by shortcuts for j/k. */
export function allExploreDirPaths(entries: FsEntry[]): Set<string> {
  const tree = buildTreeFromPaths(entries);
  return new Set(collectAllDirs(tree));
}
