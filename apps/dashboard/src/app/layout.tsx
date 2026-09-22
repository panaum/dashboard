import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { Signature } from "@/components/shared/signature";

// Figures are set in a true monospace so a column of them aligns on the
// decimal. Geist Sans carries the UI; this carries every number.
const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-jetbrains-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Deliverables Dashboard",
    template: "%s · Deliverables",
  },
  description: "Client websites, landing pages and QA tracking.",
  authors: [{ name: "Anaum" }],
  creator: "Anaum",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${jetbrainsMono.variable} h-full antialiased`}>
      <body className="min-h-full">
        {children}
        <Signature />
      </body>
    </html>
  );
}
