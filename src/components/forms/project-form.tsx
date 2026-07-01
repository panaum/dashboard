"use client";

import { useActionState, useState } from "react";
import { Field, Input, Select } from "@/components/ui/field";
import { FormFooter, useOnOk } from "@/components/forms/form-parts";
import { saveProject } from "@/app/dashboard/clients/[clientId]/actions";
import { PROJECT_TYPES, PLATFORMS, STATUSES, label } from "@/lib/constants";

type Member = { id: string; name: string; role: string };

type ProjectInitial = {
  id: string;
  name: string;
  type: string;
  platform: string;
  url: string | null;
  status: string;
  developerId?: string | null;
  testerId?: string | null;
  deliveryMonth?: string | null;
};

/** Current month as "YYYY-MM" — the default so a new project lands in this month. */
function currentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function ProjectForm({
  close,
  clientId,
  members = [],
  initial,
}: {
  close: () => void;
  clientId: string;
  members?: Member[];
  initial?: ProjectInitial;
}) {
  const [state, action, pending] = useActionState(saveProject, {});
  useOnOk(state, close);

  const [type, setType] = useState(initial?.type ?? "WEBSITE");
  const developers = members.filter((m) => m.role !== "TESTER");
  const testers = members.filter((m) => m.role === "TESTER");

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
          <Select
            id="type"
            name="type"
            value={type}
            onChange={(e) => setType(e.target.value)}
          >
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

      {/* Landing pages are a single page, so set its delivery month and assign
          its developer/tester here (all three actually live on the page). */}
      {type === "LANDING_PAGE" && (
        <>
          <Field
            label="Delivery month"
            htmlFor="deliveryMonth"
            hint="Which month's report this lands in. Defaults to this month."
          >
            <Input
              id="deliveryMonth"
              name="deliveryMonth"
              type="month"
              defaultValue={initial?.deliveryMonth ?? currentMonth()}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Developer" htmlFor="developerId">
              <Select
                id="developerId"
                name="developerId"
                defaultValue={initial?.developerId ?? ""}
              >
                <option value="">Unassigned</option>
                {developers.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Tester" htmlFor="testerId">
              <Select
                id="testerId"
                name="testerId"
                defaultValue={initial?.testerId ?? ""}
              >
                <option value="">Unassigned</option>
                {testers.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        </>
      )}

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
