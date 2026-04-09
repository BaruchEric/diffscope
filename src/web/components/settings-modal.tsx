// src/web/components/settings-modal.tsx
import { useEffect } from "react";
import { useStore } from "../store";
import {
  useSettings,
  type Theme,
  type Editor,
  type DefaultTab,
  type FileListMode,
} from "../settings";

const THEMES: { value: Theme; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

const DEFAULT_TABS: { value: DefaultTab; label: string }[] = [
  { value: "last-used", label: "Last used" },
  { value: "working-tree", label: "Working Tree" },
  { value: "history", label: "History" },
  { value: "branches", label: "Branches" },
  { value: "stashes", label: "Stashes" },
];

const EDITORS: { value: Editor; label: string }[] = [
  { value: "none", label: "None" },
  { value: "vscode", label: "VS Code" },
  { value: "cursor", label: "Cursor" },
  { value: "zed", label: "Zed" },
  { value: "idea", label: "IntelliJ" },
  { value: "subl", label: "Sublime Text" },
];

const LIST_MODES: { value: FileListMode; label: string }[] = [
  { value: "flat", label: "Flat" },
  { value: "tree", label: "Tree" },
];

export function SettingsModal() {
  const open = useStore((s) => s.settingsOpen);
  const close = useStore((s) => s.closeSettings);

  const theme = useSettings((s) => s.theme);
  const defaultTab = useSettings((s) => s.defaultTab);
  const fileListMode = useSettings((s) => s.fileListMode);
  const editor = useSettings((s) => s.editor);
  const blameStickyOn = useSettings((s) => s.blameStickyOn);
  const set = useSettings((s) => s.set);
  const reset = useSettings((s) => s.reset);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close();
      }
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () =>
      window.removeEventListener("keydown", onKey, { capture: true });
  }, [open, close]);

  if (!open) return null;

  return (
    <div
      onClick={close}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-[420px] rounded-lg bg-white p-6 shadow-xl dark:bg-neutral-900"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Settings</h2>
          <button
            onClick={close}
            className="text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100"
            aria-label="Close settings"
          >
            ×
          </button>
        </div>

        <div className="space-y-4">
          <Row label="Theme">
            <select
              value={theme}
              onChange={(e) => set({ theme: e.target.value as Theme })}
              className="rounded border border-neutral-300 bg-white px-2 py-1 dark:border-neutral-700 dark:bg-neutral-800"
            >
              {THEMES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </Row>

          <Row label="Default tab">
            <select
              value={defaultTab}
              onChange={(e) =>
                set({ defaultTab: e.target.value as DefaultTab })
              }
              className="rounded border border-neutral-300 bg-white px-2 py-1 dark:border-neutral-700 dark:bg-neutral-800"
            >
              {DEFAULT_TABS.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </Row>

          <Row label="File list view">
            <select
              value={fileListMode}
              onChange={(e) =>
                set({ fileListMode: e.target.value as FileListMode })
              }
              className="rounded border border-neutral-300 bg-white px-2 py-1 dark:border-neutral-700 dark:bg-neutral-800"
            >
              {LIST_MODES.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </Row>

          <Row label="Open in editor">
            <select
              value={editor}
              onChange={(e) => set({ editor: e.target.value as Editor })}
              className="rounded border border-neutral-300 bg-white px-2 py-1 dark:border-neutral-700 dark:bg-neutral-800"
            >
              {EDITORS.map((e2) => (
                <option key={e2.value} value={e2.value}>
                  {e2.label}
                </option>
              ))}
            </select>
          </Row>

          <Row label="Sticky blame">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={blameStickyOn}
                onChange={(e) => set({ blameStickyOn: e.target.checked })}
              />
              <span className="text-sm text-neutral-600 dark:text-neutral-400">
                Carry blame toggle to next file
              </span>
            </label>
          </Row>

          <div className="border-t border-neutral-200 pt-4 dark:border-neutral-800">
            <button
              onClick={() => reset(["fileListWidthPx"])}
              className="rounded border border-neutral-300 px-3 py-1 text-sm hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
            >
              Reset pane widths
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm font-medium">{label}</span>
      {children}
    </div>
  );
}
