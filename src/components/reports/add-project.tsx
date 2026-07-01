"use client";

import { useActionState } from "react";
import { Plus } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { FormFooter, useOnOk } from "@/components/forms/form-parts";
import { saveProject } from "@/app/dashboard/clients/[clientId]/actions";
import { PLATFORMS, STATUSES, label } from "@/lib/constants";

type Client = { id: string; name: string };
type Member = { id: string; name: string; role: string };

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function monthLabel(m: string) {
  const [y, mo] = m.split("-");
  return `${MONTH_NAMES[Number(mo) - 1] ?? mo} ${y}`;
}

/**
 * Adds a landing-page deliverable straight into the selected month's report.
 * The delivery month is fixed to the month you're viewing (posted as a hidden
 * field), so this is the "pick a month, then add its projects" workflow. Posts
 * to the shared `saveProject` action — a LANDING_PAGE project creates its single
 * page (carrying the month) up front.
 */
function MonthProjectForm({
  close,
  clients,
  members,
  month,
}: {
  close: () => void;
  clients: Client[];
  members: Member[];
  month: string;
}) {
  const [state, action, pending] = useActionState(saveProject, {});
  useOnOk(state, close);

  const developers = members.filter((m) => m.role !== "TESTER");
  const testers = members.filter((m) => m.role === "TESTER");

  return (
    <form action={action} className="flex flex-col gap-4">
      {/* Fixed context: this deliverable lands in the viewed month, as a page. */}
      <input type="hidden" name="type" value="LANDING_PAGE" />
      <input type="hidden" name="deliveryMonth" value={month} />

      <p className="rounded-lg bg-card-soft px-3 py-2 text-[13px] text-text-secondary">
        Adding to <span className="font-semibold text-text-primary">{monthLabel(month)}</span>.
      </p>

      <Field label="Client" htmlFor="clientId">
        <Select id="clientId" name="clientId" required defaultValue="">
          <option value="" disabled>
            Select a client…
          </option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
      </Field>

      <Field label="Deliverable name" htmlFor="name">
        <Input
          id="name"
          name="name"
          placeholder="e.g. Spring Sale LP"
          autoFocus
          required
        />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Platform" htmlFor="platform">
          <Select id="platform" name="platform" defaultValue="WORDPRESS">
            {PLATFORMS.map((p) => (
              <option key={p} value={p}>
                {label(p)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Status" htmlFor="status">
          <Select id="status" name="status" defaultValue="IN_PROGRESS">
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {label(s)}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Developer" htmlFor="developerId">
          <Select id="developerId" name="developerId" defaultValue="">
            <option value="">Unassigned</option>
            {developers.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Tester" htmlFor="testerId">
          <Select id="testerId" name="testerId" defaultValue="">
            <option value="">Unassigned</option>
            {testers.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <Field label="URL" htmlFor="url" hint="Optional live or staging link.">
        <Input id="url" name="url" type="url" placeholder="https://…" />
      </Field>

      <FormFooter pending={pending} error={state.error} close={close} />
    </form>
  );
}

/** "New deliverable" button on the Monthly report, pre-scoped to `month`. */
export function AddProjectForMonth({
  clients,
  members,
  month,
}: {
  clients: Client[];
  members: Member[];
  month: string;
}) {
  return (
    <Dialog
      title="New deliverable"
      trigger={
        <Button size="sm">
          <Plus /> New deliverable
        </Button>
      }
    >
      {(close) => (
        <MonthProjectForm
          close={close}
          clients={clients}
          members={members}
          month={month}
        />
      )}
    </Dialog>
  );
}
