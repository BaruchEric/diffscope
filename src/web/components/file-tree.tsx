// src/web/components/file-tree.tsx
// Pure function of FileStatus[] → collapsible tree.
// Users track which directories they have *manually collapsed*; every other
// ancestor of a changed file stays expanded by default. This avoids the
// "derived-from-props state synced by effect" anti-pattern.
import { useMemo, useState } from "react";
import type { FileStatus } from "@shared/types";

interface TreeNode {
  name: string;
  fullPath: string; // "" for root, "src" / "src/web" for dirs
  isDir: boolean;
  children: TreeNode[];
  file?: FileStatus;
}

function buildTreeUncached(files: FileStatus[]): TreeNode {
  const root: TreeNode = {
    name: "",
    fullPath: "",
    isDir: true,
    children: [],
  };
  for (const f of files) {
    const parts = f.path.split("/");
    let cursor = root;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]!;
      const isLast = i === parts.length - 1;
      const childPath = cursor.fullPath ? `${cursor.fullPath}/${part}` : part;
      let child = cursor.children.find((c) => c.name === part);
      if (!child) {
        child = {
          name: part,
          fullPath: childPath,
          isDir: !isLast,
          children: [],
        };
        cursor.children.push(child);
      }
      if (isLast) child.file = f;
      cursor = child;
    }
  }
  // Sort: directories first, alphabetical within each level.
  const sort = (n: TreeNode): void => {
    n.children.sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    for (const c of n.children) sort(c);
  };
  sort(root);
  return root;
}

// Single-entry cache by reference identity. `status` from the store keeps
// the same array reference across renders when nothing has changed, so this
// cache is warm in the common case (every j/k keypress, every render of the
// file list). Avoids rebuilding the tree on unrelated state changes.
const treeCache = new WeakMap<FileStatus[], TreeNode>();
export function buildTree(files: FileStatus[]): TreeNode {
  const cached = treeCache.get(files);
  if (cached) return cached;
  const tree = buildTreeUncached(files);
  treeCache.set(files, tree);
  return tree;
}

function collectAncestorDirs(files: FileStatus[]): Set<string> {
  const out = new Set<string>();
  for (const f of files) {
    const parts = f.path.split("/");
    for (let i = 1; i < parts.length; i++) {
      out.add(parts.slice(0, i).join("/"));
    }
  }
  return out;
}

function flattenVisible(
  node: TreeNode,
  isExpanded: (dir: string) => boolean,
  depth: number,
  out: { node: TreeNode; depth: number }[],
): void {
  for (const child of node.children) {
    out.push({ node: child, depth });
    if (child.isDir && isExpanded(child.fullPath)) {
      flattenVisible(child, isExpanded, depth + 1, out);
    }
  }
}

export function FileTree({
  files,
  focusedPath,
  onFileClick,
}: {
  files: FileStatus[];
  focusedPath: string | null;
  onFileClick: (path: string) => void;
}) {
  const tree = useMemo(() => buildTree(files), [files]);

  // Track the user's manual collapse/expand deltas instead of the full
  // expanded set. Default behavior = "expand every ancestor of a changed
  // file", which we apply during render — no effect needed.
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  const defaults = useMemo(() => collectAncestorDirs(files), [files]);

  const isExpanded = (dir: string): boolean => {
    if (collapsed.has(dir)) return false;
    if (expanded.has(dir)) return true;
    return defaults.has(dir);
  };

  const visible = useMemo(() => {
    const out: { node: TreeNode; depth: number }[] = [];
    flattenVisible(tree, isExpanded, 0, out);
    return out;
    // isExpanded closes over collapsed/expanded/defaults; those are the real deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tree, collapsed, expanded, defaults]);

  const toggle = (dirPath: string) => {
    const currentlyOpen = isExpanded(dirPath);
    if (currentlyOpen) {
      // collapse: clear explicit-expand, add to collapsed.
      setExpanded((prev) => {
        if (!prev.has(dirPath)) return prev;
        const next = new Set(prev);
        next.delete(dirPath);
        return next;
      });
      setCollapsed((prev) => {
        const next = new Set(prev);
        next.add(dirPath);
        return next;
      });
    } else {
      setCollapsed((prev) => {
        if (!prev.has(dirPath)) return prev;
        const next = new Set(prev);
        next.delete(dirPath);
        return next;
      });
      setExpanded((prev) => {
        const next = new Set(prev);
        next.add(dirPath);
        return next;
      });
    }
  };

  const expandAll = () => {
    const all = collectAllDirs(tree);
    setExpanded(new Set(all));
    setCollapsed(new Set());
  };
  const collapseAll = () => {
    setExpanded(new Set());
    setCollapsed(new Set(collectAllDirs(tree)));
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-1 border-b border-neutral-200 px-2 py-1 text-xs dark:border-neutral-800">
        <button
          className="rounded px-1 hover:bg-neutral-100 dark:hover:bg-neutral-800"
          onClick={expandAll}
          title="Expand all"
        >
          ＋
        </button>
        <button
          className="rounded px-1 hover:bg-neutral-100 dark:hover:bg-neutral-800"
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
                className="flex w-full items-center gap-1 px-2 py-0.5 text-left hover:bg-neutral-100 dark:hover:bg-neutral-800"
                style={{ paddingLeft: 8 + depth * 12 }}
              >
                <span className="w-3 text-neutral-500">
                  {isExpanded(node.fullPath) ? "▾" : "▸"}
                </span>
                <span className="text-neutral-700 dark:text-neutral-300">
                  {node.name}
                </span>
                <span className="ml-1 text-neutral-400">
                  {countChanges(node)}
                </span>
              </button>
            ) : (
              <button
                onClick={() => node.file && onFileClick(node.file.path)}
                className={
                  "flex w-full items-center gap-1 px-2 py-0.5 text-left hover:bg-neutral-100 dark:hover:bg-neutral-800 " +
                  (focusedPath === node.file?.path
                    ? "bg-blue-100 dark:bg-blue-900"
                    : "")
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

function collectAllDirs(node: TreeNode): string[] {
  const out: string[] = [];
  const walk = (n: TreeNode) => {
    if (n.isDir && n.fullPath) out.push(n.fullPath);
    for (const c of n.children) walk(c);
  };
  walk(node);
  return out;
}

function countChanges(node: TreeNode): string {
  let n = 0;
  const walk = (x: TreeNode) => {
    if (x.file) n++;
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
  const tree = buildTree(files);
  const out: { node: TreeNode; depth: number }[] = [];
  flattenVisible(tree, (dir) => expanded.has(dir), 0, out);
  return out.filter((v) => !v.node.isDir).map((v) => v.node.file!.path);
}

/** All directory paths in the tree — reused by shortcuts for j/k nav. */
export function allDirPathsForTree(files: FileStatus[]): Set<string> {
  const tree = buildTree(files);
  return new Set(collectAllDirs(tree));
}
