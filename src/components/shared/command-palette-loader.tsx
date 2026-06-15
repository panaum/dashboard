import { db } from "@/lib/db";
import { CommandPalette, type CommandItem } from "./command-palette";

/** Builds the searchable index (clients, projects, pages) for ⌘K. */
export async function CommandPaletteLoader() {
  const [clients, projects, pages] = await Promise.all([
    db.client.findMany({ select: { id: true, name: true } }),
    db.project.findMany({
      select: {
        id: true,
        name: true,
        clientId: true,
        client: { select: { name: true } },
      },
    }),
    db.page.findMany({
      select: {
        id: true,
        name: true,
        projectId: true,
        project: {
          select: { clientId: true, name: true, client: { select: { name: true } } },
        },
      },
    }),
  ]);

  const items: CommandItem[] = [
    ...clients.map((c) => ({
      id: `client:${c.id}`,
      type: "Client" as const,
      label: c.name,
      href: `/dashboard/clients/${c.id}`,
    })),
    ...projects.map((p) => ({
      id: `project:${p.id}`,
      type: "Project" as const,
      label: p.name,
      sublabel: p.client.name,
      href: `/dashboard/clients/${p.clientId}/${p.id}`,
    })),
    ...pages.map((pg) => ({
      id: `page:${pg.id}`,
      type: "Page" as const,
      label: pg.name,
      sublabel: `${pg.project.client.name} · ${pg.project.name}`,
      href: `/dashboard/clients/${pg.project.clientId}/${pg.projectId}/${pg.id}`,
    })),
  ];

  return <CommandPalette items={items} />;
}
