// src/web/components/file-tree.tsx
// Pure function of FileStatus[] → collapsible tree.
// Collapse state is component-local (resets on reload per design).
// On first render and whenever the input file set changes, every
// ancestor directory of a changed file is expanded.
import { useEffect, useMemo, useState } from "react";
import type { FileStatus } from "@shared/types";

interface TreeNode {
  name: string;
  fullPath: string; // "" for root, "src" / "src/web" for dirs
  isDir: boolean;
  children: TreeNode[];
  file?: FileStatus;
}

function buildTree(files: FileStatus[]): TreeNode {
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
  expanded: Set<string>,
  depth: number,
  out: { node: TreeNode; depth: number }[],
): void {
  for (const child of node.children) {
    out.push({ node: child, depth });
    if (child.isDir && expanded.has(child.fullPath)) {
      flattenVisible(child, expanded, depth + 1, out);
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
  const [expanded, setExpanded] = useState<Set<string>>(
    () => collectAncestorDirs(files),
  );

  // When the set of files changes (new/removed from status), auto-expand
  // ancestors of any currently-changed file.
  useEffect(() => {
    setExpanded((prev) => {
      const next = new Set(prev);
      for (const dir of collectAncestorDirs(files)) next.add(dir);
      return next;
    });
  }, [files]);

  const visible = useMemo(() => {
    const out: { node: TreeNode; depth: number }[] = [];
    flattenVisible(tree, expanded, 0, out);
    return out;
  }, [tree, expanded]);

  const toggle = (dirPath: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(dirPath)) next.delete(dirPath);
      else next.add(dirPath);
      return next;
    });

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-1 border-b border-neutral-200 px-2 py-1 text-xs dark:border-neutral-800">
        <button
          className="rounded px-1 hover:bg-neutral-100 dark:hover:bg-neutral-800"
          onClick={() => setExpanded(new Set(collectAllDirs(tree)))}
          title="Expand all"
        >
          ＋
        </button>
        <button
          className="rounded px-1 hover:bg-neutral-100 dark:hover:bg-neutral-800"
          onClick={() => setExpanded(new Set())}
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
                  {expanded.has(node.fullPath) ? "▾" : "▸"}
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

// Export for j/k navigation: returns the visible file paths in order,
// matching what the user sees when the tree is rendered with the given
// expanded set. Used by shortcuts.tsx via a re-derivation helper on store.
export function visibleFilePathsForTree(
  files: FileStatus[],
  expanded: Set<string>,
): string[] {
  const tree = buildTree(files);
  const out: { node: TreeNode; depth: number }[] = [];
  flattenVisible(tree, expanded, 0, out);
  return out.filter((v) => !v.node.isDir).map((v) => v.node.file!.path);
}
