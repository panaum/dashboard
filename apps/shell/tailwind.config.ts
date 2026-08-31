import type { Config } from "tailwindcss";

// The shell reads as the PARENT of both apps: darker, quieter, brand-violet.
// Per-door accents (violet = LinkSpy, teal = Dashboard, slate = Board) live as
// tokens so each door keeps its own identity inside one calm frame.
const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: {
          950: "#08080c",
          900: "#0b0b12",
          850: "#101018",
          800: "#16161f",
          700: "#20202b",
          600: "#2b2b38",
        },
        signal: { DEFAULT: "#a855f7", soft: "#c084fc" }, // LinkSpy violet (--signal)
        teal: { DEFAULT: "#2dd4bf", soft: "#5eead4" }, //    Dashboard identity
        text: {
          primary: "#f4f4f7",
          secondary: "#a9a9bd",
          muted: "#6c6c82",
        },
        line: "#23232f",

        // ═══ LIVING CERTIFICATE — /live/{shareId} ONLY ═══
        // Ported verbatim from the Dashboard's Retainable design system
        // (src/app/globals.css @theme), so a client following /c/{shareId} and
        // /live/{shareId} sees one company rather than two vendors.
        //
        // Namespaced `lc-*` and used by nothing else. The doors page, sign-in
        // and handoff routes keep the dark palette above, untouched. Adding a
        // token cannot change a surface that never references it.
        lc: {
          page: "#f6f6f9", //          --color-page
          card: "#ffffff", //          --color-card
          "card-soft": "#f1f1f6", //   --color-card-soft
          accent: "#4f46e5", //        --color-accent (indigo)
          text: "#1c1c2e", //          --color-text-primary
          secondary: "#66667a", //     --color-text-secondary
          muted: "#7a7a8c", //         --color-text-muted
          line: "#e8e8f0", //          --color-border-soft
          success: "#4caf7d", //       --color-success
          warning: "#f5a623", //       --color-warning
          error: "#e05c5c", //         --color-error
        },
      },
      fontFamily: {
        display: ["var(--font-display)", "ui-sans-serif", "system-ui", "sans-serif"],
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "SFMono-Regular", "monospace"],
        // Geist — the Dashboard's face, so the two certificates share a voice.
        // `--font-geist-sans` is set by geist/font/sans in app/live/layout.tsx.
        // Matches the Dashboard's own --font-sans declaration exactly.
        lc: ["var(--font-geist-sans)", "system-ui", "sans-serif"],
      },
      boxShadow: {
        door: "0 1px 0 0 rgba(255,255,255,0.04) inset, 0 20px 50px -20px rgba(0,0,0,0.7)",
        // --shadow-sm from the Dashboard, verbatim.
        lc: "0 1px 2px rgba(20,20,43,0.04), 0 2px 6px rgba(20,20,43,0.05)",
      },
    },
  },
  plugins: [],
};

export default config;
