// src/server/http.ts
import { serve, type Server } from "bun";
import { readdirSync, statSync, existsSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { homedir } from "node:os";
import { createRepo, findRepoRoot, GitError, type Repo } from "./repo";
import { createEventHub, type EventHub } from "./events";
import { addRecent, loadRecents, removeRecent } from "./recents";
import {
  blameFile,
  getCachedBlame,
  invalidateBlameCache,
  setCachedBlame,
} from "./blame";
import { createTerminalModule, type TerminalModule } from "./terminal";
import type { TerminalSocketData } from "./terminal/ws";
import { listTree, readFile as readTreeFile } from "./tree";

const MIME_BY_EXT: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  bmp: "image/bmp",
  ico: "image/x-icon",
};

function mimeForPath(path: string): string {
  const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  return MIME_BY_EXT[ext] ?? "application/octet-stream";
}

/**
 * Reject absolute paths and any `..` segments. Repo endpoints that accept a
 * `?path=` query parameter must run their input through this before touching
 * the filesystem, or git could be bypassed via `/api/blob?ref=WORKDIR`.
 */
function isRepoRelPathSafe(path: string): boolean {
  if (!path) return false;
  if (path.startsWith("/")) return false;
  if (path.includes("\0")) return false;
  // Split on both separators to catch Windows-style traversals too.
  for (const seg of path.split(/[\\/]/)) {
    if (seg === "..") return false;
  }
  return true;
}

function parseIntParam(raw: string | null, fallback: number, min: number, max: number): number {
  if (raw === null) return fallback;
  const n = parseInt(raw, 10);
  if (Number.isNaN(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

export interface HttpServerOptions {
  repoPath: string | null;
  staticDir: string; // absolute path to the built web/ dist
  port: number;
}

export interface StartedServer {
  server: Server<unknown>;
  stop(): Promise<void>;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function errorResponse(err: unknown): Response {
  if (err instanceof GitError) {
    return json({ error: err.stderr, code: err.code }, 500);
  }
  const message = err instanceof Error ? err.message : String(err);
  return json({ error: message }, 500);
}

export async function startHttpServer(opts: HttpServerOptions): Promise<StartedServer> {
  let repo: Repo | null = opts.repoPath ? createRepo(opts.repoPath) : null;
  let hub: EventHub | null = null;
  if (repo) {
    hub = createEventHub(repo);
    await hub.start();
  }

  // Terminal module — created whenever a repo is loaded. Sessions don't
  // survive a repo swap (see /api/open below): the fresh repo gets a
  // fresh module so stale cwd/scripts don't linger.
  let terminalModule: TerminalModule | null = null;
  if (repo) {
    terminalModule = createTerminalModule({ repoRoot: repo.cwd });
  }

  // Wraps repo-required endpoints: enforces that a repo is loaded and
  // funnels any thrown error through a single error serializer. This
  // replaces the `if (!repo) return ...; try { ... } catch (err) { ... }`
  // boilerplate that used to wrap every handler below.
  const withRepo = async <T>(
    fn: (r: Repo) => Promise<T>,
    onError?: (err: unknown) => Response,
  ): Promise<Response> => {
    if (!repo) return json({ error: "no repo loaded" }, 400);
    try {
      return json(await fn(repo));
    } catch (err) {
      return onError ? onError(err) : errorResponse(err);
    }
  };

  const handle = async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    const pathname = url.pathname;

    // REST: repo state
    if (pathname === "/api/info") {
      const cwd = process.cwd();
      if (!repo) return json({ loaded: false, cwd });
      const root = await repo.getRepoRoot().catch(() => null);
      return json({ loaded: true, root, cwd });
    }

    if (pathname === "/api/status") {
      return withRepo((r) => r.getStatus());
    }

    if (pathname === "/api/diff") {
      const path = url.searchParams.get("path");
      if (!path) return json({ error: "path required" }, 400);
      if (!isRepoRelPathSafe(path)) return json({ error: "invalid path" }, 400);
      const staged = url.searchParams.get("staged") === "true";
      return withRepo((r) => r.getFileDiff(path, { staged }));
    }

    if (pathname === "/api/blame") {
      const path = url.searchParams.get("path");
      if (!path) return json({ error: "path required" }, 400);
      if (!isRepoRelPathSafe(path)) return json({ error: "invalid path" }, 400);
      return withRepo(
        async (r) => {
          const headSha = await r.getHeadSha();
          if (!headSha) throw new Error("no HEAD");
          const cached = getCachedBlame(path, headSha);
          if (cached) return cached;
          const lines = await blameFile(r.cwd, path);
          setCachedBlame(path, headSha, lines);
          return lines;
        },
        // Blame shells out to git blame which treats almost any failure
        // (missing file, first-time-added line, no HEAD) as a 404 to the UI.
        (err) =>
          json({ error: err instanceof Error ? err.message : String(err) }, 404),
      );
    }

    if (pathname === "/api/log") {
      const limit = parseIntParam(url.searchParams.get("limit"), 50, 1, 500);
      const offset = parseIntParam(url.searchParams.get("offset"), 0, 0, 100_000);
      return withRepo((r) => r.getLog({ limit, offset }));
    }

    if (pathname.startsWith("/api/commit/")) {
      const sha = pathname.slice("/api/commit/".length);
      return withRepo((r) => r.getCommit(sha));
    }

    if (pathname === "/api/branches") {
      return withRepo((r) => r.getBranches());
    }

    if (pathname === "/api/stashes") {
      return withRepo((r) => r.getStashes());
    }

    // Terminal: scripts list
    if (pathname === "/api/terminal/scripts") {
      if (!terminalModule) return json({ error: "no repo loaded" }, 400);
      return terminalModule.handleScriptsRequest();
    }

    // SSE stream
    if (pathname === "/api/stream") {
      if (!hub) return json({ error: "no repo loaded" }, 400);
      const stream = new ReadableStream({
        start(controller) {
          const encoder = new TextEncoder();
          const send = (event: unknown) => {
            const data = `data: ${JSON.stringify(event)}\n\n`;
            controller.enqueue(encoder.encode(data));
          };
          const { snapshot, unsubscribe } = hub!.subscribe((event) => send(event));
          send(snapshot);
          // Keepalive ping every 25s to prevent proxy timeouts
          const keepalive = setInterval(() => {
            controller.enqueue(encoder.encode(`: keepalive\n\n`));
          }, 25000);
          req.signal.addEventListener("abort", () => {
            clearInterval(keepalive);
            unsubscribe();
            try {
              controller.close();
            } catch {
              // already closed
            }
          });
        },
      });
      return new Response(stream, {
        headers: {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
          connection: "keep-alive",
        },
      });
    }

    if (pathname === "/api/browse") {
      const rawPath = url.searchParams.get("path") || homedir();
      const abs = isAbsolute(rawPath) ? resolve(rawPath) : resolve(homedir(), rawPath);
      if (!existsSync(abs)) return json({ error: "not found", path: abs }, 404);
      const entries: {
        name: string;
        path: string;
        isGitRepo: boolean;
      }[] = [];
      try {
        for (const name of readdirSync(abs).sort()) {
          if (name.startsWith(".") && name !== ".git") continue;
          const p = join(abs, name);
          try {
            const st = statSync(p);
            if (!st.isDirectory()) continue;
            entries.push({ name, path: p, isGitRepo: existsSync(join(p, ".git")) });
          } catch {
            // unreadable — skip
          }
        }
      } catch (err) {
        return errorResponse(err);
      }
      const parent = abs === "/" ? null : dirname(abs);
      return json({ path: abs, entries, parent });
    }

    if (pathname === "/api/recents" && req.method === "GET") {
      return json(loadRecents());
    }

    if (pathname === "/api/recents" && req.method === "DELETE") {
      const path = url.searchParams.get("path");
      if (!path) return json({ error: "path required" }, 400);
      return json(removeRecent(path));
    }

    if (pathname === "/api/open" && req.method === "POST") {
      const body = (await req.json().catch(() => ({}))) as { path?: string };
      const input = body.path;
      if (!input) return json({ error: "path required" }, 400);
      const found = findRepoRoot(input);
      if (!found) return json({ error: "not a git repo" }, 400);
      addRecent(found);

      // Build the new hub first, then swap atomically and only stop the old
      // one on success — otherwise a failure mid-swap leaves the server in
      // a half-initialized state with hub = null.
      const nextRepo = createRepo(found);
      const nextHub = createEventHub(nextRepo);
      try {
        await nextHub.start();
      } catch (err) {
        return errorResponse(err);
      }
      const prevHub = hub;
      const prevTerminal = terminalModule;
      repo = nextRepo;
      hub = nextHub;
      terminalModule = createTerminalModule({ repoRoot: nextRepo.cwd });
      invalidateBlameCache();
      if (prevHub) await prevHub.stop();
      if (prevTerminal) await prevTerminal.shutdown();
      return json({ ok: true, root: found });
    }

    if (pathname === "/api/blob") {
      if (!repo) return json({ error: "no repo loaded" }, 400);
      const path = url.searchParams.get("path");
      const ref = url.searchParams.get("ref") ?? "HEAD"; // "HEAD" | "INDEX" | "WORKDIR"
      if (!path) return json({ error: "path required" }, 400);
      if (!isRepoRelPathSafe(path)) return json({ error: "invalid path" }, 400);
      try {
        if (ref === "WORKDIR") {
          // Resolve and double-check the result still lives inside repo.cwd,
          // belt-and-braces against symlink escapes that isRepoRelPathSafe can't see.
          const absolute = resolve(repo.cwd, path);
          const root = resolve(repo.cwd);
          if (absolute !== root && !absolute.startsWith(root + "/")) {
            return json({ error: "invalid path" }, 400);
          }
          return new Response(Bun.file(absolute), {
            headers: { "content-type": mimeForPath(path) },
          });
        }
        if (ref === "HEAD" || ref === "INDEX") {
          const out = await repo.showBlob(ref, path);
          return new Response(new Uint8Array(out), {
            headers: { "content-type": mimeForPath(path) },
          });
        }
        return json({ error: `invalid ref: ${ref}` }, 400);
      } catch (err) {
        return errorResponse(err);
      }
    }

    if (pathname === "/api/tree") {
      if (!repo) return json({ error: "no repo loaded" }, 400);
      const hideIgnored = url.searchParams.get("hideIgnored") !== "0";
      try {
        const entries = await listTree(repo.cwd, { hideIgnored });
        return json({ entries });
      } catch (err) {
        return errorResponse(err);
      }
    }

    if (pathname === "/api/file") {
      if (!repo) return json({ error: "no repo loaded" }, 400);
      const path = url.searchParams.get("path");
      if (!path) return json({ error: "path required" }, 400);
      // Reuse the existing isRepoRelPathSafe gate for the obvious cases —
      // readTreeFile has its own deeper check but failing early gives a
      // clean 400 instead of a generic error.
      if (!isRepoRelPathSafe(path)) return json({ error: "invalid path" }, 400);
      try {
        const contents = await readTreeFile(repo.cwd, path);
        return json(contents);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (/not found|ENOENT/i.test(msg)) return json({ error: msg }, 404);
        if (/invalid path/i.test(msg)) return json({ error: msg }, 400);
        return errorResponse(err);
      }
    }

    // Static SPA fallback
    if (!pathname.startsWith("/api/")) {
      const fsPath =
        pathname === "/"
          ? `${opts.staticDir}/index.html`
          : `${opts.staticDir}${pathname}`;
      const file = Bun.file(fsPath);
      if (await file.exists()) {
        return new Response(file);
      }
      // SPA fallback — route not found on disk → serve index.html
      const index = Bun.file(`${opts.staticDir}/index.html`);
      if (await index.exists()) {
        return new Response(index);
      }
      return new Response("frontend not built — run `bun run build:web`", {
        status: 503,
      });
    }

    return json({ error: "not found" }, 404);
  };

  const server = serve<TerminalSocketData, never>({
    port: opts.port,
    async fetch(req, srv) {
      try {
        // Terminal WebSocket upgrade must run before the generic handler
        // since the handler would otherwise 404 the route.
        const url = new URL(req.url);
        if (url.pathname === "/api/terminal/ws") {
          if (!terminalModule) return json({ error: "no repo loaded" }, 400);
          if (srv.upgrade(req, { data: { subscriptions: new Map() } })) {
            return undefined as unknown as Response;
          }
          return new Response("upgrade failed", { status: 400 });
        }
        return await handle(req);
      } catch (err) {
        return errorResponse(err);
      }
    },
    // Dispatcher: the active terminalModule can change on /api/open, so we
    // forward every WS callback to whichever module is current. Sockets
    // from a previous module are forcibly closed when that module shuts
    // down, so the dispatcher always hits the right instance.
    websocket: {
      open(ws) {
        terminalModule?.websocket.open?.(ws);
      },
      async message(ws, data) {
        await terminalModule?.websocket.message?.(ws, data);
      },
      close(ws, code, reason) {
        terminalModule?.websocket.close?.(ws, code, reason);
      },
      drain(ws) {
        terminalModule?.websocket.drain?.(ws);
      },
    },
  });

  return {
    server,
    async stop() {
      if (hub) await hub.stop();
      if (terminalModule) await terminalModule.shutdown();
      server.stop(true);
    },
  };
}
