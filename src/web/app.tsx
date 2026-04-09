import { useEffect } from "react";
import { Layout } from "./components/layout";
import { Picker } from "./components/picker";
import { Shortcuts } from "./components/shortcuts";
import { Toasts } from "./components/toasts";
import { SettingsModal } from "./components/settings-modal";
import { CommandPalette } from "./components/command-palette";
import { WorkingTreeTab } from "./tabs/working-tree";
import { HistoryTab } from "./tabs/history";
import { BranchesTab } from "./tabs/branches";
import { StashesTab } from "./tabs/stashes";
import { useStore } from "./store";
import { useSettings, getSettings } from "./settings";
import { applyTheme } from "./theme";

export function App() {
  const initialize = useStore((s) => s.initialize);
  const teardown = useStore((s) => s.teardown);
  const repoLoaded = useStore((s) => s.repoLoaded);
  const tab = useSettings((s) => s.lastUsedTab);

  useEffect(() => {
    useSettings.getState().load();
    applyTheme(getSettings().theme);
  }, []);

  useEffect(() => {
    // Only re-apply theme when `theme` actually changes. `useSettings.subscribe`
    // fires on any settings mutation (fileListMode, editor, etc.), and
    // applyTheme detaches/re-attaches a matchMedia listener — thrashing it on
    // every unrelated toggle is wasteful.
    let prev = useSettings.getState().theme;
    const unsub = useSettings.subscribe((s) => {
      if (s.theme !== prev) {
        prev = s.theme;
        applyTheme(s.theme);
      }
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    void initialize();
    return () => teardown();
  }, [initialize, teardown]);

  if (!repoLoaded)
    return (
      <>
        <Picker />
        <Shortcuts />
        <Toasts />
        <SettingsModal />
        <CommandPalette />
      </>
    );

  return (
    <>
      <Layout>
        {tab === "working-tree" && <WorkingTreeTab />}
        {tab === "history" && <HistoryTab />}
        {tab === "branches" && <BranchesTab />}
        {tab === "stashes" && <StashesTab />}
      </Layout>
      <Shortcuts />
      <Toasts />
      <SettingsModal />
      <CommandPalette />
    </>
  );
}
