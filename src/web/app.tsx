import { useEffect } from "react";
import { Layout } from "./components/layout";
import { Picker } from "./components/picker";
import { Shortcuts } from "./components/shortcuts";
import { Toasts } from "./components/toasts";
import { WorkingTreeTab } from "./tabs/working-tree";
import { HistoryTab } from "./tabs/history";
import { BranchesTab } from "./tabs/branches";
import { StashesTab } from "./tabs/stashes";
import { useStore } from "./store";

export function App() {
  const initialize = useStore((s) => s.initialize);
  const teardown = useStore((s) => s.teardown);
  const repoLoaded = useStore((s) => s.repoLoaded);
  const tab = useStore((s) => s.tab);

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
    </>
  );
}
