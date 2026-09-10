import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "RCCP — Reverse Chain Compliance Platform",
  description:
    "Batch-level tracking of expired medicines from retail shelf to verified destruction.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen font-sans">{children}</body>
    </html>
  );
}
