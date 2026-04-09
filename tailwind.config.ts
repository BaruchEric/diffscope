import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/web/**/*.{ts,tsx}"],
  // darkMode intentionally omitted — data-theme is the single switch, each
  // theme declares its own mode internally. `dark:` modifiers are removed
  // from the codebase in the Phase 3-6 repaint pass.
  theme: {
    extend: {
      // Channel-split token architecture:
      // Category A colors (solid colors that may need /opacity) are defined
      // in src/web/index.css as space-separated RGB channels and consumed
      // here via `rgb(var(--token) / <alpha-value>)`. This lets Tailwind
      // utilities like `bg-surface/95`, `text-fg/50`, `bg-accent-fg/20`
      // "just work" across all themes without silent JIT drops.
      //
      // Category B tokens (accent-soft, diff-*-bg, hunk-bg) are pre-computed
      // translucent washes — they stay as raw `var(--token)` references
      // because their alpha is intentional and fixed. Do not apply /opacity
      // to these; pick a Category A token or add a new wash token instead.
      colors: {
        bg: {
          DEFAULT: "rgb(var(--bg) / <alpha-value>)",
          elevated: "rgb(var(--bg-elevated) / <alpha-value>)",
        },
        surface: {
          DEFAULT: "rgb(var(--surface) / <alpha-value>)",
          hover: "rgb(var(--surface-hover) / <alpha-value>)",
        },
        border: {
          DEFAULT: "rgb(var(--border) / <alpha-value>)",
          strong: "rgb(var(--border-strong) / <alpha-value>)",
        },
        fg: {
          DEFAULT: "rgb(var(--fg) / <alpha-value>)",
          muted: "rgb(var(--fg-muted) / <alpha-value>)",
          subtle: "rgb(var(--fg-subtle) / <alpha-value>)",
        },
        accent: {
          DEFAULT: "rgb(var(--accent) / <alpha-value>)",
          fg: "rgb(var(--accent-fg) / <alpha-value>)",
          soft: "var(--accent-soft)",
        },
        "diff-add": {
          bg: "var(--diff-add-bg)",
          fg: "rgb(var(--diff-add-fg) / <alpha-value>)",
          sign: "rgb(var(--diff-add-sign) / <alpha-value>)",
        },
        "diff-del": {
          bg: "var(--diff-del-bg)",
          fg: "rgb(var(--diff-del-fg) / <alpha-value>)",
          sign: "rgb(var(--diff-del-sign) / <alpha-value>)",
        },
        hunk: {
          bg: "var(--hunk-bg)",
          fg: "rgb(var(--hunk-fg) / <alpha-value>)",
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
