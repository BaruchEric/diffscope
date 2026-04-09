import { useEffect, useState } from "react";
import type { BrowseResult } from "@shared/types";
import { api } from "../lib/api";
import { useStore } from "../store";
import { relativeTime } from "../lib/relative-time";

interface Recent {
  path: string;
  lastOpenedAt: string;
}

function Breadcrumb({
  path,
  onNavigate,
}: {
  path: string;
  onNavigate: (path: string) => void | Promise<void>;
}) {
  // Split absolute path into clickable segments. e.g. /Users/eric/proj →
  // [/, Users, eric, proj] each linked to its full prefix.
  const parts = path.split("/").filter((p) => p.length > 0);
  const segments = parts.map((part, i) => ({
    label: part,
    path: "/" + parts.slice(0, i + 1).join("/"),
  }));
  return (
    <nav className="flex min-w-0 items-center gap-1 truncate font-mono">
      <button
        onClick={() => void onNavigate("/")}
        className="text-accent hover:underline"
      >
        /
      </button>
      {segments.map((s, i) => (
        <span key={s.path} className="flex items-center gap-1">
          {i > 0 && <span className="text-fg-subtle">/</span>}
          <button
            onClick={() => void onNavigate(s.path)}
            className="text-accent hover:underline"
          >
            {s.label}
          </button>
        </span>
      ))}
    </nav>
  );
}

export function Picker() {
  const [recents, setRecents] = useState<Recent[]>([]);
  const [browse, setBrowse] = useState<BrowseResult | null>(null);
  const [pathInput, setPathInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const initialize = useStore((s) => s.initialize);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [r, b, i] = await Promise.allSettled([
        api.recents(),
        api.browse(),
        api.info(),
      ]);
      if (cancelled) return;
      if (r.status === "fulfilled") setRecents(r.value);
      if (b.status === "fulfilled") setBrowse(b.value);
      // Default path input: last-opened repo → server's cwd → empty.
      // Only prefill if the user hasn't started typing yet.
      const defaultPath =
        (r.status === "fulfilled" && r.value[0]?.path) ||
        (i.status === "fulfilled" && i.value.cwd) ||
        "";
      if (defaultPath) {
        setPathInput((prev) => (prev === "" ? defaultPath : prev));
      }
      // Surface backend failures — previously swallowed by `void`, which
      // left the picker empty and unusable with no indication of why.
      if (b.status === "rejected" || i.status === "rejected") {
        setError(
          "Can't reach the diffscope backend. In dev, make sure `bun run dev:server` is running alongside `bun run dev:web`.",
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const open = async (path: string) => {
    setError(null);
    try {
      await api.open(path);
      await initialize();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const navigateTo = async (path: string) => {
    try {
      setBrowse(await api.browse(path));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-8">
      <h1 className="font-display text-2xl text-fg">Open a repository</h1>

      {error && (
        <div className="rounded border border-diff-del-sign bg-diff-del-bg p-3 text-sm text-diff-del-fg">
          {error}
        </div>
      )}

      {recents.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-medium uppercase tracking-wide text-fg-subtle">
            Recents
          </h2>
          <ul className="space-y-1">
            {recents.map((r) => (
              <li key={r.path}>
                <button
                  onClick={() => void open(r.path)}
                  className="flex w-full items-center justify-between gap-3 rounded border-l-2 border-transparent px-3 py-2 text-left text-fg hover:border-accent hover:bg-surface-hover"
                >
                  <span className="truncate">{r.path}</span>
                  <span className="shrink-0 text-xs text-fg-subtle">
                    {relativeTime(r.lastOpenedAt)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h2 className="mb-2 text-sm font-medium uppercase tracking-wide text-fg-subtle">
          Or open a folder
        </h2>
        <div className="mb-2 flex gap-2">
          <input
            value={pathInput}
            onChange={(e) => setPathInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && pathInput) void open(pathInput);
            }}
            placeholder="/path/to/repo"
            autoFocus
            className="flex-1 rounded border border-border-strong bg-surface px-3 py-2 text-sm text-fg placeholder:text-fg-subtle focus:border-accent focus:outline-none"
          />
          <button
            onClick={() => pathInput && void open(pathInput)}
            className="rounded bg-accent px-4 py-2 text-sm text-accent-fg hover:brightness-110"
          >
            Open
          </button>
        </div>
        {browse && (
          <div className="rounded border border-border bg-bg-elevated shadow-soft">
            <div className="flex items-center justify-between gap-2 border-b border-border bg-surface px-3 py-2 text-xs text-fg">
              <Breadcrumb path={browse.path} onNavigate={navigateTo} />
              {browse.parent && (
                <button
                  onClick={() => void navigateTo(browse.parent!)}
                  className="shrink-0 text-accent hover:underline"
                >
                  ↑ Parent
                </button>
              )}
            </div>
            <ul className="max-h-[40vh] overflow-auto">
              {browse.entries.map((e) => (
                <li key={e.path} className="flex items-center">
                  <button
                    onClick={() => void navigateTo(e.path)}
                    className="flex-1 truncate px-3 py-1.5 text-left text-sm text-fg hover:bg-surface-hover"
                  >
                    📁 {e.name}
                    {e.isGitRepo && (
                      <span className="ml-2 text-xs text-diff-add-sign">git</span>
                    )}
                  </button>
                  {e.isGitRepo && (
                    <button
                      onClick={() => void open(e.path)}
                      className="mr-2 rounded border border-border-strong px-2 py-0.5 text-xs text-fg-muted hover:border-accent hover:text-fg"
                    >
                      Open
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
    </div>
  );
}
