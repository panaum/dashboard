import Link from "next/link";
import { notFound } from "next/navigation";
import { Trash2, ShieldCheck } from "lucide-react";
import { db } from "@/lib/db";
import { Card } from "@/components/ui/card";
import { Avatar } from "@/components/ui/avatar";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { StatusBadge } from "@/components/ui/status-badge";
import { PageHeader } from "@/components/shared/page-header";
import { Breadcrumbs } from "@/components/shared/breadcrumbs";
import { EditPageButton } from "@/components/forms/dialogs";
import { ConfirmDelete } from "@/components/forms/confirm-delete";
import { QAChecklist } from "@/components/qa/qa-checklist";
import { QARing } from "@/components/qa/qa-ring";
import { CertStatusControl } from "@/components/qa/cert-status-control";
import { IssueLog } from "@/components/qa/issue-log";
import { AiQaButton } from "@/components/qa/ai-qa";
import { InlineUrl } from "@/components/qa/inline-url";
import { SitePreview } from "@/components/shared/site-preview";
import { deletePage } from "../actions";
import { label, type Status } from "@/lib/constants";

function Meta({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs font-medium uppercase tracking-wide text-text-muted">
        {k}
      </span>
      <span className="text-sm text-text-primary">{v}</span>
    </div>
  );
}

export default async function PageDetailPage({
  params,
}: {
  params: Promise<{ clientId: string; projectId: string; pageId: string }>;
}) {
  const { clientId, projectId, pageId } = await params;
  const [page, members] = await Promise.all([
    db.page.findUnique({
      where: { id: pageId },
      include: {
        project: { include: { client: true } },
        developer: true,
        tester: true,
        certificate: { include: { items: { orderBy: { order: "asc" } } } },
        issues: { orderBy: { createdAt: "asc" } },
      },
    }),
    db.teamMember.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true, role: true },
    }),
  ]);
  if (!page || page.projectId !== projectId || page.project.clientId !== clientId)
    notFound();

  const path = { clientId, projectId, pageId };
  const basePath = `/dashboard/clients/${clientId}/${projectId}`;

  return (
    <>
      <Breadcrumbs
        items={[
          { label: "Clients", href: "/dashboard/clients" },
          { label: page.project.client.name, href: `/dashboard/clients/${clientId}` },
          { label: page.project.name, href: basePath },
          { label: page.name },
        ]}
      />
      <PageHeader
        title={page.name}
        subtitle={`${page.project.client.name} · ${page.project.name}`}
        action={
          <div className="flex items-center gap-1">
            <Link
              href={`${basePath}/${pageId}/certificate`}
              className={cn(buttonVariants({ variant: "secondary", size: "sm" }), "mr-1")}
            >
              <ShieldCheck /> Certificate
            </Link>
            <EditPageButton
              clientId={clientId}
              projectId={projectId}
              members={members}
              page={page}
            />
            <ConfirmDelete
              action={deletePage}
              fields={{ id: page.id, projectId, clientId, redirectTo: basePath }}
              title="Delete page"
              description={`Delete ${page.name} and its QA records?`}
              trigger={
                <button
                  className="rounded-md p-1.5 text-text-secondary hover:bg-error/10 hover:text-error"
                  aria-label="Delete page"
                >
                  <Trash2 className="size-4" />
                </button>
              }
            />
          </div>
        }
      />

      <div className="mb-5 -mt-3">
        <InlineUrl pageId={page.id} url={page.url} path={path} />
      </div>

      <SitePreview
        url={page.url}
        name={page.name}
        aspect="aspect-[16/6]"
        className="mb-6"
      />

      {/* Meta + certificate status */}
      <div className="mb-6 grid gap-4 lg:grid-cols-3">
        <Card className="p-5 lg:col-span-2">
          <div className="grid grid-cols-2 gap-5 sm:grid-cols-3">
            <Meta k="Status" v={<StatusBadge status={page.status as Status} />} />
            <Meta
              k="Developer"
              v={
                page.developer ? (
                  <span className="inline-flex items-center gap-2">
                    <Avatar name={page.developer.name} size="sm" />
                    {page.developer.name}
                  </span>
                ) : (
                  "—"
                )
              }
            />
            <Meta
              k="Tester"
              v={
                page.tester ? (
                  <span className="inline-flex items-center gap-2">
                    <Avatar name={page.tester.name} size="sm" />
                    {page.tester.name}
                  </span>
                ) : (
                  "—"
                )
              }
            />
            <Meta k="Delivery month" v={page.deliveryMonth ?? "—"} />
            <Meta
              k="Delay"
              v={`${page.delayDays} day${page.delayDays === 1 ? "" : "s"}`}
            />
            <Meta k="Platform" v={label(page.project.platform)} />
          </div>
        </Card>

        <Card className="flex flex-col justify-between gap-4 p-5">
          {page.certificate ? (
            (() => {
              const items = page.certificate.items;
              const passed = items.filter((i) => i.result === "PASSED").length;
              const failed = items.filter((i) => i.result === "FAILED").length;
              const na = items.filter((i) => i.result === "NA").length;
              const total = items.length;
              return (
                <>
                  <div className="flex items-center gap-4">
                    <QARing
                      passed={passed}
                      failed={failed}
                      na={na}
                      total={total}
                      size={60}
                    />
                    <div className="flex flex-col gap-0.5">
                      <span className="text-sm font-semibold text-text-primary">
                        QA health
                      </span>
                      <span className="text-[13px] text-text-secondary">
                        {passed + failed + na}/{total} checks reviewed
                      </span>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[13px]">
                    <span className="inline-flex items-center gap-1.5 text-text-secondary">
                      <span className="size-2 rounded-full bg-success" /> {passed}{" "}
                      passed
                    </span>
                    <span className="inline-flex items-center gap-1.5 text-text-secondary">
                      <span className="size-2 rounded-full bg-error" /> {failed}{" "}
                      failed
                    </span>
                    <span className="inline-flex items-center gap-1.5 text-text-secondary">
                      <span className="size-2 rounded-full bg-text-muted" /> {na}{" "}
                      N/A
                    </span>
                    {total - passed - failed - na > 0 && (
                      <span className="inline-flex items-center gap-1.5 text-text-muted">
                        <span className="size-2 rounded-full border border-border-soft" />{" "}
                        {total - passed - failed - na} left
                      </span>
                    )}
                  </div>
                  <CertStatusControl
                    certId={page.certificate.id}
                    status={page.certificate.status}
                    path={path}
                  />
                  {page.certificate.completedAt && (
                    <span className="text-xs text-text-muted">
                      Signed off{" "}
                      {page.certificate.completedAt.toLocaleDateString()}
                    </span>
                  )}
                </>
              );
            })()
          ) : (
            <>
              <span className="text-sm font-semibold text-text-primary">
                QA certificate
              </span>
              <p className="text-[13px] text-text-secondary">
                No certificate for this page.
              </p>
            </>
          )}
        </Card>
      </div>

      {/* QA checklist */}
      {page.certificate && (
        <div className="mb-8">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-text-primary">
              QA checklist
            </h2>
            <AiQaButton
              certId={page.certificate.id}
              pageId={page.id}
              defaultUrl={page.url ?? ""}
              path={path}
            />
          </div>
          <QAChecklist items={page.certificate.items} path={path} />
        </div>
      )}

      {/* Issues */}
      <IssueLog issues={page.issues} path={path} />
    </>
  );
}
