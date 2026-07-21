import type { Metadata } from "next";
import { Bricolage_Grotesque, Inter, JetBrains_Mono, Fraunces } from "next/font/google";
import "./globals.css";

const display = Bricolage_Grotesque({ subsets: ["latin"], variable: "--font-display", display: "swap" });
const sans = Inter({ subsets: ["latin"], variable: "--font-sans", display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono", display: "swap" });
// Serif for the portal hero heading — the calm "Spirited Away dusk" landing.
const serif = Fraunces({ subsets: ["latin"], weight: ["500"], variable: "--font-serif", display: "swap" });

export const metadata: Metadata = {
  title: "Apexure Platform",
  description: "The sign-in-once front door for the Apexure QA ecosystem.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${sans.variable} ${mono.variable} ${serif.variable}`}>
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
