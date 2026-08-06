import Link from "next/link";
import { notFound } from "next/navigation";
import { Trash2, FolderKanban } from "lucide-react";
import { db } from "@/lib/db";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/ui/status-badge";
import { PageHeader } from "@/components/shared/page-header";
import { Breadcrumbs } from "@/components/shared/breadcrumbs";
import { EmptyState } from "@/components/shared/empty-state";
import {
  AddProjectButton,
  EditProjectButton,
  EditClientButton,
} from "@/components/forms/dialogs";
import { ConfirmDelete } from "@/components/forms/confirm-delete";
import { PortalShare } from "@/components/portal/portal-share";
import { deleteClient } from "../actions";
import { deleteProject } from "./actions";
import { listPlatforms } from "@/lib/platforms";
import { getClientPresence } from "@/lib/linkspy/client-presence";
import { getClientIntelligence } from "@/lib/linkspy/client-intelligence";
import { ClientPresenceLine } from "@/components/qa/client-presence-line";
import { label, type Status } from "@/lib/constants";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ clientId: string }>;
}) {
  const { clientId } = await params;
  const c = await db.client.findUnique({
    where: { id: clientId },
    select: { name: true },
  });
  return { title: c?.name ?? "Client" };
}

export default async function ClientDetailPage({
  params,
}: {
  params: Promise<{ clientId: string }>;
}) {
  const { clientId } = await params;
  const [client, members, platforms] = await Promise.all([
    db.client.findUnique({
      where: { id: clientId },
      include: {
        projects: {
          orderBy: { updatedAt: "desc" },
          include: {
            _count: { select: { pages: true } },
            pages: {
              select: {
                developerId: true,
                testerId: true,
                deliveryMonth: true,
              },
            },
          },
        },
      },
    }),
    db.teamMember.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true, role: true },
    }),
    listPlatforms(),
  ]);
  if (!client) notFound();

  // Four production chips for this client. Two independent sources, one
  // renderer:
  //   CLIENT_INTELLIGENCE=1 → LinkSpy aggregates over sites.client_id — every
  //     site in production for this client. The superset, so it wins.
  //   PRESENCE=1            → sites resolved from Page.registrySiteId — the
  //     things we actually built for them. The fallback.
  // Both flags off, or neither returns chips → nothing renders. Never throws,
  // never blocks the page.
  const [intelligence, presence] = await Promise.all([
    getClientIntelligence(client.id),
    getClientPresence(client.id, client.name),
  ]);
  const chipView = intelligence.presence ? intelligence : presence;

  return (
    <>
      <Breadcrumbs
        items={[
          { label: "Clients", href: "/dashboard/clients" },
          { label: client.name },
        ]}
      />
      <PageHeader
        title={client.name}
        subtitle={client.notes ?? "Projects and deliverables for this client."}
        action={
          <div className="flex items-center gap-1">
            <EditClientButton client={client} />
            <ConfirmDelete
              action={deleteClient}
              fields={{ id: client.id }}
              title="Delete client"
              description={`Delete ${client.name} and all its projects, pages and QA records? This cannot be undone.`}
              trigger={
                <button
                  className="rounded-md p-1.5 text-text-secondary hover:bg-error/10 hover:text-error"
                  aria-label="Delete client"
                >
                  <Trash2 className="size-4" />
                </button>
              }
            />
            <span className="ml-2">
              <AddProjectButton clientId={client.id} members={members} platforms={platforms} />
            </span>
          </div>
        }
      />

      {/* Four production chips — client intelligence when available, else presence. */}
      <ClientPresenceLine presence={chipView.presence} hrefByChip={chipView.hrefByChip} />

      <PortalShare clientId={client.id} initialPortalId={client.portalId} />

      {client.projects.length === 0 ? (
        <EmptyState
          icon={FolderKanban}
          title="No projects yet"
          description={`Add the first website or landing page for ${client.name}.`}
          action={<AddProjectButton clientId={client.id} members={members} platforms={platforms} />}
        />
      ) : (
        <div className="overflow-hidden rounded-xl border border-border-soft bg-card">
          {client.projects.map((p, i) => (
            <div
              key={p.id}
              style={{ animationDelay: `${Math.min(i, 14) * 35}ms` }}
              className="animate-in flex items-center gap-4 border-t border-border-soft px-4 py-3.5 transition-colors first:border-t-0 hover:bg-card-soft"
            >
              <Link
                href={`/dashboard/clients/${client.id}/${p.id}`}
                className="group flex min-w-0 flex-1 items-center gap-4"
              >
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="truncate text-sm font-medium text-text-primary group-hover:underline">
                    {p.name}
                  </span>
                  <span className="truncate text-[13px] text-text-secondary">
                    {label(p.type)} · {p._count.pages} page
                    {p._count.pages === 1 ? "" : "s"}
                  </span>
                </div>
                <StatusBadge status={p.status as Status} />
                <Badge tone="neutral" className="hidden shrink-0 sm:inline-flex">
                  {label(p.platform)}
                </Badge>
              </Link>
              <div className="flex shrink-0 items-center gap-0.5">
                <EditProjectButton
                  clientId={client.id}
                  members={members}
                  platforms={platforms}
                  project={{
                    id: p.id,
                    name: p.name,
                    type: p.type,
                    platform: p.platform,
                    url: p.url,
                    status: p.status,
                    developerId: p.pages[0]?.developerId ?? null,
                    testerId: p.pages[0]?.testerId ?? null,
                    deliveryMonth: p.pages[0]?.deliveryMonth ?? null,
                  }}
                />
                <ConfirmDelete
                  action={deleteProject}
                  fields={{ id: p.id, clientId: client.id }}
                  title="Delete project"
                  description={`Delete ${p.name} and all its pages and QA records?`}
                  trigger={
                    <button
                      className="rounded-md p-1.5 text-text-secondary transition-colors hover:bg-error/10 hover:text-error"
                      aria-label="Delete project"
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
