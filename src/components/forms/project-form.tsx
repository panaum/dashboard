"use client";

import { useActionState } from "react";
import { Field, Input, Select } from "@/components/ui/field";
import { FormFooter, useOnOk } from "@/components/forms/form-parts";
import { saveProject } from "@/app/dashboard/clients/[clientId]/actions";
import {
  PROJECT_TYPES,
  PLATFORMS,
  STATUSES,
  label,
} from "@/lib/constants";

type ProjectInitial = {
  id: string;
  name: string;
  type: string;
  platform: string;
  url: string | null;
  status: string;
};

export function ProjectForm({
  close,
  clientId,
  initial,
}: {
  close: () => void;
  clientId: string;
  initial?: ProjectInitial;
}) {
  const [state, action, pending] = useActionState(saveProject, {});
  useOnOk(state, close);

  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="clientId" value={clientId} />
      {initial && <input type="hidden" name="id" value={initial.id} />}

      <Field label="Project name" htmlFor="name">
        <Input
          id="name"
          name="name"
          defaultValue={initial?.name}
          placeholder="e.g. Savvio Website"
          autoFocus
          required
        />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Type" htmlFor="type">
          <Select id="type" name="type" defaultValue={initial?.type ?? "WEBSITE"}>
            {PROJECT_TYPES.map((t) => (
              <option key={t} value={t}>
                {label(t)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Platform" htmlFor="platform">
          <Select
            id="platform"
            name="platform"
            defaultValue={initial?.platform ?? "WORDPRESS"}
          >
            {PLATFORMS.map((p) => (
              <option key={p} value={p}>
                {label(p)}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <Field label="Status" htmlFor="status">
        <Select
          id="status"
          name="status"
          defaultValue={initial?.status ?? "IN_PROGRESS"}
        >
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {label(s)}
            </option>
          ))}
        </Select>
      </Field>

      <Field label="URL" htmlFor="url" hint="Optional live or staging link.">
        <Input
          id="url"
          name="url"
          type="url"
          defaultValue={initial?.url ?? ""}
          placeholder="https://…"
        />
      </Field>

      <FormFooter pending={pending} error={state.error} close={close} />
    </form>
  );
}
