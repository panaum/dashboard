"use client";

import { useActionState } from "react";
import { Field, Input, Textarea, Select } from "@/components/ui/field";
import { FormFooter, useOnOk } from "@/components/forms/form-parts";
import { saveIssue } from "@/app/dashboard/clients/[clientId]/[projectId]/[pageId]/actions";
import { SEVERITIES, ISSUE_STATUSES, label } from "@/lib/constants";

type Path = { clientId: string; projectId: string; pageId: string };
type IssueInitial = {
  id: string;
  title: string;
  description: string | null;
  severity: string;
  status: string;
};

export function IssueForm({
  close,
  path,
  initial,
}: {
  close: () => void;
  path: Path;
  initial?: IssueInitial;
}) {
  const [state, action, pending] = useActionState(saveIssue, {});
  useOnOk(state, close);

  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="clientId" value={path.clientId} />
      <input type="hidden" name="projectId" value={path.projectId} />
      <input type="hidden" name="pageId" value={path.pageId} />
      {initial && <input type="hidden" name="id" value={initial.id} />}

      <Field label="Title" htmlFor="title">
        <Input
          id="title"
          name="title"
          defaultValue={initial?.title}
          placeholder="e.g. CTA button overlaps on mobile"
          autoFocus
          required
        />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Severity" htmlFor="severity">
          <Select
            id="severity"
            name="severity"
            defaultValue={initial?.severity ?? "LOW"}
          >
            {SEVERITIES.map((s) => (
              <option key={s} value={s}>
                {label(s)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Status" htmlFor="status">
          <Select
            id="status"
            name="status"
            defaultValue={initial?.status ?? "OPEN"}
          >
            {ISSUE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {label(s)}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <Field label="Description" htmlFor="description">
        <Textarea
          id="description"
          name="description"
          defaultValue={initial?.description ?? ""}
          placeholder="Optional detail or steps to reproduce."
        />
      </Field>

      <FormFooter pending={pending} error={state.error} close={close} />
    </form>
  );
}
