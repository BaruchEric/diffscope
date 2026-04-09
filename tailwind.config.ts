import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/web/**/*.{ts,tsx}"],
  // darkMode intentionally omitted — data-theme is the single switch, each
  // theme declares its own mode internally. `dark:` modifiers are removed
  // from the codebase in the Phase 3-6 repaint pass.
  theme: {
    extend: {
      colors: {
        bg: {
          DEFAULT: "var(--bg)",
          elevated: "var(--bg-elevated)",
        },
        surface: {
          DEFAULT: "var(--surface)",
          hover: "var(--surface-hover)",
        },
        border: {
          DEFAULT: "var(--border)",
          strong: "var(--border-strong)",
        },
        fg: {
          DEFAULT: "var(--fg)",
          muted: "var(--fg-muted)",
          subtle: "var(--fg-subtle)",
        },
        accent: {
          DEFAULT: "var(--accent)",
          fg: "var(--accent-fg)",
          "fg-soft": "var(--accent-fg-soft)",
          soft: "var(--accent-soft)",
        },
        "diff-add": {
          bg: "var(--diff-add-bg)",
          fg: "var(--diff-add-fg)",
          sign: "var(--diff-add-sign)",
        },
        "diff-del": {
          bg: "var(--diff-del-bg)",
          fg: "var(--diff-del-fg)",
          sign: "var(--diff-del-sign)",
        },
        hunk: {
          bg: "var(--hunk-bg)",
          fg: "var(--hunk-fg)",
        },
      },
      fontFamily: {
        sans: ["var(--font-sans)"],
        display: ["var(--font-display)"],
        mono: ["var(--font-mono)"],
      },
      borderRadius: {
        DEFAULT: "var(--radius)",
        lg: "var(--radius-lg)",
      },
      boxShadow: {
        soft: "var(--shadow-soft)",
      },
    },
  },
  plugins: [],
} satisfies Config;
