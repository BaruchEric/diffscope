// test/terminal/terminal-store.test.ts
// Unit tests for the frontend terminal metadata store. Pure TS — no DOM.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  createTerminalStore,
  type TerminalStore,
} from "../../src/web/terminal/terminal-store";

function makeLocalStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear() {
      map.clear();
    },
    getItem(k) {
      return map.get(k) ?? null;
    },
    key(i) {
      return [...map.keys()][i] ?? null;
    },
    removeItem(k) {
      map.delete(k);
    },
    setItem(k, v) {
      map.set(k, v);
    },
  } as Storage;
}

describe("terminal store", () => {
  let store: TerminalStore;
  let storage: Storage;

  beforeEach(() => {
    storage = makeLocalStorage();
    store = createTerminalStore({ storage });
  });

  afterEach(() => {
    storage.clear();
  });

  test("starts empty", () => {
    expect(store.getState().terminals).toEqual([]);
    expect(store.getState().activeId).toBeNull();
  });

  test("addTerminal appends and activates by default", () => {
    store.getState().addTerminal({
      id: "a",
      title: "shell",
      status: "running",
    });
    expect(store.getState().terminals).toHaveLength(1);
    expect(store.getState().activeId).toBe("a");
  });

  test("removeTerminal drops it and picks a new active if the removed was active", () => {
    const { addTerminal, removeTerminal } = store.getState();
    addTerminal({ id: "a", title: "a", status: "running" });
    addTerminal({ id: "b", title: "b", status: "running" });
    addTerminal({ id: "c", title: "c", status: "running" });
    store.getState().setActive("b");
    removeTerminal("b");
    expect(store.getState().terminals.map((t) => t.id)).toEqual(["a", "c"]);
    // Picks the nearest neighbor (next tab) rather than jumping to the first
    expect(store.getState().activeId).toBe("c");
  });

  test("updateTerminal patches status and exitCode", () => {
    store.getState().addTerminal({ id: "a", title: "a", status: "running" });
    store.getState().updateTerminal("a", { status: "exited", exitCode: 0 });
    const t = store.getState().terminals[0]!;
    expect(t.status).toBe("exited");
    expect(t.exitCode).toBe(0);
  });

  test("persists metadata to storage and rehydrates on fresh store", () => {
    store.getState().addTerminal({
      id: "abc",
      title: "bun dev",
      scriptName: "dev",
      status: "running",
    });
    store.getState().setActive("abc");

    const next = createTerminalStore({ storage });
    const terms = next.getState().terminals;
    expect(terms).toHaveLength(1);
    expect(terms[0]?.id).toBe("abc");
    expect(terms[0]?.title).toBe("bun dev");
    expect(terms[0]?.scriptName).toBe("dev");
    // status is not persisted — rehydrated rows are optimistic "running"
    // until the server's attach replay reports the real status.
    expect(terms[0]?.status).toBe("running");
    expect(next.getState().activeId).toBe("abc");
  });

  test("clearAll empties the store and storage", () => {
    store.getState().addTerminal({ id: "a", title: "a", status: "running" });
    store.getState().addTerminal({ id: "b", title: "b", status: "running" });
    store.getState().clearAll();
    expect(store.getState().terminals).toEqual([]);
    expect(store.getState().activeId).toBeNull();
    expect(storage.getItem("diffscope:terminals:v1")).toBeNull();
  });
});
