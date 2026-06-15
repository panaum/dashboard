"use client";

import { useActionState } from "react";
import { Field, Input, Textarea } from "@/components/ui/field";
import { FormFooter, useOnOk } from "@/components/forms/form-parts";
import { saveClient } from "@/app/dashboard/clients/actions";

type ClientInitial = { id: string; name: string; notes: string | null };

export function ClientForm({
  close,
  initial,
}: {
  close: () => void;
  initial?: ClientInitial;
}) {
  const [state, action, pending] = useActionState(saveClient, {});
  useOnOk(state, close);

  return (
    <form action={action} className="flex flex-col gap-4">
      {initial && <input type="hidden" name="id" value={initial.id} />}
      <Field label="Client name" htmlFor="name">
        <Input
          id="name"
          name="name"
          defaultValue={initial?.name}
          placeholder="e.g. Savvio"
          autoFocus
          required
        />
      </Field>
      <Field label="Notes" htmlFor="notes">
        <Textarea
          id="notes"
          name="notes"
          defaultValue={initial?.notes ?? ""}
          placeholder="Optional context about this client."
        />
      </Field>
      <FormFooter pending={pending} error={state.error} close={close} />
    </form>
  );
}
