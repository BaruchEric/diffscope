import { useEffect } from "react";
import { Layout } from "./components/layout";
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

  if (!repoLoaded) {
    return (
      <div className="flex h-full items-center justify-center text-neutral-500">
        Loading repo…
      </div>
    );
  }

  return (
    <Layout>
      {tab === "working-tree" && <WorkingTreeTab />}
      {tab === "history" && <HistoryTab />}
      {tab === "branches" && <BranchesTab />}
      {tab === "stashes" && <StashesTab />}
    </Layout>
  );
}
