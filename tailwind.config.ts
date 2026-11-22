import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: ["./src/**/*.{ts,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        charcoal: "#101418",
        surface: "#171E24",
        neon: "#39FF14",
        brand: { DEFAULT: "#20B26B", dark: "#178A52", light: "#E8F8EF" },
        canvas: "#F6F8F7",
      },
      fontFamily: {
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
        display: ["var(--font-display)", "var(--font-sans)", "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", "monospace"],
      },
      borderRadius: { xl: "0.9rem", "2xl": "1.15rem" },
      boxShadow: {
        card: "0 1px 2px rgba(16,20,24,0.04), 0 8px 24px -12px rgba(16,20,24,0.12)",
        pop: "0 12px 40px -12px rgba(16,20,24,0.25)",
      },
      keyframes: {
        "fade-in": { from: { opacity: "0", transform: "translateY(4px)" }, to: { opacity: "1", transform: "none" } },
        shimmer: { "100%": { transform: "translateX(100%)" } },
      },
      animation: { "fade-in": "fade-in .25s ease-out", shimmer: "shimmer 1.6s infinite" },
    },
  },
  plugins: [],
};
export default config;
