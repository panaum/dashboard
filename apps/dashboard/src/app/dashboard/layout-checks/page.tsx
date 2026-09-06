import Link from "next/link";
import { Trash2 } from "lucide-react";
import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { ConfirmDelete } from "@/components/forms/confirm-delete";
import { AddSiteForm } from "@/components/layout-checks/add-site-form";
import { removeLayoutSite } from "./actions";

export const metadata = { title: "Layout checks" };

const TONE = { FAIL: "error", WARN: "warning", SKIP: "neutral", PASS: "success" } as const;
const LABEL = {
  FAIL: "Broken", WARN: "Worth a look", SKIP: "Couldn't check", PASS: "Clean",
} as const;

export default async function LayoutChecksPage() {
  await requireAuth();

  const sites = await db.layoutSite.findMany({
    orderBy: { createdAt: "desc" },
    include: { runs: { orderBy: { checkedAt: "desc" }, take: 1 } },
  });

  // Worst first: a broken page must never sit below the fold under clean ones.
  const rank: Record<string, number> = { FAIL: 0, WARN: 1, SKIP: 2, PASS: 3 };
  const rows = [...sites].sort((a, b) => {
    const ra = rank[a.runs[0]?.worst ?? ""] ?? 4;
    const rb = rank[b.runs[0]?.worst ?? ""] ?? 4;
    return ra - rb;
  });

  return (
    <>
      <PageHeader
        title="Layout checks"
        subtitle="Pages you want rendered at eight widths, with the history of what each check found."
      />

      <Card className="mb-5 px-5 py-4">
        <AddSiteForm />
      </Card>

      {rows.length === 0 ? (
        <Card className="px-5 py-10 text-center">
          <p className="text-sm text-text-secondary">
            No pages yet. Add one above, then run a check to record how it renders.
          </p>
        </Card>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border-soft bg-card">
          {rows.map((s, i) => {
            const last = s.runs[0];
            const worst = last?.worst ?? null;
            return (
              <div key={s.id}
                   className={`flex flex-wrap items-center gap-3 px-4 py-3 transition-colors hover:bg-card-soft ${i ? "border-t border-border-soft" : ""}`}>
                <Link href={`/dashboard/layout-checks/${s.id}`} className="group min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-text-primary group-hover:underline">
                    {s.label ?? s.url.replace(/^https?:\/\//, "")}
                  </span>
                  <span className="block truncate text-[12px] text-text-muted">{s.url}</span>
                </Link>

                {worst ? (
                  <Badge tone={TONE[worst as keyof typeof TONE] ?? "neutral"}>
                    {LABEL[worst as keyof typeof LABEL] ?? worst}
                  </Badge>
                ) : (
                  <span className="text-[12px] text-text-muted">Never checked</span>
                )}

                <span className="w-40 text-right text-[12px] text-text-muted">
                  {last ? `checked ${last.checkedAt.toLocaleDateString()}` : "—"}
                </span>

                <ConfirmDelete
                  action={removeLayoutSite}
                  fields={{ id: s.id }}
                  title="Stop watching this page"
                  description={`Remove ${s.label ?? s.url}? Its check history and screenshots go with it.`}
                  trigger={
                    <button className="rounded-md p-1.5 text-text-secondary transition-colors hover:bg-error/10 hover:text-error"
                            aria-label="Remove page">
                      <Trash2 className="size-4" />
                    </button>
                  }
                />
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
