import { useStore } from "../store";

export function StatusBar() {
  const repo = useStore((s) => s.repo);
  const status = useStore((s) => s.status);
  const branches = useStore((s) => s.branches);
  const watcherDown = useStore((s) => s.watcherDown);

  const current = branches.find((b) => b.isCurrent);
  const staged = status.filter((f) => !f.isUntracked && f.staged).length;
  const unstaged = status.filter((f) => !f.isUntracked && f.unstaged).length;
  const untracked = status.filter((f) => f.isUntracked).length;

  return (
    <footer className="flex h-6 items-center gap-3 border-t border-neutral-200 bg-neutral-50 px-3 text-[11px] text-neutral-600 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-400">
      <span className="flex items-center gap-1">
        <span
          className={`h-1.5 w-1.5 rounded-full ${
            watcherDown ? "bg-amber-500" : "bg-green-500"
          }`}
        />
        {watcherDown ? "live updates off" : "live"}
      </span>
      {current && (
        <span>
          ⎇ {current.name}
          {current.upstream && (
            <span className="ml-1 text-neutral-500">
              {current.ahead > 0 && ` ↑${current.ahead}`}
              {current.behind > 0 && ` ↓${current.behind}`}
            </span>
          )}
        </span>
      )}
      <span className="text-neutral-500">
        {staged > 0 && <span className="text-blue-600 dark:text-blue-400">+{staged} staged</span>}
        {staged > 0 && (unstaged > 0 || untracked > 0) && " · "}
        {unstaged > 0 && <span className="text-amber-600 dark:text-amber-400">{unstaged} unstaged</span>}
        {unstaged > 0 && untracked > 0 && " · "}
        {untracked > 0 && <span className="text-green-600 dark:text-green-400">{untracked} untracked</span>}
        {staged === 0 && unstaged === 0 && untracked === 0 && "clean"}
      </span>
      <span className="ml-auto truncate font-mono text-neutral-500">
        {repo?.headSha?.slice(0, 7)}
      </span>
    </footer>
  );
}
