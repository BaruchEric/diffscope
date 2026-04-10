// src/web/components/file-tree.tsx
// Pure function of FileStatus[] → collapsible tree.
// Users track which directories they have *manually collapsed*; every other
// ancestor of a changed file stays expanded by default. This avoids the
// "derived-from-props state synced by effect" anti-pattern.
import { useMemo, useState } from "react";
import type { FileStatus } from "@shared/types";
import {
  buildTreeFromPaths,
  collectAllDirs,
  collectAncestorDirs,
  flattenVisible,
  type TreeNode,
} from "../lib/tree";

export function FileTree({
  files,
  focusedPath,
  onFileClick,
}: {
  files: FileStatus[];
  focusedPath: string | null;
  onFileClick: (path: string) => void;
}) {
  const tree = useMemo(() => buildTreeFromPaths(files), [files]);

  // Track the user's manual expand/collapse deltas as a single map — the
  // value is the override (true = force-expanded, false = force-collapsed);
  // missing keys fall through to the default "expand ancestors of changed
  // files" rule. One map, one setState per toggle, no mutually-exclusive
  // bookkeeping.
  const [override, setOverride] = useState<Map<string, boolean>>(() => new Map());

  const defaults = useMemo(
    () => collectAncestorDirs(files.map((f) => f.path)),
    [files],
  );

  const isExpanded = (dir: string): boolean => {
    const forced = override.get(dir);
    if (forced !== undefined) return forced;
    return defaults.has(dir);
  };

  const visible = useMemo(
    () => flattenVisible(tree, isExpanded),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- isExpanded reads override + defaults
    [tree, override, defaults],
  );

  const toggle = (dirPath: string) => {
    setOverride((prev) => {
      const next = new Map(prev);
      next.set(dirPath, !isExpanded(dirPath));
      return next;
    });
  };

  const expandAll = () => {
    const all = collectAllDirs(tree);
    setOverride(new Map(all.map((d) => [d, true])));
  };
  const collapseAll = () => {
    const all = collectAllDirs(tree);
    setOverride(new Map(all.map((d) => [d, false])));
  };

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
                <span className="text-fg">
                  {node.name}
                </span>
                <span className="ml-1 text-fg-subtle">
                  {countChanges(node)}
                </span>
              </button>
            ) : (
              <button
                onClick={() => node.data && onFileClick(node.data.path)}
                className={
                  "flex w-full items-center gap-1 px-2 py-0.5 text-left border-l-2 " +
                  (focusedPath === node.data?.path
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

function countChanges(node: TreeNode<FileStatus>): string {
  let n = 0;
  const walk = (x: TreeNode<FileStatus>) => {
    if (x.data) n++;
    for (const c of x.children) walk(c);
  };
  walk(node);
  return n > 0 ? `(${n})` : "";
}

/**
 * Visible file paths for j/k sibling navigation. Uses the cached tree so
 * repeated keypresses over the same `files` array don't rebuild it.
 * `expanded` is "everything expanded" when called from shortcuts so every
 * file is reachable — that path is the hot one.
 */
export function visibleFilePathsForTree(
  files: FileStatus[],
  expanded: Set<string>,
): string[] {
  const tree = buildTreeFromPaths(files);
  const flat = flattenVisible(tree, (dir) => expanded.has(dir));
  return flat.filter((v) => !v.node.isDir).map((v) => v.node.data!.path);
}

/** All directory paths in the tree — reused by shortcuts for j/k nav. */
export function allDirPathsForTree(files: FileStatus[]): Set<string> {
  const tree = buildTreeFromPaths(files);
  return new Set(collectAllDirs(tree));
}
