import type { Config } from "tailwindcss";

/**
 * The palette is deliberately institutional rather than fashionable.
 *
 * This is a drug-control compliance tool: the people who use it are pharmacists
 * mid-shift and regulators building a case, and the screens it competes with are
 * government portals. A saturated purple-to-cyan gradient would read as a
 * startup landing page wearing a lab coat.
 *
 * So: warm paper rather than pure white (less glare over a long shift), a deep
 * pine green that reads as health without the mint-green cliché, and clay used
 * only for emphasis. Semantic colours stay muted — on a screen where red means
 * "do not dispense", a decorative red anywhere else is a liability.
 */
export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        paper: "#FAF9F7",
        surface: "#FFFFFF",
        // Slightly sunk panels — section bands, table headers.
        sunken: "#F3F1ED",
        ink: {
          900: "#14181F",
          700: "#39414B",
          500: "#697588",
          400: "#8B94A3",
        },
        line: {
          DEFAULT: "#E7E3DC",
          strong: "#D6D0C6",
        },
        pine: {
          50: "#EDF4F2",
          100: "#D6E7E2",
          300: "#7FB3A8",
          500: "#2E7D6C",
          600: "#1C6455",
          700: "#0E4E42",
          900: "#08302A",
        },
        clay: {
          50: "#FBF1EC",
          500: "#B4552A",
          600: "#95441F",
        },
      },
      fontFamily: {
        // Set by next/font in layout.tsx; these are the fallback chains.
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "Roboto", "sans-serif"],
        display: ["var(--font-display)", "ui-serif", "Georgia", "Cambria", "serif"],
        mono: ["var(--font-mono)", "ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      fontSize: {
        // A fluid display scale so headlines don't need a breakpoint each.
        "display-lg": ["clamp(2.25rem, 1.4rem + 3.6vw, 4.25rem)", { lineHeight: "1.12", letterSpacing: "-0.02em" }],
        "display-md": ["clamp(1.75rem, 1.2rem + 2.2vw, 2.75rem)", { lineHeight: "1.12", letterSpacing: "-0.018em" }],
        "display-sm": ["clamp(1.375rem, 1.1rem + 1.1vw, 1.875rem)", { lineHeight: "1.2", letterSpacing: "-0.012em" }],
      },
      borderRadius: {
        // One step up from Tailwind's defaults, capped: nothing here is a pill
        // except chips, which are meant to be.
        card: "0.75rem",
        panel: "1rem",
      },
      boxShadow: {
        // Layered and low-alpha. A single dark blur reads as a drop shadow from
        // 2013; two offsets with different spreads reads as depth.
        card: "0 1px 2px rgba(20,24,31,0.04), 0 1px 3px rgba(20,24,31,0.06)",
        lift: "0 2px 4px rgba(20,24,31,0.04), 0 12px 24px -8px rgba(20,24,31,0.12)",
        panel: "0 1px 2px rgba(20,24,31,0.04), 0 24px 48px -16px rgba(20,24,31,0.16)",
      },
      maxWidth: {
        content: "72rem",
        prose: "42rem",
      },
      transitionTimingFunction: {
        out: "cubic-bezier(0.16, 1, 0.3, 1)",
        inout: "cubic-bezier(0.65, 0, 0.35, 1)",
      },
      keyframes: {
        rise: {
          from: { opacity: "0", transform: "translateY(14px)" },
          to: { opacity: "1", transform: "none" },
        },
        fade: { from: { opacity: "0" }, to: { opacity: "1" } },
        shimmer: {
          "100%": { transform: "translateX(100%)" },
        },
      },
      animation: {
        rise: "rise 560ms cubic-bezier(0.16, 1, 0.3, 1) both",
        fade: "fade 400ms ease-out both",
      },
    },
  },
  plugins: [],
} satisfies Config;
