// src/web/terminal/terminal-store.ts
// Tiny always-loaded zustand store holding terminal metadata.
// Persistence is manual (write-through on every mutation) so unit tests
// can inject a fake Storage without pulling in zustand/middleware/persist.
import { create, type UseBoundStore, type StoreApi } from "zustand";

export type TerminalStatus = "running" | "exited";

export interface TerminalMeta {
  id: string;
  title: string;
  scriptName?: string;
  status: TerminalStatus;
  exitCode?: number;
}

export interface TerminalState {
  terminals: TerminalMeta[];
  activeId: string | null;
  addTerminal(meta: TerminalMeta): void;
  removeTerminal(id: string): void;
  setActive(id: string): void;
  updateTerminal(id: string, patch: Partial<TerminalMeta>): void;
  clearAll(): void;
}

export type TerminalStore = UseBoundStore<StoreApi<TerminalState>>;

const STORAGE_KEY = "diffscope:terminals:v1";

interface PersistShape {
  terminals: Pick<TerminalMeta, "id" | "title" | "scriptName">[];
  activeId: string | null;
}

function loadFromStorage(storage: Storage | undefined): PersistShape {
  if (!storage) return { terminals: [], activeId: null };
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return { terminals: [], activeId: null };
    const parsed = JSON.parse(raw) as PersistShape;
    if (!parsed || !Array.isArray(parsed.terminals)) {
      return { terminals: [], activeId: null };
    }
    return {
      terminals: parsed.terminals.filter(
        (t): t is PersistShape["terminals"][number] =>
          typeof t?.id === "string" && typeof t?.title === "string",
      ),
      activeId: typeof parsed.activeId === "string" ? parsed.activeId : null,
    };
  } catch {
    return { terminals: [], activeId: null };
  }
}

function writeToStorage(
  storage: Storage | undefined,
  state: Pick<TerminalState, "terminals" | "activeId">,
): void {
  if (!storage) return;
  try {
    const shape: PersistShape = {
      terminals: state.terminals.map((t) => ({
        id: t.id,
        title: t.title,
        scriptName: t.scriptName,
      })),
      activeId: state.activeId,
    };
    storage.setItem(STORAGE_KEY, JSON.stringify(shape));
  } catch {
    // quota / disabled — drop silently, matching settings.ts
  }
}

function clearStorage(storage: Storage | undefined): void {
  if (!storage) return;
  try {
    storage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

function pickNewActive(
  remaining: TerminalMeta[],
  removedId: string,
  previousActiveId: string | null,
): string | null {
  if (previousActiveId !== removedId) return previousActiveId;
  if (remaining.length === 0) return null;
  return remaining[0]?.id ?? null;
}

export interface CreateTerminalStoreOptions {
  storage?: Storage;
}

export function createTerminalStore(
  opts: CreateTerminalStoreOptions = {},
): TerminalStore {
  const storage = opts.storage;
  const initial = loadFromStorage(storage);

  const store = create<TerminalState>((set, get) => {
    const persist = () => {
      const { terminals, activeId } = get();
      writeToStorage(storage, { terminals, activeId });
    };

    return {
      terminals: initial.terminals.map((t) => ({
        ...t,
        // Persisted rows rehydrate as "running"; server attach will
        // overwrite with the real status.
        status: "running" as const,
      })),
      activeId: initial.activeId,

      addTerminal(meta) {
        set({
          terminals: [...get().terminals, meta],
          activeId: meta.id,
        });
        persist();
      },

      removeTerminal(id) {
        const before = get();
        const next = before.terminals.filter((t) => t.id !== id);
        const nextActive = pickNewActive(next, id, before.activeId);
        set({ terminals: next, activeId: nextActive });
        persist();
      },

      setActive(id) {
        if (!get().terminals.some((t) => t.id === id)) return;
        set({ activeId: id });
        persist();
      },

      updateTerminal(id, patch) {
        set({
          terminals: get().terminals.map((t) =>
            t.id === id ? { ...t, ...patch } : t,
          ),
        });
        // Persist only when a persisted field changes (title / scriptName).
        // status/exitCode are server-owned and re-derived on attach.
        if ("title" in patch || "scriptName" in patch) persist();
      },

      clearAll() {
        set({ terminals: [], activeId: null });
        clearStorage(storage);
      },
    };
  });

  return store;
}

// Singleton used by the real app. Tests that need isolation can build their
// own with `createTerminalStore({ storage: fakeStorage })`.
// globalThis is used (rather than `window`) so this file typechecks under
// both the server tsconfig (no DOM lib) and the web tsconfig (DOM lib).
const defaultStorage = (globalThis as { localStorage?: Storage }).localStorage;

export const useTerminalStore: TerminalStore = createTerminalStore({
  storage: defaultStorage,
});
