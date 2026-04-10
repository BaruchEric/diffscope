// test/terminal/pty.test.ts
// Integration tests against the pty-host subprocess (which in turn uses
// real node-pty under Node). These spawn real processes and require `node`
// on PATH. If the host can't launch for any reason the suite will fail —
// that's the right outcome, because Task 1 already committed diffscope to
// this architecture.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createPtyRegistry, type PtyRegistry } from "../../src/server/terminal/pty";

describe("PTY registry", () => {
  let registry: PtyRegistry;

  beforeEach(() => {
    registry = createPtyRegistry();
  });

  afterEach(async () => {
    await registry.shutdown();
  });

  test("spawn and receive output", async () => {
    const { id } = registry.spawn({
      command: "/bin/sh",
      args: ["-c", "echo diffscope-hello"],
      cwd: process.cwd(),
      cols: 80,
      rows: 24,
      title: "echo",
    });
    await registry.waitForSpawn(id);

    const code = await registry.waitForExit(id, 3000);
    expect(code).toBe(0);

    const scrollback = registry.readScrollback(id);
    expect(new TextDecoder().decode(scrollback)).toContain("diffscope-hello");
  });

  test("write forwards input to the PTY", async () => {
    const { id } = registry.spawn({
      command: "/bin/sh",
      args: ["-c", "read line; echo got:$line"],
      cwd: process.cwd(),
      cols: 80,
      rows: 24,
      title: "read",
    });
    await registry.waitForSpawn(id);

    registry.write(id, new TextEncoder().encode("ping\n"));
    const code = await registry.waitForExit(id, 3000);
    expect(code).toBe(0);

    const out = new TextDecoder().decode(registry.readScrollback(id));
    expect(out).toContain("got:ping");
  });

  test("resize updates cols/rows", async () => {
    const { id } = registry.spawn({
      command: "/bin/sh",
      args: ["-c", "sleep 0.3"],
      cwd: process.cwd(),
      cols: 80,
      rows: 24,
      title: "resize",
    });
    await registry.waitForSpawn(id);
    registry.resize(id, 120, 40);
    const code = await registry.waitForExit(id, 3000);
    expect(code).toBe(0);
    const session = registry.get(id);
    expect(session?.cols).toBe(120);
    expect(session?.rows).toBe(40);
  });

  test("scrollback is capped near ~1 MiB", async () => {
    // Generate well over 1 MiB of output (2048 × ~1024 bytes = ~2 MiB).
    const { id } = registry.spawn({
      command: "/bin/sh",
      args: [
        "-c",
        "for i in $(seq 1 2048); do head -c 1024 /dev/zero | tr '\\0' 'A'; echo; done",
      ],
      cwd: process.cwd(),
      cols: 80,
      rows: 24,
      title: "flood",
    });
    await registry.waitForSpawn(id);
    await registry.waitForExit(id, 10_000);
    const sb = registry.readScrollback(id);
    // Cap is 1 MiB = 1_048_576 bytes; allow generous slack since PTY
    // chunks arrive in unknown sizes.
    expect(sb.byteLength).toBeLessThanOrEqual(1_400_000);
    expect(sb.byteLength).toBeGreaterThan(800_000);
  });

  test("subscribers receive live data", async () => {
    const chunks: string[] = [];
    const { id } = registry.spawn({
      command: "/bin/sh",
      args: ["-c", "echo one; sleep 0.05; echo two"],
      cwd: process.cwd(),
      cols: 80,
      rows: 24,
      title: "stream",
    });
    await registry.waitForSpawn(id);
    const unsub = registry.subscribe(id, (data) => {
      chunks.push(new TextDecoder().decode(data));
    });
    const code = await registry.waitForExit(id, 3000);
    expect(code).toBe(0);
    unsub();
    const joined = chunks.join("");
    expect(joined).toContain("one");
    expect(joined).toContain("two");
  });

  test("kill terminates a running process", async () => {
    const { id } = registry.spawn({
      command: "/bin/sh",
      args: ["-c", "sleep 30"],
      cwd: process.cwd(),
      cols: 80,
      rows: 24,
      title: "sleep",
    });
    await registry.waitForSpawn(id);
    registry.kill(id);
    const code = await registry.waitForExit(id, 4000);
    expect(code).not.toBeNull();
  });

  test("close() after exit removes the session", async () => {
    const { id } = registry.spawn({
      command: "/bin/sh",
      args: ["-c", "true"],
      cwd: process.cwd(),
      cols: 80,
      rows: 24,
      title: "true",
    });
    await registry.waitForSpawn(id);
    await registry.waitForExit(id, 3000);
    registry.close(id);
    expect(registry.get(id)).toBeUndefined();
  });
});
