import Link from "next/link";
import { notFound } from "next/navigation";
import { Trash2 } from "lucide-react";
import { db } from "@/lib/db";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/shared/page-header";
import { Breadcrumbs } from "@/components/shared/breadcrumbs";
import { OpenSite } from "@/components/shared/open-site";
import { StatusSelect } from "@/components/shared/status-select";
import { EmptyState } from "@/components/shared/empty-state";
import { QARing } from "@/components/qa/qa-ring";
import { FileText } from "lucide-react";
import {
  AddPageButton,
  EditPageButton,
  EditProjectButton,
} from "@/components/forms/dialogs";
import { ConfirmDelete } from "@/components/forms/confirm-delete";
import { deleteProject } from "../actions";
import { deletePage } from "./actions";
import { label, type Status } from "@/lib/constants";

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ clientId: string; projectId: string }>;
}) {
  const { clientId, projectId } = await params;
  const [project, members] = await Promise.all([
    db.project.findUnique({
      where: { id: projectId },
      include: {
        client: true,
        pages: {
          orderBy: { createdAt: "asc" },
          include: {
            developer: true,
            tester: true,
            certificate: {
              select: { status: true, items: { select: { result: true } } },
            },
            _count: { select: { issues: true } },
          },
        },
      },
    }),
    db.teamMember.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true, role: true },
    }),
  ]);
  if (!project || project.clientId !== clientId) notFound();

  return (
    <>
      <Breadcrumbs
        items={[
          { label: "Clients", href: "/dashboard/clients" },
          { label: project.client.name, href: `/dashboard/clients/${clientId}` },
          { label: project.name },
        ]}
      />
      <PageHeader
        title={project.name}
        subtitle={`${label(project.type)} · ${label(project.platform)}`}
        action={
          <div className="flex items-center gap-1">
            <EditProjectButton clientId={clientId} project={project} />
            <ConfirmDelete
              action={deleteProject}
              fields={{ id: project.id, clientId }}
              title="Delete project"
              description={`Delete ${project.name} and all its pages?`}
              trigger={
                <button
                  className="rounded-md p-1.5 text-text-secondary hover:bg-error/10 hover:text-error"
                  aria-label="Delete project"
                >
                  <Trash2 className="size-4" />
                </button>
              }
            />
            <span className="ml-2">
              <AddPageButton
                clientId={clientId}
                projectId={projectId}
                members={members}
              />
            </span>
          </div>
        }
      />

      {project.pages.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="No pages yet"
          description="Add the first page to start tracking delivery and QA."
          action={
            <AddPageButton
              clientId={clientId}
              projectId={projectId}
              members={members}
            />
          }
        />
      ) : (
        <div className="overflow-hidden rounded-xl border border-border-soft bg-card">
          {project.pages.map((pg, i) => (
            <div
              key={pg.id}
              style={{ animationDelay: `${Math.min(i, 14) * 30}ms` }}
              className="animate-in flex items-center gap-3 border-t border-border-soft px-4 py-3 transition-colors first:border-t-0 hover:bg-card-soft sm:gap-4"
            >
              <Link
                href={`/dashboard/clients/${clientId}/${projectId}/${pg.id}`}
                className="group flex min-w-0 flex-1 items-center gap-4"
              >
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="truncate text-sm font-medium text-text-primary group-hover:underline">
                    {pg.name}
                  </span>
                  <div
                    className="flex items-center gap-1.5"
                    title={`Built by ${pg.developer?.name ?? "—"} · QA ${pg.tester?.name ?? "—"}`}
                  >
                    {pg.developer ? (
                      <Avatar name={pg.developer.name} size="sm" />
                    ) : (
                      <span className="flex size-7 items-center justify-center rounded-full border border-dashed border-border-soft text-[11px] text-text-muted">
                        —
                      </span>
                    )}
                    {pg.tester && (
                      <Avatar name={pg.tester.name} size="sm" className="-ml-2.5 ring-2 ring-card" />
                    )}
                    <span className="ml-1 truncate text-[13px] text-text-secondary">
                      {pg.developer?.name ?? "Unassigned"}
                    </span>
                  </div>
                </div>
                <Badge
                  tone={pg._count.issues > 0 ? "warning" : "success"}
                  className="hidden shrink-0 sm:inline-flex"
                >
                  {pg._count.issues} issue{pg._count.issues === 1 ? "" : "s"}
                </Badge>
                {pg.certificate &&
                  (() => {
                    const it = pg.certificate.items;
                    const passed = it.filter((i) => i.result === "PASSED").length;
                    const failed = it.filter((i) => i.result === "FAILED").length;
                    const na = it.filter((i) => i.result === "NA").length;
                    return (
                      <span
                        className="shrink-0"
                        title={`QA ${passed + failed + na}/${it.length} done · ${failed} failed`}
                      >
                        <QARing
                          passed={passed}
                          failed={failed}
                          na={na}
                          total={it.length}
                          size={34}
                          stroke={4}
                          showLabel={false}
                        />
                      </span>
                    );
                  })()}
              </Link>
              <StatusSelect
                pageId={pg.id}
                status={pg.status as Status}
                clientId={clientId}
                projectId={projectId}
              />
              <div className="flex shrink-0 items-center gap-0.5">
                <OpenSite url={pg.url} />
                <EditPageButton
                  clientId={clientId}
                  projectId={projectId}
                  members={members}
                  page={pg}
                />
                <ConfirmDelete
                  action={deletePage}
                  fields={{ id: pg.id, projectId, clientId }}
                  title="Delete page"
                  description={`Delete ${pg.name} and its QA records?`}
                  trigger={
                    <button
                      className="rounded-md p-1.5 text-text-secondary transition-colors hover:bg-error/10 hover:text-error"
                      aria-label="Delete page"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  }
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
