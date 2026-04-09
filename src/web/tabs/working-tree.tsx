import { FileList } from "../components/file-list";
import { DiffView } from "../components/diff-view";
import { useStore } from "../store";

export function WorkingTreeTab() {
  const focusedDiff = useStore((s) => s.focusedDiff);
  const focusedPath = useStore((s) => s.focusedPath);
  return (
    <div className="grid h-full grid-cols-[320px_1fr]">
      <FileList />
      <div className="overflow-hidden">
        <DiffView diff={focusedDiff} loading={focusedPath !== null && focusedDiff === null} />
      </div>
    </div>
  );
}
