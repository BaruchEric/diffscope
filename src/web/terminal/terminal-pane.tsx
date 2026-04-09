// src/web/terminal/terminal-pane.tsx
// One xterm.js instance per terminal id. Mounted once per id and kept
// alive across tab switches (parent hides it via CSS when inactive).
import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";
import { sendFrame, subscribe } from "./use-terminal-ws";
import { useTerminalStore } from "./terminal-store";
import { useSettings } from "../settings";
import { currentXtermTheme } from "./xterm-theme";
import type { TerminalServerFrame } from "../../shared/terminal-protocol";

export interface TerminalPaneProps {
  id: string;
  /** True for brand-new panes (spawn on mount). False for rehydrated ones
   *  that should rely on the attach/replay flow. */
  spawnOnMount: boolean;
  /** Present only when spawnOnMount is true. */
  spawnRequest?:
    | { kind: "shell" }
    | { kind: "script"; scriptName: string; title: string };
}

export function TerminalPane({ id, spawnOnMount, spawnRequest }: TerminalPaneProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const themeId = useSettings((s) => s.theme);

  // Mount once per id.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const term = new Terminal({
      cursorBlink: true,
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
      fontSize: 13,
      theme: currentXtermTheme(),
      scrollback: 5000,
      allowProposedApi: true,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon());
    term.open(container);
    termRef.current = term;
    fitRef.current = fit;
    try {
      fit.fit();
    } catch {
      // Container may not have layout yet; the ResizeObserver below catches up.
    }

    const { cols, rows } = term;

    // Single subscription — all server frames for this id route through here.
    const unsub = subscribe(id, (frame: TerminalServerFrame) => {
      if (frame.op === "replay") {
        const bytes = Uint8Array.from(atob(frame.b64), (c) => c.charCodeAt(0));
        term.write(bytes);
        return;
      }
      if (frame.op === "data") {
        const bytes = Uint8Array.from(atob(frame.b64), (c) => c.charCodeAt(0));
        term.write(bytes);
        return;
      }
      if (frame.op === "spawned") {
        // Server may override the title (e.g. from the resolved script
        // name); keep the tab strip in sync.
        useTerminalStore.getState().updateTerminal(id, { title: frame.title });
        return;
      }
      if (frame.op === "exit") {
        useTerminalStore.getState().updateTerminal(id, {
          status: "exited",
          exitCode: frame.code ?? undefined,
        });
        term.write(
          `\r\n\x1b[2m[process exited${
            frame.code !== null ? ` with code ${frame.code}` : ""
          }]\x1b[0m\r\n`,
        );
        return;
      }
      if (frame.op === "gone") {
        useTerminalStore.getState().removeTerminal(id);
        return;
      }
    });

    // Spawn brand-new panes; rehydrated panes rely on the attach/replay
    // the WS hook already dispatched.
    if (spawnOnMount && spawnRequest) {
      if (spawnRequest.kind === "shell") {
        sendFrame({
          op: "spawn",
          id,
          kind: "shell",
          cols,
          rows,
          title: "shell",
        });
      } else {
        sendFrame({
          op: "spawn",
          id,
          kind: "script",
          scriptName: spawnRequest.scriptName,
          cols,
          rows,
          title: spawnRequest.title,
        });
      }
    }

    // Forward user keystrokes.
    const keyDisposable = term.onData((data) => {
      const bytes = new TextEncoder().encode(data);
      sendFrame({
        op: "data",
        id,
        b64: btoa(String.fromCharCode(...bytes)),
      });
    });

    // Resize on container changes.
    const observer = new ResizeObserver(() => {
      try {
        fit.fit();
        sendFrame({ op: "resize", id, cols: term.cols, rows: term.rows });
      } catch {
        // container may be hidden — skip
      }
    });
    observer.observe(container);

    return () => {
      observer.disconnect();
      keyDisposable.dispose();
      unsub();
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
    // spawnOnMount/spawnRequest are only read on first mount; re-running
    // this effect would re-spawn the PTY, which we never want.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Re-apply theme when the theme setting changes.
  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    term.options.theme = currentXtermTheme();
  }, [themeId]);

  return <div ref={containerRef} className="h-full w-full bg-bg" />;
}
