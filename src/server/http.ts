// src/server/http.ts
import { serve, type Server } from "bun";
import { readdirSync, statSync, existsSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { homedir } from "node:os";
import { createRepo, GitError, type Repo } from "./repo";
import { createEventHub, type EventHub } from "./events";
import { addRecent, loadRecents, removeRecent } from "./recents";

export interface HttpServerOptions {
  repoPath: string | null;
  staticDir: string; // absolute path to the built web/ dist
  port: number;
}

export interface StartedServer {
  server: Server<unknown>;
  hub: EventHub | null;
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

  const handle = async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    const pathname = url.pathname;

    // REST: repo state
    if (pathname === "/api/info") {
      if (!repo) return json({ loaded: false });
      const root = await repo.getRepoRoot().catch(() => null);
      return json({ loaded: true, root });
    }

    if (pathname === "/api/status") {
      if (!repo) return json({ error: "no repo loaded" }, 400);
      try {
        return json(await repo.getStatus());
      } catch (err) {
        return errorResponse(err);
      }
    }

    if (pathname === "/api/diff") {
      if (!repo) return json({ error: "no repo loaded" }, 400);
      const path = url.searchParams.get("path");
      if (!path) return json({ error: "path required" }, 400);
      const staged = url.searchParams.get("staged") === "true";
      try {
        const diff = await repo.getFileDiff(path, { staged });
        return json(diff);
      } catch (err) {
        return errorResponse(err);
      }
    }

    if (pathname === "/api/log") {
      if (!repo) return json({ error: "no repo loaded" }, 400);
      const limit = parseInt(url.searchParams.get("limit") ?? "50", 10);
      const offset = parseInt(url.searchParams.get("offset") ?? "0", 10);
      try {
        return json(await repo.getLog({ limit, offset }));
      } catch (err) {
        return errorResponse(err);
      }
    }

    if (pathname.startsWith("/api/commit/")) {
      if (!repo) return json({ error: "no repo loaded" }, 400);
      const sha = pathname.slice("/api/commit/".length);
      try {
        return json(await repo.getCommit(sha));
      } catch (err) {
        return errorResponse(err);
      }
    }

    if (pathname === "/api/branches") {
      if (!repo) return json({ error: "no repo loaded" }, 400);
      try {
        return json(await repo.getBranches());
      } catch (err) {
        return errorResponse(err);
      }
    }

    if (pathname === "/api/stashes") {
      if (!repo) return json({ error: "no repo loaded" }, 400);
      try {
        return json(await repo.getStashes());
      } catch (err) {
        return errorResponse(err);
      }
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
      // Walk upward to find .git
      let current = resolve(input);
      let found: string | null = null;
      while (true) {
        if (existsSync(join(current, ".git"))) {
          found = current;
          break;
        }
        const parent = dirname(current);
        if (parent === current) break;
        current = parent;
      }
      if (!found) return json({ error: "not a git repo" }, 400);
      addRecent(found);
      // Re-initialize the hub to point at the new repo.
      if (hub) await hub.stop();
      repo = createRepo(found);
      hub = createEventHub(repo);
      await hub.start();
      return json({ ok: true, root: found });
    }

    if (pathname === "/api/blob") {
      if (!repo) return json({ error: "no repo loaded" }, 400);
      const path = url.searchParams.get("path");
      const ref = url.searchParams.get("ref") ?? "HEAD"; // "HEAD" | "INDEX" | "WORKDIR"
      if (!path) return json({ error: "path required" }, 400);
      try {
        let out: Buffer;
        if (ref === "WORKDIR") {
          const buf = await Bun.file(`${repo.cwd}/${path}`).arrayBuffer();
          out = Buffer.from(buf);
        } else {
          const spec = ref === "HEAD" ? `HEAD:${path}` : `:${path}`;
          const { spawnSync } = await import("node:child_process");
          const r = spawnSync("git", ["show", spec], {
            cwd: repo.cwd,
            encoding: "buffer",
          });
          if (r.status !== 0)
            return json({ error: r.stderr.toString() }, 500);
          out = r.stdout;
        }
        const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
        const mime =
          ext === "png"
            ? "image/png"
            : ext === "jpg" || ext === "jpeg"
              ? "image/jpeg"
              : ext === "gif"
                ? "image/gif"
                : ext === "webp"
                  ? "image/webp"
                  : ext === "svg"
                    ? "image/svg+xml"
                    : "application/octet-stream";
        return new Response(out, { headers: { "content-type": mime } });
      } catch (err) {
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

  const server = serve({
    port: opts.port,
    async fetch(req) {
      try {
        return await handle(req);
      } catch (err) {
        return errorResponse(err);
      }
    },
  });

  return {
    server,
    hub,
    async stop() {
      if (hub) await hub.stop();
      server.stop(true);
    },
  };
}
