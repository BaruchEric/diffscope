import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createTempRepo, type TempRepo } from "./helpers/temp-repo";
import { startHttpServer, type StartedServer } from "../src/server/http";
import type { FsEntry, FileContents } from "../src/shared/types";

describe("HTTP: /api/tree + /api/file", () => {
  let temp: TempRepo;
  let server: StartedServer;
  let port: number;

  beforeEach(async () => {
    temp = createTempRepo();
    temp.write("a.ts", "hello\n");
    temp.write(".gitignore", "ignored.txt\n");
    temp.write("ignored.txt", "secret\n");
    temp.git("add", "a.ts", ".gitignore");
    temp.git("commit", "-m", "init");

    server = await startHttpServer({
      repoPath: temp.root,
      staticDir: "/tmp/does-not-exist",
      port: 0,
    });
    port = server.server.port as number;
  });
  afterEach(async () => {
    await server.stop();
    temp.cleanup();
  });

  test("GET /api/tree?hideIgnored=1 returns entries", async () => {
    const res = await fetch(`http://localhost:${port}/api/tree?hideIgnored=1`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { entries: FsEntry[] };
    const paths = body.entries.map((e) => e.path);
    expect(paths).toContain("a.ts");
    expect(paths).not.toContain("ignored.txt");
  });

  test("GET /api/tree?hideIgnored=0 includes gitignored", async () => {
    const res = await fetch(`http://localhost:${port}/api/tree?hideIgnored=0`);
    const body = (await res.json()) as { entries: FsEntry[] };
    const paths = body.entries.map((e) => e.path);
    expect(paths).toContain("ignored.txt");
  });

  test("GET /api/file returns text contents", async () => {
    const res = await fetch(`http://localhost:${port}/api/file?path=a.ts`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as FileContents;
    expect(body.kind).toBe("text");
    if (body.kind === "text") expect(body.content).toBe("hello\n");
  });

  test("GET /api/file rejects invalid path with 400", async () => {
    const res = await fetch(`http://localhost:${port}/api/file?path=../etc/passwd`);
    expect(res.status).toBe(400);
  });

  test("GET /api/file 404 for missing file", async () => {
    const res = await fetch(`http://localhost:${port}/api/file?path=nope.ts`);
    expect(res.status).toBe(404);
  });
});

describe("SSE: tree-updated", () => {
  let temp: TempRepo;
  let server: StartedServer;
  let port: number;

  beforeEach(async () => {
    temp = createTempRepo();
    temp.write("a.ts", "a\n");
    temp.git("add", ".");
    temp.git("commit", "-m", "init");

    server = await startHttpServer({
      repoPath: temp.root,
      staticDir: "/tmp/does-not-exist",
      port: 0,
    });
    port = server.server.port as number;
  });
  afterEach(async () => {
    await server.stop();
    temp.cleanup();
  });

  test("emits tree-updated when a new file appears", async () => {
    // Open SSE, then touch the working tree and wait for the event.
    const controller = new AbortController();
    const res = await fetch(`http://localhost:${port}/api/stream`, {
      signal: controller.signal,
    });
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();

    let saw = false;
    const timer = setTimeout(() => controller.abort(), 4000);
    // Small delay so the watcher is fully subscribed before we mutate.
    await new Promise((r) => setTimeout(r, 500));
    temp.write("b.ts", "b\n");

    try {
      while (!saw) {
        const { value, done } = await reader.read();
        if (done) break;
        const text = decoder.decode(value);
        for (const line of text.split("\n")) {
          if (!line.startsWith("data:")) continue;
          try {
            const event = JSON.parse(line.slice(5).trim());
            if (event.type === "tree-updated") {
              const paths = (event.entries as FsEntry[]).map((e) => e.path);
              if (paths.includes("b.ts")) {
                saw = true;
                break;
              }
            }
          } catch {
            // keepalive or partial frame — skip
          }
        }
      }
    } finally {
      clearTimeout(timer);
      controller.abort();
    }
    expect(saw).toBe(true);
  }, 10_000);
});
