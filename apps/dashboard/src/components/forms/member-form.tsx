"use client";

import { useActionState } from "react";
import { Field, Input, Select } from "@/components/ui/field";
import { FormFooter, useOnOk } from "@/components/forms/form-parts";
import { saveMember } from "@/app/dashboard/team/actions";
import { MEMBER_ROLES, label } from "@/lib/constants";

type MemberInitial = { id: string; name: string; role: string; slackUserId?: string | null };

export function MemberForm({
  close,
  initial,
}: {
  close: () => void;
  initial?: MemberInitial;
}) {
  const [state, action, pending] = useActionState(saveMember, {});
  useOnOk(state, close);

  return (
    <form action={action} className="flex flex-col gap-4">
      {initial && <input type="hidden" name="id" value={initial.id} />}
      <Field label="Name" htmlFor="name">
        <Input
          id="name"
          name="name"
          defaultValue={initial?.name}
          placeholder="e.g. Samiya"
          autoFocus
          required
        />
      </Field>
      <Field label="Role" htmlFor="role">
        <Select id="role" name="role" defaultValue={initial?.role ?? "DEVELOPER"}>
          {MEMBER_ROLES.filter((r) => r !== "BOTH").map((r) => (
            <option key={r} value={r}>
              {label(r)}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Slack member ID" htmlFor="slackUserId" hint="From their Slack profile → Copy member ID (starts with U). Lets a board @mention ping them.">
        <Input id="slackUserId" name="slackUserId" defaultValue={initial?.slackUserId ?? ""} placeholder="U0123ABCD" pattern="[UW][A-Z0-9]{5,}" />
      </Field>
      <FormFooter pending={pending} error={state.error} close={close} />
    </form>
  );
}
