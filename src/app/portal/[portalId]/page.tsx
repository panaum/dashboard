import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import {
  CheckCircle2,
  ArrowUpRight,
  ShieldCheck,
  LayoutGrid,
} from "lucide-react";
import { db } from "@/lib/db";
import { Logo } from "@/components/shared/logo";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/ui/status-badge";
import { ScoreRing } from "@/components/qa/score-ring";
import { scorePage, aggregateScore } from "@/lib/quality-score";
import { label, type Status } from "@/lib/constants";

// Tokenised portal links shouldn't be indexed.
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
              updatedAt: true,
              certificate: { select: { status: true, items: { select: { result: true } } } },
              issues: { select: { severity: true, status: true } },
            },
          },
        },
      },
    },
  });
  if (!client) notFound();

  // Score every page once, keyed by id, then roll up to a client-level score.
  const scored = client.projects.flatMap((p) =>
    p.pages.map((pg) => ({
      page: pg,
      projectName: p.name,
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
  const reviewed = scored.filter((s) => !s.score.provisional).length;
  const projectsWithPages = client.projects.filter((p) => p.pages.length > 0);

  return (
    <main className="min-h-screen bg-page">
      {/* Hero */}
      <header className="border-b border-border-soft bg-gradient-to-b from-brand-primary to-[#23233f] text-text-on-dark">
        <div className="mx-auto max-w-5xl px-5 py-10 sm:px-8">
          <div className="flex items-center gap-2 text-text-on-dark/70">
            <div className="flex size-7 items-center justify-center rounded-lg bg-white/10">
              <Logo className="size-4" />
            </div>
            <span className="text-[13px] font-medium">Apexure · Deliverables</span>
          </div>

          <div className="mt-7 flex flex-col items-start justify-between gap-8 sm:flex-row sm:items-center">
            <div>
              <p className="text-[13px] font-medium uppercase tracking-[0.12em] text-text-on-dark/60">
                Quality portal
              </p>
              <h1 className="mt-1.5 text-3xl font-semibold tracking-tight sm:text-4xl">
                {client.name}
              </h1>
              <p className="mt-2 max-w-md text-sm leading-relaxed text-text-on-dark/70">
                A live view of every website and landing page we&rsquo;ve built for you,
                with the quality assurance behind each one.
              </p>
              <div className="mt-5 flex flex-wrap gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 text-[13px] font-medium">
                  <LayoutGrid className="size-3.5" /> {totalPages} deliverable
                  {totalPages === 1 ? "" : "s"}
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 text-[13px] font-medium">
                  <CheckCircle2 className="size-3.5" /> {livePages} live
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 text-[13px] font-medium">
                  <ShieldCheck className="size-3.5" /> {reviewed} QA reviewed
                </span>
              </div>
            </div>

            {/* Overall quality score */}
            <div className="flex shrink-0 flex-col items-center rounded-2xl bg-white/[0.07] px-7 py-5 ring-1 ring-white/10">
              <ScoreRing score={overall} size={116} stroke={9} />
              <span className="mt-2 text-[13px] font-medium text-text-on-dark/80">
                {overall.provisional ? "Awaiting review" : `${overall.label} quality`}
              </span>
            </div>
          </div>
        </div>
      </header>

      {/* Deliverables */}
      <div className="mx-auto max-w-5xl px-5 py-10 sm:px-8">
        {projectsWithPages.length === 0 ? (
          <p className="rounded-xl border border-border-soft bg-card px-5 py-8 text-center text-sm text-text-secondary">
            Deliverables will appear here as we ship them.
          </p>
        ) : (
          <div className="flex flex-col gap-8">
            {projectsWithPages.map((project) => (
              <section key={project.id}>
                <div className="mb-3 flex items-baseline justify-between gap-3">
                  <h2 className="text-sm font-semibold text-text-primary">
                    {project.name}
                  </h2>
                  <Badge tone="neutral">{label(project.platform)}</Badge>
                </div>
                <div className="overflow-hidden rounded-xl border border-border-soft bg-card">
                  {project.pages.map((pg) => {
                    const s = scored.find((x) => x.page.id === pg.id)!.score;
                    return (
                      <Link
                        key={pg.id}
                        href={`/portal/${portalId}/${pg.id}`}
                        className="group flex items-center gap-4 border-t border-border-soft px-4 py-4 transition-colors first:border-t-0 hover:bg-card-soft"
                      >
                        <ScoreRing score={s} size={52} stroke={5} />
                        <div className="flex min-w-0 flex-1 flex-col gap-1">
                          <span className="truncate text-sm font-medium text-text-primary group-hover:underline">
                            {pg.name}
                          </span>
                          <div className="flex flex-wrap items-center gap-2">
                            <StatusBadge status={pg.status as Status} />
                            {!s.provisional && (
                              <Badge tone={s.tone}>{s.label}</Badge>
                            )}
                          </div>
                        </div>
                        <span className="hidden shrink-0 items-center gap-1 text-[13px] font-medium text-text-secondary group-hover:text-accent sm:inline-flex">
                          View certificate
                          <ArrowUpRight className="size-3.5" />
                        </span>
                      </Link>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        )}

        <footer className="mt-12 border-t border-border-soft pt-6 text-center text-[12px] text-text-muted">
          Quality assured by Apexure ·{" "}
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
        </footer>
      </div>
    </main>
  );
}
