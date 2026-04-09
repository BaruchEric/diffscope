// src/web/lib/relative-time.ts
// Human-readable "N minutes ago" / "3d" formatter used by the picker and
// the blame gutter. Two presentations via the `style` option.
export type RelativeStyle = "long" | "short";

export function relativeTime(iso: string, style: RelativeStyle = "long"): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const diffSec = Math.round((Date.now() - then) / 1000);
  if (style === "short") {
    if (diffSec < 60) return "now";
    const mins = Math.floor(diffSec / 60);
    if (mins < 60) return `${mins}m`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `${days}d`;
    const months = Math.floor(days / 30);
    if (months < 12) return `${months}mo`;
    return `${Math.floor(days / 365)}y`;
  }
  if (diffSec < 60) return "just now";
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  if (diffSec < 86400 * 7) return `${Math.floor(diffSec / 86400)}d ago`;
  if (diffSec < 86400 * 30) return `${Math.floor(diffSec / 86400 / 7)}w ago`;
  return new Date(iso).toLocaleDateString();
}
