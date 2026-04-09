// src/web/terminal/terminal-tab-strip.tsx
// Tab row for the terminal drawer. `+` button opens a dropdown of the
// merged predefined-script list (fetched fresh on every dropdown open).
import { useCallback, useEffect, useRef, useState } from "react";
import { useTerminalStore, type TerminalMeta } from "./terminal-store";
import { fetchScripts } from "./terminal-api";
import type { ScriptEntry, ScriptsResponse } from "../../shared/terminal-protocol";

export interface PendingSpawn {
  id: string;
  kind: "shell" | "script";
  scriptName?: string;
  title: string;
}

export interface TerminalTabStripProps {
  /** Called when the user picks an entry from the + dropdown. The drawer
   *  is responsible for mounting a new <TerminalPane id=... spawnOnMount /> */
  onRequestSpawn(spawn: PendingSpawn): void;
}

export function TerminalTabStrip({ onRequestSpawn }: TerminalTabStripProps) {
  const terminals = useTerminalStore((s) => s.terminals);
  const activeId = useTerminalStore((s) => s.activeId);
  const setActive = useTerminalStore((s) => s.setActive);
  const removeTerminal = useTerminalStore((s) => s.removeTerminal);

  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [scripts, setScripts] = useState<ScriptsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const openDropdown = useCallback(() => {
    setDropdownOpen(true);
    setLoading(true);
    fetchScripts()
      .then((r) => setScripts(r))
      .catch(() =>
        setScripts({ entries: [], warning: "Failed to load scripts" }),
      )
      .finally(() => setLoading(false));
  }, []);

  // Close the dropdown on outside click.
  useEffect(() => {
    if (!dropdownOpen) return;
    const onClick = (e: MouseEvent) => {
      if (!dropdownRef.current) return;
      if (!dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    window.addEventListener("mousedown", onClick);
    return () => window.removeEventListener("mousedown", onClick);
  }, [dropdownOpen]);

  const handleNewShell = () => {
    setDropdownOpen(false);
    onRequestSpawn({
      id: crypto.randomUUID(),
      kind: "shell",
      title: "shell",
    });
  };

  const handlePickScript = (entry: ScriptEntry) => {
    setDropdownOpen(false);
    onRequestSpawn({
      id: crypto.randomUUID(),
      kind: "script",
      scriptName: entry.name,
      title: entry.name,
    });
  };

  const closeTab = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    removeTerminal(id);
  };

  return (
    <div className="flex h-8 items-center border-b border-border bg-bg-elevated px-1 text-[12px]">
      <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto">
        {terminals.map((t) => (
          <TabButton
            key={t.id}
            terminal={t}
            active={t.id === activeId}
            onClick={() => setActive(t.id)}
            onClose={(e) => closeTab(e, t.id)}
          />
        ))}
      </div>
      <div className="relative shrink-0" ref={dropdownRef}>
        <button
          type="button"
          onClick={dropdownOpen ? () => setDropdownOpen(false) : openDropdown}
          className="rounded px-2 py-0.5 text-fg-muted hover:bg-surface-hover hover:text-fg"
          aria-label="New terminal"
          title="New terminal"
        >
          +
        </button>
        {dropdownOpen && (
          <Dropdown
            loading={loading}
            scripts={scripts}
            onNewShell={handleNewShell}
            onPickScript={handlePickScript}
          />
        )}
      </div>
    </div>
  );
}

function TabButton({
  terminal,
  active,
  onClick,
  onClose,
}: {
  terminal: TerminalMeta;
  active: boolean;
  onClick(): void;
  onClose(e: React.MouseEvent): void;
}) {
  const exited = terminal.status === "exited";
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group flex shrink-0 items-center gap-1.5 rounded px-2 py-0.5 ${
        active
          ? "bg-surface-hover text-fg"
          : "text-fg-muted hover:bg-surface-hover/50"
      } ${exited ? "opacity-60" : ""}`}
      title={exited ? `exited (${terminal.exitCode ?? "?"})` : terminal.title}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${
          exited ? "bg-fg-subtle" : "bg-accent"
        }`}
      />
      <span className={`truncate ${exited ? "line-through" : ""}`}>
        {terminal.title}
      </span>
      <span
        role="button"
        aria-label={`Close ${terminal.title}`}
        tabIndex={-1}
        onClick={onClose}
        className="rounded px-1 text-fg-subtle opacity-0 hover:text-fg group-hover:opacity-100"
      >
        ×
      </span>
    </button>
  );
}

function Dropdown({
  loading,
  scripts,
  onNewShell,
  onPickScript,
}: {
  loading: boolean;
  scripts: ScriptsResponse | null;
  onNewShell(): void;
  onPickScript(e: ScriptEntry): void;
}) {
  const byGroup = (group: ScriptEntry["group"]) =>
    (scripts?.entries ?? []).filter((e) => e.group === group);

  return (
    <div className="absolute right-0 top-full z-50 mt-1 min-w-[260px] max-w-[420px] overflow-hidden rounded-md border border-border bg-bg-elevated shadow-soft">
      {scripts?.warning && (
        <div className="border-b border-border px-3 py-1.5 text-[11px] text-accent">
          ⚠ {scripts.warning}
        </div>
      )}
      <button
        type="button"
        onClick={onNewShell}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-fg hover:bg-surface-hover"
      >
        <span>New shell</span>
      </button>
      {loading && (
        <div className="px-3 py-1.5 text-[11px] text-fg-muted">Loading…</div>
      )}
      <DropdownGroup
        label="package.json scripts"
        entries={byGroup("package")}
        onPick={onPickScript}
      />
      <DropdownGroup
        label="Built-ins"
        entries={byGroup("builtin")}
        onPick={onPickScript}
      />
      <DropdownGroup
        label="User scripts"
        entries={byGroup("user")}
        onPick={onPickScript}
      />
    </div>
  );
}

function DropdownGroup({
  label,
  entries,
  onPick,
}: {
  label: string;
  entries: ScriptEntry[];
  onPick(e: ScriptEntry): void;
}) {
  if (entries.length === 0) return null;
  return (
    <div className="border-t border-border">
      <div className="px-3 py-1 text-[10px] uppercase tracking-wider text-fg-subtle">
        {label}
      </div>
      {entries.map((entry) => (
        <button
          key={`${entry.group}:${entry.name}`}
          type="button"
          onClick={() => onPick(entry)}
          className="flex w-full flex-col gap-0.5 px-3 py-1 text-left hover:bg-surface-hover"
        >
          <span className="text-fg">{entry.name}</span>
          <span className="truncate font-mono text-[10px] text-fg-subtle">
            {entry.command}
          </span>
        </button>
      ))}
    </div>
  );
}
