import { FileList } from "../components/file-list";
import { DiffView } from "../components/diff-view";
import { PaneSplit } from "../components/pane-split";
import { useStore } from "../store";

export function WorkingTreeTab() {
  const focusedDiff = useStore((s) => s.focusedDiff);
  const focusedPath = useStore((s) => s.focusedPath);
  return (
    <PaneSplit
      axis="x"
      a={<FileList />}
      b={
        <div className="h-full overflow-auto">
          <DiffView
            diff={focusedDiff}
            loading={focusedPath !== null && focusedDiff === null}
          />
        </div>
      }
    />
  );
}
