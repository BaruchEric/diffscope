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
