import { useEffect } from "react";
import { Layout } from "./components/layout";
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
      <div className="p-4 text-neutral-500">Tab: {tab} (not yet implemented)</div>
    </Layout>
  );
}
