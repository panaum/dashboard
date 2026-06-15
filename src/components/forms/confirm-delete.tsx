"use client";

import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

export function ConfirmDelete({
  action,
  fields,
  trigger,
  title,
  description,
}: {
  action: (formData: FormData) => void | Promise<void>;
  fields: Record<string, string>;
  trigger: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <Dialog trigger={trigger} title={title}>
      {(close) => (
        <form action={action} className="flex flex-col gap-5">
          {Object.entries(fields).map(([name, value]) => (
            <input key={name} type="hidden" name={name} value={value} />
          ))}
          <p className="text-sm text-text-secondary">{description}</p>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={close}>
              Cancel
            </Button>
            <Button type="submit" variant="destructive">
              Delete
            </Button>
          </div>
        </form>
      )}
    </Dialog>
  );
}
