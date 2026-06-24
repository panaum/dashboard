import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import {
  CheckCircle2,
  ArrowRight,
  ShieldCheck,
  Sparkles,
  Clock,
} from "lucide-react";
import { db } from "@/lib/db";
import { Logo } from "@/components/shared/logo";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/ui/status-badge";
import { AnimatedNumber } from "@/components/shared/animated-number";
import { ScoreRing } from "@/components/qa/score-ring";
import { scorePage, aggregateScore } from "@/lib/quality-score";
import { label, monthLabel, type Status } from "@/lib/constants";

export const metadata: Metadata = {
  title: "Deliverables portal",
  robots: { index: false, follow: false },
};

export default async function ClientPortalPage({
  params,
}: {
  params: Promise<{ portalId: string }>;
}) {
  const { portalId } = await params;
  const client = await db.client.findUnique({
    where: { portalId },
    include: {
      projects: {
        orderBy: { updatedAt: "desc" },
        include: {
          pages: {
            orderBy: { updatedAt: "desc" },
            select: {
              id: true,
              name: true,
              url: true,
              status: true,
              delayDays: true,
              deliveryMonth: true,
              developer: { select: { name: true } },
              tester: { select: { name: true } },
              certificate: { select: { status: true, items: { select: { result: true } } } },
              issues: { select: { severity: true, status: true } },
            },
          },
        },
      },
    },
  });
  if (!client) notFound();

  const scored = client.projects.flatMap((p) =>
    p.pages.map((pg) => ({
      page: pg,
      platform: p.platform,
      score: scorePage({
        certStatus: pg.certificate?.status,
        items: pg.certificate?.items ?? [],
        issues: pg.issues,
        delayDays: pg.delayDays,
      }),
    })),
  );

  const overall = aggregateScore(scored.map((s) => s.score));
  const totalPages = scored.length;
  const livePages = scored.filter((s) => s.page.status === "LIVE").length;
  const onTime = scored.filter((s) => s.page.delayDays === 0).length;
  const checksRun = scored.reduce(
    (n, s) => n + (s.page.certificate?.items.length ?? 0),
    0,
  );
  const onTimePct = totalPages ? Math.round((onTime / totalPages) * 100) : 0;
  const projectsWithPages = client.projects.filter((p) => p.pages.length > 0);

  const stats = [
    { label: "Average score", value: overall.provisional ? null : overall.score, suffix: "/100" },
    { label: "Deliverables", value: totalPages },
    { label: "QA checks run", value: checksRun },
    { label: "Delivered on time", value: onTimePct, suffix: "%" },
  ];

  return (
    <main className="min-h-screen bg-page">
      {/* ───────── Hero ───────── */}
      <header className="relative overflow-hidden bg-brand-primary text-text-on-dark">
        {/* depth: soft brand-coloured glows */}
        <div className="pointer-events-none absolute -left-28 -top-28 size-80 rounded-full bg-brand-purple/25 blur-3xl" />
        <div className="pointer-events-none absolute -right-10 top-0 size-96 rounded-full bg-accent/25 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-40 left-1/3 size-96 rounded-full bg-brand-blue/15 blur-3xl" />

        <div className="relative mx-auto max-w-5xl px-5 pb-24 pt-9 sm:px-8">
          <div className="flex items-center gap-2.5 text-text-on-dark/75">
            <span className="flex size-8 items-center justify-center rounded-lg bg-white/10 ring-1 ring-white/15">
              <Logo className="size-4" />
            </span>
            <span className="text-[13px] font-medium tracking-wide">
              Apexure · Deliverables
            </span>
          </div>

          <div className="mt-9 flex flex-col items-start justify-between gap-10 sm:flex-row sm:items-center">
            <div className="animate-in">
              <p className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-text-on-dark/80 ring-1 ring-white/10">
                <Sparkles className="size-3" /> Quality portal
              </p>
              <h1 className="mt-4 text-4xl font-semibold tracking-tight sm:text-5xl">
                {client.name}
              </h1>
              <p className="mt-3 max-w-md text-[15px] leading-relaxed text-text-on-dark/70">
                A live view of every website and landing page we&rsquo;ve built for
                you — each one signed off against Apexure&rsquo;s quality assurance
                standard.
              </p>
              <div className="mt-6 flex flex-wrap gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-[13px] font-medium ring-1 ring-white/10">
                  <CheckCircle2 className="size-3.5 text-brand-blue" /> {livePages} live
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-[13px] font-medium ring-1 ring-white/10">
                  <ShieldCheck className="size-3.5 text-brand-purple" /> QA verified
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-[13px] font-medium ring-1 ring-white/10">
                  <Clock className="size-3.5 text-brand-peach" /> {onTimePct}% on time
                </span>
              </div>
            </div>

            {/* Glass score card */}
            <div className="flex shrink-0 flex-col items-center rounded-3xl border border-white/10 bg-white/[0.06] px-9 py-7 shadow-2xl backdrop-blur-sm">
              <ScoreRing score={overall} size={132} stroke={10} variant="dark" />
              <span className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-text-on-dark/85">
                <ShieldCheck className="size-4 text-success" />
                {overall.provisional ? "Awaiting review" : `${overall.label} quality`}
              </span>
            </div>
          </div>
        </div>
      </header>

      {/* ───────── Floating stats band ───────── */}
      <div className="relative z-10 mx-auto -mt-14 max-w-5xl px-5 sm:px-8">
        <div className="grid grid-cols-2 gap-3 rounded-2xl border border-border-soft bg-card p-3 shadow-lg sm:grid-cols-4 sm:gap-0 sm:p-0">
          {stats.map((s, i) => (
            <div
              key={s.label}
              className={`flex flex-col gap-1 px-4 py-4 sm:px-6 sm:py-6 ${i > 0 ? "sm:border-l sm:border-border-soft" : ""}`}
            >
              <span className="text-2xl font-semibold tracking-tight text-text-primary sm:text-3xl">
                {s.value === null ? (
                  "—"
                ) : (
                  <>
                    <AnimatedNumber value={s.value} />
                    {s.suffix && (
                      <span className="text-base font-medium text-text-muted sm:text-lg">
                        {s.suffix}
                      </span>
                    )}
                  </>
                )}
              </span>
              <span className="text-[12px] font-medium uppercase tracking-[0.06em] text-text-muted">
                {s.label}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* ───────── Deliverables ───────── */}
      <div className="mx-auto max-w-5xl px-5 py-12 sm:px-8">
        {projectsWithPages.length === 0 ? (
          <p className="rounded-2xl border border-border-soft bg-card px-5 py-10 text-center text-sm text-text-secondary">
            Deliverables will appear here as we ship them.
          </p>
        ) : (
          <div className="flex flex-col gap-10">
            {projectsWithPages.map((project) => (
              <section key={project.id}>
                <div className="mb-4 flex items-baseline justify-between gap-3">
                  <h2 className="text-base font-semibold tracking-tight text-text-primary">
                    {project.name}
                  </h2>
                  <Badge tone="neutral">{label(project.platform)}</Badge>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  {project.pages.map((pg, i) => {
                    const item = scored.find((x) => x.page.id === pg.id)!;
                    const s = item.score;
                    const resolved = pg.issues.filter((x) => x.status === "FIXED").length;
                    return (
                      <Link
                        key={pg.id}
                        href={`/portal/${portalId}/${pg.id}`}
                        style={{ animationDelay: `${Math.min(i, 8) * 60}ms` }}
                        className="animate-in group flex flex-col gap-4 rounded-2xl border border-border-soft bg-card p-5 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-accent/40 hover:shadow-lg"
                      >
                        <div className="flex items-center gap-4">
                          <ScoreRing score={s} size={64} stroke={6} />
                          <div className="flex min-w-0 flex-1 flex-col gap-2">
                            <span className="truncate text-[15px] font-semibold text-text-primary">
                              {pg.name}
                            </span>
                            <div className="flex flex-wrap items-center gap-1.5">
                              <StatusBadge status={pg.status as Status} />
                              {!s.provisional && <Badge tone={s.tone}>{s.label}</Badge>}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center justify-between gap-3 border-t border-border-soft pt-3.5">
                          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-text-secondary">
                            {pg.deliveryMonth && <span>{monthLabel(pg.deliveryMonth)}</span>}
                            <span className="text-text-muted">
                              {resolved === pg.issues.length
                                ? "All issues resolved"
                                : `${resolved}/${pg.issues.length} resolved`}
                            </span>
                            {(pg.developer || pg.tester) && (
                              <span className="flex items-center -space-x-1.5">
                                {pg.developer && <Avatar name={pg.developer.name} size="sm" />}
                                {pg.tester && <Avatar name={pg.tester.name} size="sm" />}
                              </span>
                            )}
                          </div>
                          <span className="inline-flex shrink-0 items-center gap-1 text-[13px] font-medium text-accent">
                            Certificate
                            <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
                          </span>
                        </div>
                      </Link>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        )}

        <footer className="mt-14 flex flex-col items-center gap-3 border-t border-border-soft pt-8 text-center">
          <span className="flex size-9 items-center justify-center rounded-xl border border-border-soft bg-card">
            <Logo className="size-5" />
          </span>
          <p className="text-[13px] text-text-secondary">
            Quality assured by Apexure
          </p>
          <p className="text-[12px] text-text-muted">
            <a href="mailto:success@apexure.com" className="text-info hover:underline">
              success@apexure.com
            </a>{" "}
            ·{" "}
            <a
              href="https://apexure.com"
              target="_blank"
              rel="noreferrer"
              className="text-info hover:underline"
            >
              apexure.com
            </a>
          </p>
        </footer>
      </div>
    </main>
  );
}
