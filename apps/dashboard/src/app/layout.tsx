import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import "./globals.css";
import { Signature } from "@/components/shared/signature";

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
    <html lang="en" className={`${GeistSans.variable} h-full antialiased`}>
      <body className="min-h-full">
        {children}
        <Signature />
      </body>
    </html>
  );
}
