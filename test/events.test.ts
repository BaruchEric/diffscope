// test/events.test.ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createTempRepo, type TempRepo } from "./helpers/temp-repo";
import { createRepo } from "../src/server/repo";
import { createEventHub } from "../src/server/events";
import type { SseEvent } from "../src/shared/types";

const waitForEvent = (
  events: SseEvent[],
  predicate: (e: SseEvent) => boolean,
  timeoutMs = 3000,
): Promise<SseEvent> =>
  new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = () => {
      const found = events.find(predicate);
      if (found) return resolve(found);
      if (Date.now() - start > timeoutMs) return reject(new Error("timeout waiting for event"));
      setTimeout(tick, 50);
    };
    tick();
  });

describe("events + watcher integration", () => {
  let temp: TempRepo;
  beforeEach(() => {
    temp = createTempRepo();
    temp.write("a.ts", "original\n");
    temp.git("add", ".");
    temp.git("commit", "-m", "init");
  });
  afterEach(() => {
    temp.cleanup();
  });

  test("writing a file emits a file-updated event", async () => {
    const repo = createRepo(temp.root);
    const hub = createEventHub(repo);
    await hub.start();
    const received: SseEvent[] = [];
    hub.subscribe((e) => received.push(e));

    temp.write("a.ts", "modified\n");

    const event = await waitForEvent(
      received,
      (e) => e.type === "file-updated" && e.path === "a.ts",
    );
    expect(event.type).toBe("file-updated");
    await hub.stop();
  });

  test("rapid successive writes coalesce into one update", async () => {
    const repo = createRepo(temp.root);
    const hub = createEventHub(repo);
    await hub.start();
    const received: SseEvent[] = [];
    hub.subscribe((e) => received.push(e));

    for (let i = 0; i < 10; i++) {
      temp.write("a.ts", `v${i}\n`);
    }

    await waitForEvent(received, (e) => e.type === "file-updated" && e.path === "a.ts");
    // Give the debounce a moment to prove no extra events fire
    await new Promise((r) => setTimeout(r, 200));
    const updates = received.filter(
      (e) => e.type === "file-updated" && e.path === "a.ts",
    );
    expect(updates.length).toBeLessThanOrEqual(2); // allow one trailing edge case
    await hub.stop();
  });

  test("editing .gitignore re-evaluates untracked files", async () => {
    temp.write("ignored.log", "trace\n");
    const repo = createRepo(temp.root);
    const hub = createEventHub(repo);
    await hub.start();
    const received: SseEvent[] = [];
    hub.subscribe((e) => received.push(e));

    temp.write(".gitignore", "*.log\n");

    // After gitignore edits, ignored.log should no longer appear as untracked
    await new Promise((r) => setTimeout(r, 300));
    const status = await repo.getStatus();
    expect(status.find((f) => f.path === "ignored.log")).toBeUndefined();
    await hub.stop();
  });
});
