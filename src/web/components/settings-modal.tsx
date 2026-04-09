// src/web/components/settings-modal.tsx
import { useStore } from "../store";
import {
  useSettings,
  type ThemeId,
  type Editor,
  type DefaultTab,
  type FileListMode,
  THEME_CARDS,
  resolveThemeId,
} from "../settings";
import { Modal } from "./modal";
import { usePrefersDark } from "../lib/use-prefers-dark";

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

  // Esc is handled centrally by shortcuts.tsx (priority chain: settings →
  // palette → filter → focus), so no local listener is needed here.
  return (
    <Modal
      open={open}
      onClose={close}
      labelledBy="settings-modal-title"
      ariaLabel="Settings"
      cardClassName="w-[520px] rounded-lg border border-border bg-bg-elevated p-6 shadow-soft"
    >
      <div className="mb-5 flex items-center justify-between">
        <h2 id="settings-modal-title" className="font-display text-lg text-fg">
          Settings
        </h2>
        <button
          onClick={close}
          className="text-fg-muted hover:text-fg"
          aria-label="Close settings"
        >
          ×
        </button>
      </div>

      <div className="space-y-5">
        <div>
          <div className="mb-2 text-xs font-medium uppercase tracking-wider text-fg-subtle">
            Theme
          </div>
          <ThemePicker current={theme} onSelect={(id) => set({ theme: id })} />
        </div>

        <Row label="Default tab">
          <select
            value={defaultTab}
            onChange={(e) =>
              set({ defaultTab: e.target.value as DefaultTab })
            }
            className="rounded border border-border-strong bg-surface px-2 py-1 text-fg focus:border-accent focus:outline-none"
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
            className="rounded border border-border-strong bg-surface px-2 py-1 text-fg focus:border-accent focus:outline-none"
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
            className="rounded border border-border-strong bg-surface px-2 py-1 text-fg focus:border-accent focus:outline-none"
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
              className="accent-accent"
            />
            <span className="text-sm text-fg-muted">
              Carry blame toggle to next file
            </span>
          </label>
        </Row>

        <div className="border-t border-border pt-4">
          <button
            onClick={() => reset(["fileListWidthPx"])}
            className="rounded border border-border-strong px-3 py-1 text-sm text-fg-muted hover:border-accent hover:text-fg"
          >
            Reset pane widths
          </button>
        </div>
      </div>
    </Modal>
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
      <span className="text-sm font-medium text-fg">{label}</span>
      {children}
    </div>
  );
}

interface ThemePickerProps {
  current: ThemeId;
  onSelect: (id: ThemeId) => void;
}

function ThemePicker({ current, onSelect }: ThemePickerProps) {
  // For the Auto card, render the preview using whichever theme it would
  // currently resolve to. `usePrefersDark` subscribes to the OS preference
  // so a live OS theme flip while the modal is open updates the Auto swatch.
  const prefersDark = usePrefersDark();
  return (
    <div className="grid grid-cols-2 gap-3">
      {THEME_CARDS.map((t) => {
        const isActive = current === t.id;
        const previewId = resolveThemeId(t.id, prefersDark);
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => onSelect(t.id)}
            className={
              "group overflow-hidden rounded-lg border-2 text-left transition " +
              (isActive
                ? "border-accent shadow-soft"
                : "border-border hover:border-border-strong")
            }
          >
            <div data-theme={previewId} className="h-20 w-full bg-bg p-2">
              <ThemePreview />
            </div>
            <div className="border-t border-border bg-surface p-3">
              <div className="font-display text-sm text-fg">{t.label}</div>
              <div className="text-xs text-fg-muted">{t.description}</div>
            </div>
          </button>
        );
      })}
    </div>
  );
}

/**
 * Miniature render of diffscope's diff view: header bar + one add row +
 * one del row + status dot. Rendered inside a `data-theme` container so
 * its colors come from the target preset's tokens.
 */
function ThemePreview() {
  return (
    <div className="flex h-full flex-col gap-0.5">
      <div className="flex h-2 items-center gap-1 rounded-sm bg-bg-elevated px-1">
        <div className="h-1 w-1 rounded-full bg-accent" />
        <div className="ml-auto h-0.5 w-4 rounded bg-border-strong" />
      </div>
      <div className="flex-1 rounded-sm border border-border bg-surface p-1">
        <div className="mb-0.5 h-1 w-full rounded-sm bg-diff-add-bg" />
        <div className="h-1 w-2/3 rounded-sm bg-diff-del-bg" />
      </div>
    </div>
  );
}
