// src/web/lib/actions.ts
// Command palette actions registry.
// Each action has an id, human label, optional shortcut hint,
// and a run function that receives the store.
import { useSettings } from "../settings";
import { useStore } from "../store";
import type { Tab } from "../store";

export interface PaletteAction {
  id: string;
  label: string;
  hint?: string;
  run(): void;
}

function switchTab(tab: Tab) {
  useSettings.getState().set({ lastUsedTab: tab });
}

export function buildActions(): PaletteAction[] {
  return [
    {
      id: "tab.working-tree",
      label: "Go to Working Tree",
      hint: "g w",
      run: () => switchTab("working-tree"),
    },
    {
      id: "tab.history",
      label: "Go to History",
      hint: "g h",
      run: () => switchTab("history"),
    },
    {
      id: "tab.branches",
      label: "Go to Branches",
      hint: "g b",
      run: () => switchTab("branches"),
    },
    {
      id: "tab.stashes",
      label: "Go to Stashes",
      hint: "g s",
      run: () => switchTab("stashes"),
    },
    {
      id: "diff.toggle-mode",
      label: "Toggle Unified / Split Diff",
      hint: "u",
      run: () => {
        const mode = useSettings.getState().diffMode;
        useSettings
          .getState()
          .set({ diffMode: mode === "unified" ? "split" : "unified" });
      },
    },
    {
      id: "list.toggle-mode",
      label: "Toggle Flat / Tree File List",
      hint: "t",
      run: () => {
        const cur = useSettings.getState().fileListMode;
        useSettings
          .getState()
          .set({ fileListMode: cur === "tree" ? "flat" : "tree" });
      },
    },
    {
      id: "updates.toggle-pause",
      label: "Toggle Pause Live Updates",
      hint: "p",
      run: () => useStore.getState().togglePaused(),
    },
    {
      id: "settings.open",
      label: "Open Settings",
      hint: ",",
      run: () => useStore.getState().openSettings(),
    },
    {
      id: "file.copy-path",
      label: "Copy Current File Path",
      run: () => {
        const p = useStore.getState().focusedPath;
        if (p) void navigator.clipboard.writeText(p);
      },
    },
    {
      id: "blame.toggle",
      label: "Toggle Blame on Current File",
      hint: "b",
      run: () => {
        const p = useStore.getState().focusedPath;
        if (p) useStore.getState().toggleBlame(p);
      },
    },
    {
      id: "terminal.toggle",
      label: "Terminal: Toggle Drawer",
      hint: "⌘`",
      run: () => {
        const cur = useSettings.getState().terminalDrawerOpen;
        useSettings.getState().set({ terminalDrawerOpen: !cur });
      },
    },
    {
      id: "explorer.toggle-mode",
      label: "Explorer: toggle Changes / Explore",
      hint: "e",
      run: () => {
        const cur = useSettings.getState().workingTreeMode;
        useSettings.getState().set({ workingTreeMode: cur === "explore" ? "changes" : "explore" });
      },
    },
    {
      id: "explorer.toggle-hide-ignored",
      label: "Explorer: toggle hide ignored files",
      run: () => {
        useSettings.getState().set({ hideIgnored: !useSettings.getState().hideIgnored });
      },
    },
  ];
}
