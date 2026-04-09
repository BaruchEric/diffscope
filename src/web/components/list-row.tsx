// src/web/components/list-row.tsx
// Shared row primitive for the History / Branches / Stashes / FileList tab
// lists. Owns the "left-accent-border on selected, muted on hover" button
// styling that those tabs were hand-rolling.
import type { ReactNode } from "react";

export interface ListRowProps {
  selected: boolean;
  onClick: () => void;
  /** Optional density — `sm` matches branches, `md` matches history/stashes. */
  density?: "sm" | "md";
  children: ReactNode;
}

export function ListRow({
  selected,
  onClick,
  density = "md",
  children,
}: ListRowProps) {
  const pad = density === "sm" ? "px-3 py-1.5" : "px-3 py-2";
  return (
    <button
      onClick={onClick}
      className={
        `block w-full truncate ${pad} text-left text-sm border-l-2 ` +
        (selected
          ? "bg-surface-hover text-fg border-accent"
          : "text-fg-muted hover:bg-surface-hover hover:text-fg border-transparent")
      }
    >
      {children}
    </button>
  );
}
