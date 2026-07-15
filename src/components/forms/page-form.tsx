"use client";

import { useActionState } from "react";
import { Field, Input, Select } from "@/components/ui/field";
import { FormFooter, useOnOk } from "@/components/forms/form-parts";
import { savePage } from "@/app/dashboard/clients/[clientId]/[projectId]/actions";
import { RegistryCreateField } from "@/components/qa/registry-create-field";
import { STATUSES, label } from "@/lib/constants";

type Member = { id: string; name: string; role: string };
type PageInitial = {
  id: string;
  name: string;
  url: string | null;
  status: string;
  developerId: string | null;
  testerId: string | null;
  delayDays: number;
  deliveryMonth: string | null;
  issueCount?: number;
};

export function PageForm({
  close,
  clientId,
  projectId,
  members,
  initial,
}: {
  close: () => void;
  clientId: string;
  projectId: string;
  members: Member[];
  initial?: PageInitial;
}) {
  const [state, action, pending] = useActionState(savePage, {});
  useOnOk(state, close);

  const developers = members.filter((m) => m.role !== "TESTER");
  const testers = members.filter((m) => m.role !== "DEVELOPER");

  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="clientId" value={clientId} />
      <input type="hidden" name="projectId" value={projectId} />
      {initial && <input type="hidden" name="id" value={initial.id} />}

      <Field label="Page name" htmlFor="name">
        <Input
          id="name"
          name="name"
          defaultValue={initial?.name}
          placeholder="e.g. Home Page"
          autoFocus
          required
        />
      </Field>

      <div className="grid grid-cols-2 gap-3">
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
        <Field label="Delivery month" htmlFor="deliveryMonth">
          <Input
            id="deliveryMonth"
            name="deliveryMonth"
            type="month"
            defaultValue={initial?.deliveryMonth ?? ""}
          />
        </Field>
      </div>

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

      <div className="grid grid-cols-2 gap-3">
        <Field label="Delay (days)" htmlFor="delayDays">
          <Input
            id="delayDays"
            name="delayDays"
            type="number"
            min={0}
            defaultValue={initial?.delayDays ?? 0}
          />
        </Field>
        <Field label="Issues" htmlFor="issueCount">
          <Input
            id="issueCount"
            name="issueCount"
            type="number"
            min={0}
            defaultValue={initial?.issueCount ?? 0}
          />
        </Field>
      </div>

      <Field label="URL" htmlFor="url">
        <Input
          id="url"
          name="url"
          type="url"
          defaultValue={initial?.url ?? ""}
          placeholder="https://…"
        />
      </Field>

      {/* Mapping-at-creation (new pages only). Untouched = no hidden inputs =
          byte-identical create path. */}
      {!initial && <RegistryCreateField />}

      <FormFooter pending={pending} error={state.error} close={close} />
    </form>
  );
}
