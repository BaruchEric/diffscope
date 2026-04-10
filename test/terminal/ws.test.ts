// test/terminal/ws.test.ts
// End-to-end protocol test: stand up a Bun server with only the terminal
// module mounted, connect a real WebSocket client, and exercise the full
// frame vocabulary.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Server } from "bun";
import { createTerminalModule } from "../../src/server/terminal";
import type {
  TerminalClientFrame,
  TerminalServerFrame,
} from "../../src/shared/terminal-protocol";

interface TestFixture {
  server: Server<unknown>;
  port: number;
  shutdown: () => Promise<void>;
}

function startTestServer(): TestFixture {
  const mod = createTerminalModule({ repoRoot: process.cwd() });
  const server: Server<unknown> = Bun.serve({
    port: 0,
    fetch(req, srv) {
      const url = new URL(req.url);
      if (url.pathname === "/api/terminal/ws") {
        if (
          srv.upgrade(req, { data: { subscriptions: new Map() } })
        ) {
          return undefined as unknown as Response;
        }
        return new Response("upgrade failed", { status: 400 });
      }
      return new Response("not found", { status: 404 });
    },
    websocket: mod.websocket,
  });
  const port = server.port;
  if (typeof port !== "number") {
    throw new Error("server did not allocate a port");
  }
  return {
    server,
    port,
    async shutdown() {
      await mod.shutdown();
      server.stop(true);
    },
  };
}

interface TestClient {
  ws: WebSocket;
  frames: TerminalServerFrame[];
  nextFrame(
    predicate: (f: TerminalServerFrame) => boolean,
    timeoutMs?: number,
  ): Promise<TerminalServerFrame>;
  send(f: TerminalClientFrame): void;
  close(): void;
}

async function openClient(port: number): Promise<TestClient> {
  const frames: TerminalServerFrame[] = [];
  const listeners: ((f: TerminalServerFrame) => void)[] = [];
  const ws = new WebSocket(`ws://localhost:${port}/api/terminal/ws`);
  await new Promise<void>((resolve, reject) => {
    const onErr = (e: Event) => reject(e);
    ws.onopen = () => {
      ws.removeEventListener("error", onErr);
      resolve();
    };
    ws.addEventListener("error", onErr);
  });
  ws.onmessage = (evt) => {
    const frame = JSON.parse(String(evt.data)) as TerminalServerFrame;
    frames.push(frame);
    for (const l of listeners) l(frame);
  };
  return {
    ws,
    frames,
    send(f) {
      ws.send(JSON.stringify(f));
    },
    async nextFrame(predicate, timeoutMs = 5000) {
      const hit = frames.find(predicate);
      if (hit) return hit;
      return new Promise<TerminalServerFrame>((resolve, reject) => {
        const timer = setTimeout(() => {
          const idx = listeners.indexOf(listener);
          if (idx >= 0) listeners.splice(idx, 1);
          reject(new Error(`nextFrame timed out after ${timeoutMs}ms`));
        }, timeoutMs);
        const listener = (f: TerminalServerFrame) => {
          if (predicate(f)) {
            clearTimeout(timer);
            const idx = listeners.indexOf(listener);
            if (idx >= 0) listeners.splice(idx, 1);
            resolve(f);
          }
        };
        listeners.push(listener);
      });
    },
    close() {
      ws.close();
    },
  };
}

describe("terminal websocket protocol", () => {
  let fixture: TestFixture;
  beforeEach(() => {
    fixture = startTestServer();
  });
  afterEach(async () => {
    await fixture.shutdown();
  });

  test("spawn → data → exit round trip", async () => {
    const c = await openClient(fixture.port);
    const id = crypto.randomUUID();
    c.send({
      op: "spawn",
      id,
      kind: "shell",
      cols: 80,
      rows: 24,
      title: "shell",
    });
    await c.nextFrame((f) => f.op === "spawned" && f.id === id);

    const payload = new TextEncoder().encode("echo diffscope-ws; exit\n");
    c.send({
      op: "data",
      id,
      b64: Buffer.from(payload).toString("base64"),
    });

    await c.nextFrame((f) => f.op === "exit" && f.id === id);

    const out = c.frames
      .filter(
        (f): f is Extract<TerminalServerFrame, { op: "data" }> =>
          f.op === "data" && f.id === id,
      )
      .map((f) => new TextDecoder().decode(Buffer.from(f.b64, "base64")))
      .join("");
    expect(out).toContain("diffscope-ws");

    c.close();
  });

  test("attach replays scrollback to a reconnecting client", async () => {
    const c1 = await openClient(fixture.port);
    const id = crypto.randomUUID();
    c1.send({
      op: "spawn",
      id,
      kind: "shell",
      cols: 80,
      rows: 24,
      title: "shell",
    });
    await c1.nextFrame((f) => f.op === "spawned" && f.id === id);

    const payload = new TextEncoder().encode("echo MARKER-123; exit\n");
    c1.send({ op: "data", id, b64: Buffer.from(payload).toString("base64") });
    await c1.nextFrame((f) => f.op === "exit" && f.id === id);

    // Leave the session in the registry (just close the socket; don't send `close`).
    c1.close();

    const c2 = await openClient(fixture.port);
    c2.send({ op: "attach", ids: [id] });
    const replay = await c2.nextFrame(
      (f) => f.op === "replay" && f.id === id,
    );
    const replayText = new TextDecoder().decode(
      Buffer.from(
        (replay as Extract<TerminalServerFrame, { op: "replay" }>).b64,
        "base64",
      ),
    );
    expect(replayText).toContain("MARKER-123");
    c2.close();
  });

  test("attach with an unknown id sends `gone`", async () => {
    const c = await openClient(fixture.port);
    const bogus = crypto.randomUUID();
    c.send({ op: "attach", ids: [bogus] });
    const frame = await c.nextFrame((f) => f.op === "gone" && f.id === bogus);
    expect(frame.op).toBe("gone");
    c.close();
  });

  test("resize updates cols/rows without errors", async () => {
    const c = await openClient(fixture.port);
    const id = crypto.randomUUID();
    c.send({
      op: "spawn",
      id,
      kind: "shell",
      cols: 80,
      rows: 24,
      title: "r",
    });
    await c.nextFrame((f) => f.op === "spawned" && f.id === id);

    c.send({ op: "resize", id, cols: 120, rows: 30 });
    // No explicit ack; verify we can still kill it cleanly.
    c.send({ op: "kill", id });
    await c.nextFrame((f) => f.op === "exit" && f.id === id);
    c.close();
  });

  test("close on a running session kills it", async () => {
    const c = await openClient(fixture.port);
    const id = crypto.randomUUID();
    c.send({
      op: "spawn",
      id,
      kind: "shell",
      cols: 80,
      rows: 24,
      title: "sleep",
    });
    await c.nextFrame((f) => f.op === "spawned" && f.id === id);
    c.send({
      op: "data",
      id,
      b64: Buffer.from(new TextEncoder().encode("sleep 30\n")).toString(
        "base64",
      ),
    });
    c.send({ op: "kill", id });
    const frame = await c.nextFrame((f) => f.op === "exit" && f.id === id);
    expect(frame.op).toBe("exit");
    c.close();
  });
});
