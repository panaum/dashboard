import Link from "next/link";
import { ListChecks, ChevronRight, Plus, Trash2 } from "lucide-react";
import { db } from "@/lib/db";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { ConfirmDelete } from "@/components/forms/confirm-delete";
import { createTemplate, deleteTemplate } from "./actions";
import { label } from "@/lib/constants";

export default async function ChecklistsPage() {
  const templates = await db.checklistTemplate.findMany({
    orderBy: [{ isDefault: "desc" }, { name: "asc" }],
    include: { _count: { select: { items: true } } },
  });

  const newButton = (
    <form action={createTemplate}>
      <Button type="submit">
        <Plus /> New template
      </Button>
    </form>
  );

  return (
    <>
      <PageHeader
        title="QA checklists"
        subtitle="Reusable checklist templates seeded into each new page."
        action={newButton}
      />

      {templates.length === 0 ? (
        <EmptyState
          icon={ListChecks}
          title="No templates yet"
          description="Create a checklist template to standardise how the team QAs deliverables."
          action={newButton}
        />
      ) : (
        <div className="overflow-hidden rounded-xl border border-border-soft bg-card">
          {templates.map((t) => (
            <div
              key={t.id}
              className="flex items-center gap-3 border-t border-border-soft px-4 py-3.5 transition-colors first:border-t-0 hover:bg-card-soft"
            >
              <Link
                href={`/dashboard/checklists/${t.id}`}
                className="group flex min-w-0 flex-1 items-center gap-3"
              >
                <ListChecks className="size-4 shrink-0 text-text-muted" />
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm font-medium text-text-primary group-hover:underline">
                    {t.name}
                  </span>
                  <span className="text-[13px] text-text-secondary">
                    {t._count.items} check{t._count.items === 1 ? "" : "s"} ·{" "}
                    {t.platform ? label(t.platform) : "Any platform"}
                  </span>
                </div>
                {t.isDefault && <Badge tone="brand">Default</Badge>}
              </Link>
              <ConfirmDelete
                action={deleteTemplate}
                fields={{ id: t.id }}
                title="Delete template"
                description={`Delete "${t.name}"? Existing pages keep their checklists.`}
                trigger={
                  <button
                    className="rounded-md p-1.5 text-text-secondary transition-colors hover:bg-error/10 hover:text-error"
                    aria-label="Delete template"
                  >
                    <Trash2 className="size-4" />
                  </button>
                }
              />
              <ChevronRight className="size-4 shrink-0 text-text-muted" />
            </div>
          ))}
        </div>
      )}
    </>
  );
}
