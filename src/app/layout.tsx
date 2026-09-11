import type { Metadata, Viewport } from "next";
import { Inter, Source_Serif_4, JetBrains_Mono } from "next/font/google";
import "./globals.css";

/**
 * Three faces, each doing a job the others cannot.
 *
 * Inter for the interface: it was drawn for dense UI at small sizes, which is
 * most of this product. Source Serif for display only — a serif headline over a
 * regulatory tool reads as institutional rather than as a software startup, and
 * it is the one decision that keeps the landing page from looking like every
 * other generated site. JetBrains Mono for batch numbers and licence numbers,
 * where a zero must never be mistaken for an O.
 *
 * next/font ships with Next 14, so this adds no dependency, self-hosts the
 * files, and emits the CSS variables the Tailwind config already points at.
 */
const sans = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-sans",
});

const display = Source_Serif_4({
  subsets: ["latin"],
  display: "swap",
  weight: ["400", "600", "700"],
  variable: "--font-display",
});

const mono = JetBrains_Mono({
  subsets: ["latin"],
  display: "swap",
  weight: ["400", "500"],
  variable: "--font-mono",
});

export const metadata: Metadata = {
  title: {
    default: "RCCP — Reverse Chain Compliance Platform",
    template: "%s · RCCP",
  },
  description:
    "Track expired medicines from the retail shelf to verified destruction. Batch-level quantity conservation, re-entry fraud detection, and a public check anyone can run without an account.",
};

export const viewport: Viewport = {
  themeColor: "#FAF9F7",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${display.variable} ${mono.variable}`}>
      <body className="min-h-screen font-sans">
        {/* First stop for a keyboard user, and invisible until it matters. */}
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-md focus:bg-ink-900 focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-white"
        >
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}
