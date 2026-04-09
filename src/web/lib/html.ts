// src/web/lib/html.ts
// Minimal HTML escape for diff text when Shiki highlighting is unavailable.
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
