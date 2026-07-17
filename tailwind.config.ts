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
      },
      fontFamily: {
        display: ["var(--font-display)", "ui-sans-serif", "system-ui", "sans-serif"],
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "SFMono-Regular", "monospace"],
      },
      boxShadow: {
        door: "0 1px 0 0 rgba(255,255,255,0.04) inset, 0 20px 50px -20px rgba(0,0,0,0.7)",
      },
    },
  },
  plugins: [],
};

export default config;
