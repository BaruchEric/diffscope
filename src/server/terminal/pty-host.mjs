#!/usr/bin/env node
// src/server/terminal/pty-host.mjs
// Node.js helper that runs node-pty and speaks a line-delimited JSON
// protocol over stdin/stdout with its parent (Bun). This indirection
// exists because node-pty's internal read loop fails under Bun 1.2 with
// ENXIO on the PTY master fd (works fine under Node). See the plan's
// Task 1 note.
//
// Protocol (one JSON object per line):
//
// parent → host (commands):
//   { t: "spawn",  id, command, args, cwd, cols, rows, env? }
//   { t: "write",  id, data }         // data is base64
//   { t: "resize", id, cols, rows }
//   { t: "kill",   id, signal? }      // defaults to SIGHUP
//   { t: "close",  id }               // frees session (kills if still running)
//
// host → parent (events):
//   { t: "ready" }                    // sent once at startup
//   { t: "spawned", id, pid }
//   { t: "data",    id, data }        // data is base64
//   { t: "exit",    id, exitCode, signal }
//   { t: "error",   id?, message }
import * as pty from "node-pty";
import { createInterface } from "node:readline";

const sessions = new Map();

function emit(obj) {
  process.stdout.write(JSON.stringify(obj) + "\n");
}

function handleCommand(cmd) {
  switch (cmd.t) {
    case "spawn": {
      if (sessions.has(cmd.id)) {
        emit({ t: "error", id: cmd.id, message: "id already in use" });
        return;
      }
      try {
        const proc = pty.spawn(cmd.command, cmd.args ?? [], {
          name: "xterm-256color",
          cols: cmd.cols ?? 80,
          rows: cmd.rows ?? 24,
          cwd: cmd.cwd ?? process.cwd(),
          env: cmd.env ?? process.env,
        });
        sessions.set(cmd.id, proc);
        proc.onData((d) => {
          // d is a utf8 string from node-pty. Encode to bytes before b64
          // so arbitrary binary output (e.g. ANSI escapes, image bytes)
          // survives the round-trip.
          emit({
            t: "data",
            id: cmd.id,
            data: Buffer.from(d, "utf8").toString("base64"),
          });
        });
        proc.onExit(({ exitCode, signal }) => {
          sessions.delete(cmd.id);
          emit({
            t: "exit",
            id: cmd.id,
            exitCode: exitCode ?? null,
            signal: signal ?? null,
          });
        });
        emit({ t: "spawned", id: cmd.id, pid: proc.pid });
      } catch (err) {
        emit({
          t: "error",
          id: cmd.id,
          message: String(err && err.message ? err.message : err),
        });
      }
      return;
    }
    case "write": {
      const p = sessions.get(cmd.id);
      if (!p) return;
      try {
        p.write(Buffer.from(cmd.data, "base64").toString("utf8"));
      } catch {
        // dying PTY — next onExit handles it
      }
      return;
    }
    case "resize": {
      const p = sessions.get(cmd.id);
      if (!p) return;
      try {
        p.resize(cmd.cols, cmd.rows);
      } catch {
        // ignore
      }
      return;
    }
    case "kill": {
      const p = sessions.get(cmd.id);
      if (!p) return;
      try {
        p.kill(cmd.signal ?? "SIGHUP");
      } catch {
        // ignore
      }
      return;
    }
    case "close": {
      const p = sessions.get(cmd.id);
      if (!p) return;
      try {
        p.kill("SIGHUP");
      } catch {
        // ignore
      }
      sessions.delete(cmd.id);
      return;
    }
  }
}

const rl = createInterface({ input: process.stdin });
rl.on("line", (line) => {
  if (!line) return;
  try {
    handleCommand(JSON.parse(line));
  } catch (err) {
    emit({
      t: "error",
      message: "bad command: " + String(err && err.message ? err.message : err),
    });
  }
});

// When parent closes stdin (or dies), tear down every child and exit.
rl.on("close", () => {
  for (const [, p] of sessions) {
    try {
      p.kill("SIGHUP");
    } catch {
      // ignore
    }
  }
  process.exit(0);
});

process.on("SIGTERM", () => process.exit(0));
process.on("SIGINT", () => process.exit(0));

emit({ t: "ready" });
