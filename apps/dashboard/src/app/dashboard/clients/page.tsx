import { Users } from "lucide-react";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { AddClientButton } from "@/components/forms/dialogs";
import { ClientDirectory, type ClientRow } from "@/components/clients/client-directory";

export const metadata = { title: "Clients" };

export default async function ClientsPage() {
  const clients = await db.client.findMany({
    orderBy: { name: "asc" },
    include: {
      _count: { select: { projects: true } },
      projects: { select: { _count: { select: { pages: true } } } },
    },
  });

  const rows: ClientRow[] = clients.map((c) => ({
    id: c.id,
    name: c.name,
    projects: c._count.projects,
    pages: c.projects.reduce((n, p) => n + p._count.pages, 0),
  }));

  return (
    <>
      <PageHeader
        title="Clients"
        subtitle={`${rows.length} client${rows.length === 1 ? "" : "s"} and the deliverables built for them.`}
        action={<AddClientButton />}
      />

      {rows.length === 0 ? (
        <EmptyState
          icon={Users}
          title="No clients yet"
          description="Add your first client to start tracking their websites and landing pages."
          action={<AddClientButton />}
        />
      ) : (
        <ClientDirectory clients={rows} />
      )}
    </>
  );
}
