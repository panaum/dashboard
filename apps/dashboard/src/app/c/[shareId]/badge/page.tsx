import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ShieldCheck } from "lucide-react";
import { db } from "@/lib/db";
import { Logo } from "@/components/shared/logo";
import { scorePage } from "@/lib/quality-score";

// Embedded cross-site in an <iframe> on the client's own website footer.
export const metadata: Metadata = {
  title: "QA Verified by Apexure",
  robots: { index: false, follow: false },
};

const TONE_TEXT: Record<string, string> = {
  success: "text-success",
  warning: "text-warning",
  error: "text-error",
  neutral: "text-text-muted",
};

export default async function TrustBadge({
  params,
}: {
  params: Promise<{ shareId: string }>;
}) {
  const { shareId } = await params;
  const page = await db.page.findUnique({
    where: { shareId },
    select: {
      delayDays: true,
      certificate: { select: { status: true, items: { select: { result: true } } } },
      issues: { select: { severity: true, status: true } },
    },
  });
  if (!page) notFound();

  const score = scorePage({
    certStatus: page.certificate?.status,
    items: page.certificate?.items ?? [],
    issues: page.issues,
    delayDays: page.delayDays,
  });

  return (
    <>
      {/* Embedded in an iframe on a third-party site — keep the canvas transparent. */}
      <style>{`body{background:transparent!important;margin:0}`}</style>
      <a
        href={`/c/${shareId}`}
        target="_blank"
        rel="noreferrer"
        className="group m-1 flex w-fit items-center gap-2.5 rounded-full border border-border-soft bg-card px-3 py-2 shadow-sm transition-shadow hover:shadow-md"
      >
        <span className="flex size-7 items-center justify-center rounded-full bg-brand-primary">
          <Logo className="size-3.5" />
        </span>
        <span className="flex flex-col leading-tight">
          <span className="inline-flex items-center gap-1 text-[12px] font-semibold text-text-primary">
            <ShieldCheck className="size-3.5 text-success" />
            QA verified by Apexure
          </span>
          <span className="text-[11px] text-text-muted">
            {score.provisional ? (
              "Quality review in progress"
            ) : (
              <>
                Quality score{" "}
                <span className={`font-semibold ${TONE_TEXT[score.tone] ?? ""}`}>
                  {score.score}/100
                </span>{" "}
                · {score.label}
              </>
            )}
          </span>
        </span>
      </a>
    </>
  );
}
