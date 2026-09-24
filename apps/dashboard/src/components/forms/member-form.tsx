"use client";

import { useActionState } from "react";
import { Field, Input, Select } from "@/components/ui/field";
import { PhotoField, ProfileFields, type ProfileMember } from "@/components/forms/profile-fields";
import { FormFooter, useOnOk } from "@/components/forms/form-parts";
import { saveMember } from "@/app/dashboard/team/actions";
import { DESIGNATIONS, designationFor } from "@/lib/designations";

type MemberInitial = ProfileMember & {
  role: string;
  title?: string | null;
  slackUserId?: string | null;
};

export function MemberForm({
  close,
  initial,
}: {
  close: () => void;
  initial?: MemberInitial;
}) {
  const [state, action, pending] = useActionState(saveMember, {});
  useOnOk(state, close);

  const current = initial ? designationFor(initial) : DESIGNATIONS[0].title;
  const stock = DESIGNATIONS.map((d) => d.title);
  const options = stock.includes(current) ? stock : [current, ...stock];

  return (
    <form action={action} className="flex flex-col gap-4">
      {initial && <input type="hidden" name="id" value={initial.id} />}

      {initial ? (
        <PhotoField member={initial} />
      ) : (
        <p className="rounded-md bg-card-soft px-3 py-2 text-xs text-text-secondary">
          Add the person first — their photo can be set from this dialog once they exist.
        </p>
      )}

      <ProfileFields member={initial} autoFocus />
      {/* One field where there were two. The designation is what shows under
          their name AND what decides the work they are offered — see
          src/lib/designations.ts. A title typed before this change is kept as
          an extra option so opening this dialog never relabels anyone. */}
      <Field
        label="Role"
        htmlFor="title"
        hint="Shown under their name, and what page and board assignment lists read. A manager appears in neither."
      >
        <Select id="title" name="title" defaultValue={current}>
          {options.map((t) => (
            <option key={t} value={t}>
              {t}
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
