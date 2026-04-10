// src/web/lib/tree.ts
// Shared tree primitives — generic over the item type so both the Changes
// view (FileStatus) and the Explore view (FsEntry) can reuse one builder.

export interface TreeNode<T> {
  name: string;
  /** "" for root, "src" / "src/web" for nested directories. */
  fullPath: string;
  isDir: boolean;
  children: TreeNode<T>[];
  data?: T;
}

function buildTreeUncached<T extends { path: string }>(items: T[]): TreeNode<T> {
  const root: TreeNode<T> = {
    name: "",
    fullPath: "",
    isDir: true,
    children: [],
  };
  const childMaps = new Map<TreeNode<T>, Map<string, TreeNode<T>>>();
  childMaps.set(root, new Map());
  for (const item of items) {
    const parts = item.path.split("/");
    let cursor = root;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]!;
      const isLast = i === parts.length - 1;
      const childPath = cursor.fullPath ? `${cursor.fullPath}/${part}` : part;
      const childMap = childMaps.get(cursor)!;
      let child = childMap.get(part);
      if (!child) {
        child = {
          name: part,
          fullPath: childPath,
          isDir: !isLast,
          children: [],
        };
        cursor.children.push(child);
        childMap.set(part, child);
        childMaps.set(child, new Map());
      } else if (!isLast) {
        // Upgrade to directory if this segment is used as a parent of
        // deeper paths. Handles the case where listTree emits a bare
        // directory entry (e.g., { path: "src" }) before the files
        // inside it — the first visit creates the node as a leaf, but
        // subsequent visits through it as a prefix prove it's a dir.
        child.isDir = true;
      }
      if (isLast) child.data = item;
      cursor = child;
    }
  }
  const sort = (n: TreeNode<T>): void => {
    n.children.sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    for (const c of n.children) sort(c);
  };
  sort(root);
  return root;
}

const treeCache = new WeakMap<object, TreeNode<unknown>>();
export function buildTreeFromPaths<T extends { path: string }>(items: T[]): TreeNode<T> {
  const cached = treeCache.get(items);
  if (cached) return cached as TreeNode<T>;
  const tree = buildTreeUncached(items);
  treeCache.set(items, tree as TreeNode<unknown>);
  return tree;
}

export function collectAncestorDirs(paths: string[]): Set<string> {
  const out = new Set<string>();
  for (const p of paths) {
    const parts = p.split("/");
    for (let i = 1; i < parts.length; i++) {
      out.add(parts.slice(0, i).join("/"));
    }
  }
  return out;
}

export function collectAllDirs<T>(node: TreeNode<T>): string[] {
  const out: string[] = [];
  const walk = (n: TreeNode<T>) => {
    if (n.isDir && n.fullPath) out.push(n.fullPath);
    for (const c of n.children) walk(c);
  };
  walk(node);
  return out;
}

export function flattenVisible<T>(
  node: TreeNode<T>,
  isExpanded: (dir: string) => boolean,
): Array<{ node: TreeNode<T>; depth: number }> {
  const out: Array<{ node: TreeNode<T>; depth: number }> = [];
  const walk = (n: TreeNode<T>, depth: number): void => {
    for (const child of n.children) {
      out.push({ node: child, depth });
      if (child.isDir && isExpanded(child.fullPath)) {
        walk(child, depth + 1);
      }
    }
  };
  walk(node, 0);
  return out;
}
