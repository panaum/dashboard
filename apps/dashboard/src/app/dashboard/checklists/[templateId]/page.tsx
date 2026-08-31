import { notFound } from "next/navigation";
import { Trash2 } from "lucide-react";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/shared/page-header";
import { Breadcrumbs } from "@/components/shared/breadcrumbs";
import { ConfirmDelete } from "@/components/forms/confirm-delete";
import { TemplateEditor } from "@/components/checklists/template-editor";
import { deleteTemplate } from "../actions";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ templateId: string }>;
}) {
  const { templateId } = await params;
  const t = await db.checklistTemplate.findUnique({
    where: { id: templateId },
    select: { name: true },
  });
  return { title: t?.name ?? "Checklist" };
}

export default async function TemplateEditorPage({
  params,
}: {
  params: Promise<{ templateId: string }>;
}) {
  const { templateId } = await params;
  const template = await db.checklistTemplate.findUnique({
    where: { id: templateId },
    include: { items: { orderBy: { order: "asc" } } },
  });
  if (!template) notFound();

  return (
    <>
      <Breadcrumbs
        items={[
          { label: "QA checklists", href: "/dashboard/checklists" },
          { label: template.name },
        ]}
      />
      <PageHeader
        title={template.name}
        subtitle={`${template.items.length} check${template.items.length === 1 ? "" : "s"}${template.isDefault ? " · default" : ""}`}
        action={
          <ConfirmDelete
            action={deleteTemplate}
            fields={{ id: template.id }}
            title="Delete template"
            description={`Delete "${template.name}"? Existing pages keep their checklists.`}
            trigger={
              <button
                className="rounded-md p-1.5 text-text-secondary transition-colors hover:bg-error/10 hover:text-error"
                aria-label="Delete template"
              >
                <Trash2 className="size-4" />
              </button>
            }
          />
        }
      />

      <TemplateEditor
        template={{
          id: template.id,
          name: template.name,
          platform: template.platform,
          isDefault: template.isDefault,
        }}
        items={template.items.map((i) => ({
          id: i.id,
          category: i.category,
          name: i.name,
          hasDualValue: i.hasDualValue,
          isMeasurement: i.isMeasurement,
          origin: i.origin,
          originAt: i.originAt ? i.originAt.toISOString().slice(0, 10) : null,
        }))}
      />
    </>
  );
}
