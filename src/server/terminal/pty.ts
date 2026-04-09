// src/server/terminal/pty.ts
// Manages PTY sessions. Under the hood it spawns a Node.js helper
// (pty-host.mjs) that owns the node-pty calls — see the plan's Task 1
// note for why the indirection exists. This file exposes a clean
// in-process PtyRegistry interface; callers never see the subprocess.
import { spawn, type Subprocess } from "bun";
import { randomUUID } from "node:crypto";
import { join } from "node:path";

const SCROLLBACK_CAP_BYTES = 1_048_576; // 1 MiB per session

export interface PtySpawnOptions {
  command: string;
  args: string[];
  cwd: string;
  cols: number;
  rows: number;
  title: string;
  scriptName?: string;
  env?: Record<string, string>;
  /** Pre-allocated id from the caller. If omitted, a UUID is generated. */
  id?: string;
}

export interface PtySession {
  id: string;
  title: string;
  scriptName?: string;
  cwd: string;
  cols: number;
  rows: number;
  createdAt: number;
  exitCode: number | null;
}

/** Subscriber callback receives raw bytes as they arrive from the PTY. */
export type PtyDataHandler = (data: Uint8Array) => void;
/** Called once when the process exits. */
export type PtyExitHandler = (code: number | null) => void;

interface InternalSession extends PtySession {
  // Ring buffer: a list of chunks and a rolling byte total. Cheaper to
  // trim than concatenating one giant Uint8Array every append.
  chunks: Uint8Array[];
  chunksBytes: number;
  dataHandlers: Set<PtyDataHandler>;
  exitHandlers: Set<PtyExitHandler>;
  exitPromise: Promise<number | null>;
  resolveExit: (code: number | null) => void;
  spawnResolved: boolean;
  spawnError?: string;
}

export interface PtyRegistry {
  spawn(opts: PtySpawnOptions): PtySession;
  write(id: string, data: Uint8Array): void;
  resize(id: string, cols: number, rows: number): void;
  kill(id: string): void;
  close(id: string): void;
  get(id: string): PtySession | undefined;
  list(): PtySession[];
  readScrollback(id: string): Uint8Array;
  subscribe(id: string, handler: PtyDataHandler): () => void;
  onExit(id: string, handler: PtyExitHandler): () => void;
  waitForExit(id: string, timeoutMs?: number): Promise<number | null>;
  waitForSpawn(id: string, timeoutMs?: number): Promise<void>;
  shutdown(): Promise<void>;
}

function concatScrollback(chunks: Uint8Array[], totalBytes: number): Uint8Array {
  const out = new Uint8Array(totalBytes);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

function appendWithCap(session: InternalSession, data: Uint8Array): void {
  session.chunks.push(data);
  session.chunksBytes += data.byteLength;
  // Drop oldest chunks until we're back under the cap. If the new chunk
  // alone exceeds the cap, we'll keep just that chunk.
  while (
    session.chunksBytes > SCROLLBACK_CAP_BYTES &&
    session.chunks.length > 1
  ) {
    const dropped = session.chunks.shift()!;
    session.chunksBytes -= dropped.byteLength;
  }
}

function publicView(s: InternalSession): PtySession {
  return {
    id: s.id,
    title: s.title,
    scriptName: s.scriptName,
    cwd: s.cwd,
    cols: s.cols,
    rows: s.rows,
    createdAt: s.createdAt,
    exitCode: s.exitCode,
  };
}

interface HostEvent {
  t: string;
  id?: string;
  data?: string;
  exitCode?: number | null;
  signal?: string | null;
  message?: string;
  pid?: number;
}

/**
 * Resolves the path to pty-host.mjs. In the normal source layout the
 * helper lives next to this file. Bun's `import.meta.dir` points at the
 * containing directory of the running .ts file.
 */
function hostScriptPath(): string {
  return join(import.meta.dir, "pty-host.mjs");
}

export function createPtyRegistry(): PtyRegistry {
  const sessions = new Map<string, InternalSession>();
  const spawnWaiters = new Map<string, (err?: string) => void>();

  // Spawn the Node.js helper process. We keep it alive for the lifetime of
  // the registry; every session multiplexes over this one child.
  const host: Subprocess<"pipe", "pipe", "inherit"> = spawn({
    cmd: ["node", hostScriptPath()],
    stdin: "pipe",
    stdout: "pipe",
    stderr: "inherit",
  });

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  const sendCommand = (cmd: Record<string, unknown>): void => {
    try {
      host.stdin.write(encoder.encode(JSON.stringify(cmd) + "\n"));
    } catch {
      // host has likely exited; subsequent operations will be no-ops
    }
  };

  // Parse the host's stdout as line-delimited JSON.
  const parseLoop = async (): Promise<void> => {
    let pending = "";
    const reader = host.stdout.getReader();
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        pending += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = pending.indexOf("\n")) >= 0) {
          const line = pending.slice(0, nl);
          pending = pending.slice(nl + 1);
          if (!line) continue;
          try {
            handleHostEvent(JSON.parse(line) as HostEvent);
          } catch {
            // ignore malformed lines
          }
        }
      }
    } catch {
      // stream errored — sessions will be cleaned up when the host exits
    }
  };

  const handleHostEvent = (evt: HostEvent): void => {
    if (evt.t === "ready") return;
    if (!evt.id) return;

    const session = sessions.get(evt.id);
    if (!session) return;

    switch (evt.t) {
      case "spawned": {
        session.spawnResolved = true;
        const w = spawnWaiters.get(evt.id);
        if (w) {
          spawnWaiters.delete(evt.id);
          w();
        }
        return;
      }
      case "data": {
        if (!evt.data) return;
        const bytes = new Uint8Array(Buffer.from(evt.data, "base64"));
        appendWithCap(session, bytes);
        for (const h of session.dataHandlers) h(bytes);
        return;
      }
      case "exit": {
        session.exitCode = evt.exitCode ?? null;
        for (const h of session.exitHandlers) h(session.exitCode);
        session.resolveExit(session.exitCode);
        return;
      }
      case "error": {
        session.spawnError = evt.message ?? "unknown error";
        const w = spawnWaiters.get(evt.id);
        if (w) {
          spawnWaiters.delete(evt.id);
          w(evt.message ?? "unknown error");
        }
        // If the session hasn't exited, synthesize an exit so waiters unblock.
        if (session.exitCode === null) {
          session.exitCode = -1;
          for (const h of session.exitHandlers) h(-1);
          session.resolveExit(-1);
        }
        return;
      }
    }
  };

  // Kick off the parse loop. It runs for the lifetime of the registry.
  void parseLoop();

  const spawnSession = (opts: PtySpawnOptions): PtySession => {
    const id = opts.id ?? randomUUID();
    if (sessions.has(id)) {
      throw new Error(`PTY id collision: ${id}`);
    }

    let resolveExit!: (code: number | null) => void;
    const exitPromise = new Promise<number | null>((res) => {
      resolveExit = res;
    });

    const session: InternalSession = {
      id,
      title: opts.title,
      scriptName: opts.scriptName,
      cwd: opts.cwd,
      cols: opts.cols,
      rows: opts.rows,
      createdAt: Date.now(),
      exitCode: null,
      chunks: [],
      chunksBytes: 0,
      dataHandlers: new Set(),
      exitHandlers: new Set(),
      exitPromise,
      resolveExit,
      spawnResolved: false,
    };
    sessions.set(id, session);

    // Send only the caller-provided env (if any) over IPC. When omitted,
    // the host defaults to its own process.env so we don't pay to
    // serialize hundreds of parent env vars on every spawn. TERM is set
    // on the host side in pty-host.mjs regardless.
    sendCommand({
      t: "spawn",
      id,
      command: opts.command,
      args: opts.args,
      cwd: opts.cwd,
      cols: opts.cols,
      rows: opts.rows,
      ...(opts.env ? { env: opts.env } : {}),
    });

    return publicView(session);
  };

  const write = (id: string, data: Uint8Array): void => {
    const s = sessions.get(id);
    if (!s || s.exitCode !== null) return;
    sendCommand({
      t: "write",
      id,
      data: Buffer.from(data).toString("base64"),
    });
  };

  const resize = (id: string, cols: number, rows: number): void => {
    const s = sessions.get(id);
    if (!s) return;
    s.cols = cols;
    s.rows = rows;
    if (s.exitCode === null) {
      sendCommand({ t: "resize", id, cols, rows });
    }
  };

  const kill = (id: string): void => {
    const s = sessions.get(id);
    if (!s || s.exitCode !== null) return;
    sendCommand({ t: "kill", id, signal: "SIGHUP" });
    // Escalate after 1s if the host hasn't reported exit. Clear the timer
    // via the exit handler so a fast-exiting process doesn't leave a dead
    // timer in the queue.
    const escalate = setTimeout(() => {
      const still = sessions.get(id);
      if (still && still.exitCode === null) {
        sendCommand({ t: "kill", id, signal: "SIGKILL" });
      }
    }, 1000);
    s.exitHandlers.add(function clearEscalate() {
      clearTimeout(escalate);
      s.exitHandlers.delete(clearEscalate);
    });
  };

  const close = (id: string): void => {
    const s = sessions.get(id);
    if (!s) return;
    if (s.exitCode === null) {
      sendCommand({ t: "close", id });
    }
    sessions.delete(id);
  };

  const get = (id: string) => {
    const s = sessions.get(id);
    return s ? publicView(s) : undefined;
  };

  const list = () => [...sessions.values()].map(publicView);

  const readScrollback = (id: string): Uint8Array => {
    const s = sessions.get(id);
    if (!s) return new Uint8Array(0);
    return concatScrollback(s.chunks, s.chunksBytes);
  };

  const subscribe = (id: string, handler: PtyDataHandler): (() => void) => {
    const s = sessions.get(id);
    if (!s) return () => {};
    s.dataHandlers.add(handler);
    return () => {
      s.dataHandlers.delete(handler);
    };
  };

  const onExit = (id: string, handler: PtyExitHandler): (() => void) => {
    const s = sessions.get(id);
    if (!s) return () => {};
    if (s.exitCode !== null) {
      queueMicrotask(() => handler(s.exitCode));
      return () => {};
    }
    s.exitHandlers.add(handler);
    return () => {
      s.exitHandlers.delete(handler);
    };
  };

  const waitForExit = async (
    id: string,
    timeoutMs = 10_000,
  ): Promise<number | null> => {
    const s = sessions.get(id);
    if (!s) return null;
    if (s.exitCode !== null) return s.exitCode;
    let timer: ReturnType<typeof setTimeout> | null = null;
    try {
      return await Promise.race([
        s.exitPromise,
        new Promise<number | null>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(`PTY ${id} did not exit in ${timeoutMs}ms`)),
            timeoutMs,
          );
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  };

  const waitForSpawn = async (id: string, timeoutMs = 5000): Promise<void> => {
    const s = sessions.get(id);
    if (!s) throw new Error(`unknown session: ${id}`);
    if (s.spawnResolved) return;
    if (s.spawnError) throw new Error(s.spawnError);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`PTY ${id} spawn did not ack in ${timeoutMs}ms`)),
        timeoutMs,
      );
      spawnWaiters.set(id, (err) => {
        clearTimeout(timer);
        if (err) reject(new Error(err));
        else resolve();
      });
    });
  };

  const shutdown = async (): Promise<void> => {
    for (const id of [...sessions.keys()]) {
      sendCommand({ t: "close", id });
    }
    sessions.clear();
    try {
      host.stdin.end?.();
    } catch {
      // ignore
    }
    host.kill();
    await host.exited.catch(() => {});
  };

  return {
    spawn: spawnSession,
    write,
    resize,
    kill,
    close,
    get,
    list,
    readScrollback,
    subscribe,
    onExit,
    waitForExit,
    waitForSpawn,
    shutdown,
  };
}
