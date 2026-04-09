// src/web/terminal/terminal-drawer.tsx
// Lazy-loaded drawer body. Imports xterm.js transitively via terminal-pane,
// so this whole file lives in a separate Vite code-split chunk that's
// loaded only when the drawer first opens.
import { useEffect, useRef, useState } from "react";
import { useTerminalStore, type TerminalMeta } from "./terminal-store";
import { TerminalPane } from "./terminal-pane";
import { TerminalTabStrip, type PendingSpawn } from "./terminal-tab-strip";
import { attachIds } from "./use-terminal-ws";
import { useSettings } from "../settings";

export default function TerminalDrawer() {
  const terminals = useTerminalStore((s) => s.terminals);
  const activeId = useTerminalStore((s) => s.activeId);
  const addTerminal = useTerminalStore((s) => s.addTerminal);
  const noticeAck = useSettings((s) => s.terminalNoticeAcknowledged);

  // Track which ids were spawned THIS mount (vs rehydrated from storage).
  // Refs rather than state so mutating them doesn't trigger re-renders and
  // because we want the same identity across renders.
  const justSpawned = useRef<Set<string>>(new Set());
  const spawnRequests = useRef<Map<string, PendingSpawn>>(new Map());

  // On first mount: attach any persisted ids. If none, open a fresh shell
  // so the drawer isn't empty on first use.
  useEffect(() => {
    const persistedIds = useTerminalStore.getState().terminals.map((t) => t.id);
    if (persistedIds.length > 0) {
      attachIds(persistedIds);
    } else {
      const id = crypto.randomUUID();
      const req: PendingSpawn = { id, kind: "shell", title: "shell" };
      justSpawned.current.add(id);
      spawnRequests.current.set(id, req);
      addTerminal({ id, title: req.title, status: "running" });
    }
  }, [addTerminal]);

  const handleRequestSpawn = (req: PendingSpawn) => {
    justSpawned.current.add(req.id);
    spawnRequests.current.set(req.id, req);
    addTerminal({
      id: req.id,
      title: req.title,
      scriptName: req.scriptName,
      status: "running",
    });
  };

  return (
    <div className="flex h-full w-full flex-col overflow-hidden border-t border-border bg-bg">
      {!noticeAck && <SafetyNotice />}
      <TerminalTabStrip onRequestSpawn={handleRequestSpawn} />
      <div className="relative min-h-0 flex-1">
        {terminals.map((t) => (
          <PaneSlot
            key={t.id}
            terminal={t}
            hidden={t.id !== activeId}
            spawnOnMount={justSpawned.current.has(t.id)}
            spawnRequest={spawnRequests.current.get(t.id)}
          />
        ))}
        {terminals.length === 0 && (
          <div className="flex h-full items-center justify-center text-[12px] text-fg-subtle">
            No terminals open.
          </div>
        )}
      </div>
    </div>
  );
}

function PaneSlot({
  terminal,
  hidden,
  spawnOnMount,
  spawnRequest,
}: {
  terminal: TerminalMeta;
  hidden: boolean;
  spawnOnMount: boolean;
  spawnRequest?: PendingSpawn;
}) {
  // useState with a lazy initializer guarantees the pane element is
  // created exactly once per PaneSlot mount — the TerminalPane inside
  // owns its xterm instance and we never want a remount to destroy it.
  const [pane] = useState(() => {
    if (spawnOnMount && spawnRequest) {
      const req =
        spawnRequest.kind === "shell"
          ? { kind: "shell" as const }
          : {
              kind: "script" as const,
              scriptName: spawnRequest.scriptName!,
              title: spawnRequest.title,
            };
      return <TerminalPane id={terminal.id} spawnOnMount={true} spawnRequest={req} />;
    }
    return <TerminalPane id={terminal.id} spawnOnMount={false} />;
  });

  return (
    <div
      className="absolute inset-0"
      style={hidden ? { visibility: "hidden", pointerEvents: "none" } : undefined}
    >
      {pane}
    </div>
  );
}

function SafetyNotice() {
  const ack = () =>
    useSettings.getState().set({ terminalNoticeAcknowledged: true });
  return (
    <div className="flex items-start gap-3 border-b border-border bg-accent/10 px-3 py-2 text-[12px] text-fg">
      <span className="leading-tight">
        <strong>Heads up:</strong> Terminals in diffscope run real shell
        commands. The read-only guarantee in the README applies to the viewer,
        not this pane.
      </span>
      <button
        type="button"
        onClick={ack}
        className="ml-auto shrink-0 rounded border border-border bg-bg-elevated px-2 py-0.5 text-fg-muted hover:text-fg"
      >
        Got it
      </button>
    </div>
  );
}
