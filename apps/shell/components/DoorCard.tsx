import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowRight } from "./icons";

type Accent = "teal" | "violet" | "slate";

// Static class strings per accent (Tailwind can't see interpolated names).
const ACCENT: Record<Accent, { icon: string; hover: string; cta: string; glow: string }> = {
  teal: {
    icon: "text-teal border-teal/25 bg-teal/10",
    hover: "hover:border-teal/40",
    cta: "text-teal",
    glow: "from-teal/10",
  },
  violet: {
    icon: "text-signal border-signal/25 bg-signal/10",
    hover: "hover:border-signal/40",
    cta: "text-signal",
    glow: "from-signal/10",
  },
  slate: {
    icon: "text-text-muted border-line bg-ink-800",
    hover: "",
    cta: "text-text-muted",
    glow: "from-transparent",
  },
};

export function DoorCard(props: {
  icon: ReactNode;
  name: string;
  description: string;
  cta: string;
  accent: Accent;
  href?: string;
  disabled?: boolean;
  badge?: string;
}) {
  const a = ACCENT[props.accent];

  const body = (
    <div
      className={`group relative flex h-full flex-col overflow-hidden rounded-2xl border border-line bg-ink-850 p-6 shadow-door transition-colors ${
        props.disabled ? "opacity-60" : `${a.hover} hover:bg-ink-800`
      }`}
    >
      <div className={`pointer-events-none absolute -top-16 left-1/2 h-40 w-40 -translate-x-1/2 rounded-full bg-gradient-to-b ${a.glow} to-transparent blur-2xl`} />
      <div className="relative flex items-start justify-between">
        <div className={`flex size-12 items-center justify-center rounded-xl border ${a.icon}`}>{props.icon}</div>
        {props.badge && (
          <span className="rounded-full border border-line bg-ink-800 px-2.5 py-1 text-[11px] font-medium uppercase tracking-wide text-text-muted">
            {props.badge}
          </span>
        )}
      </div>

      <h2 className="relative mt-5 font-display text-xl font-bold tracking-tight text-text-primary">{props.name}</h2>
      <p className="relative mt-1.5 flex-1 text-sm leading-relaxed text-text-secondary">{props.description}</p>

      <div className={`relative mt-6 inline-flex items-center gap-1.5 text-sm font-semibold ${a.cta}`}>
        {props.cta}
        {!props.disabled && <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />}
      </div>
    </div>
  );

  if (props.disabled || !props.href) {
    return <div aria-disabled className="cursor-not-allowed">{body}</div>;
  }
  return (
    <Link href={props.href} className="block focus:outline-none focus-visible:ring-2 focus-visible:ring-signal/50 rounded-2xl">
      {body}
    </Link>
  );
}
