import { GeistSans } from "geist/font/sans";

// LIVING CERTIFICATE — the scope boundary for the ported palette.
//
// Everything light about /live/ hangs off the `lc-root` class this layout adds:
// the ground swap and color-scheme override in globals.css key on it, and the
// `lc-*` Tailwind tokens are referenced by nothing else in the repo. Remove this
// layout and the shell is exactly as dark as it was.
//
// ═══ TYPOGRAPHY ═══
// UNIFIED, not contrasted. This uses `geist/font/sans` — the exact package and
// face the Dashboard loads in its own root layout — rather than the shell's
// Bricolage Grotesque.
//
// Bricolage is the SHELL's voice: the parent frame around three staff doors. A
// client never sees that frame. On a client-facing certificate the only useful
// signal is that /c/{shareId} and /live/{shareId} come from the same company,
// and matching the type is the cheapest way to say it. A contrast here would be
// decorative rather than meaningful, so there is none to name.
//
// Next 14's next/font/google has no Geist entry, so the package is a dependency
// rather than a font download. It is scoped to this layout: the doors page still
// loads Bricolage and Inter and nothing else.

export default function LivingCertificateLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <div className={`lc-root ${GeistSans.variable} font-lc`}>{children}</div>;
}
