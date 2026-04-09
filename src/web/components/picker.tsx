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
        className="text-blue-600 hover:underline"
      >
        /
      </button>
      {segments.map((s, i) => (
        <span key={s.path} className="flex items-center gap-1">
          {i > 0 && <span className="text-neutral-400">/</span>}
          <button
            onClick={() => void onNavigate(s.path)}
            className="text-blue-600 hover:underline"
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
    void api.recents().then((r) => {
      if (!cancelled) setRecents(r);
    });
    void api.browse().then((b) => {
      if (!cancelled) setBrowse(b);
    });
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
      <h1 className="text-2xl font-semibold">Open a repository</h1>

      {error && (
        <div className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
          {error}
        </div>
      )}

      {recents.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-medium uppercase tracking-wide text-neutral-500">
            Recents
          </h2>
          <ul className="space-y-1">
            {recents.map((r) => (
              <li key={r.path}>
                <button
                  onClick={() => void open(r.path)}
                  className="flex w-full items-center justify-between gap-3 rounded px-3 py-2 text-left hover:bg-neutral-100 dark:hover:bg-neutral-900"
                >
                  <span className="truncate">{r.path}</span>
                  <span className="shrink-0 text-xs text-neutral-500">
                    {relativeTime(r.lastOpenedAt)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h2 className="mb-2 text-sm font-medium uppercase tracking-wide text-neutral-500">
          Or open a folder
        </h2>
        <div className="mb-2 flex gap-2">
          <input
            value={pathInput}
            onChange={(e) => setPathInput(e.target.value)}
            placeholder="/path/to/repo"
            className="flex-1 rounded border border-neutral-300 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900"
          />
          <button
            onClick={() => pathInput && void open(pathInput)}
            className="rounded bg-neutral-900 px-4 py-2 text-sm text-white dark:bg-neutral-100 dark:text-neutral-900"
          >
            Open
          </button>
        </div>
        {browse && (
          <div className="rounded border border-neutral-200 dark:border-neutral-800">
            <div className="flex items-center justify-between gap-2 border-b border-neutral-200 bg-neutral-50 px-3 py-2 text-xs dark:border-neutral-800 dark:bg-neutral-900">
              <Breadcrumb path={browse.path} onNavigate={navigateTo} />
              {browse.parent && (
                <button
                  onClick={() => void navigateTo(browse.parent!)}
                  className="shrink-0 text-blue-600 hover:underline"
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
                    className="flex-1 truncate px-3 py-1.5 text-left text-sm hover:bg-neutral-100 dark:hover:bg-neutral-900"
                  >
                    📁 {e.name}
                    {e.isGitRepo && <span className="ml-2 text-xs text-green-600">git</span>}
                  </button>
                  {e.isGitRepo && (
                    <button
                      onClick={() => void open(e.path)}
                      className="mr-2 rounded bg-neutral-200 px-2 py-0.5 text-xs dark:bg-neutral-800"
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
