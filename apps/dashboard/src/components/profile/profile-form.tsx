"use client";

import { useActionState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { PhotoField, ProfileFields, type ProfileMember } from "@/components/forms/profile-fields";
import { saveProfile } from "@/app/dashboard/personalization/actions";

/** A person editing themselves: the shared ProfileFields posting to
 *  saveProfile, which only ever writes the signed-in person's own row. */
export function ProfileForm({
  member,
  submitLabel = "Save changes",
  onSaved,
  secondary,
}: {
  member: ProfileMember;
  submitLabel?: string;
  onSaved?: () => void;
  /** An extra action beside the submit button (onboarding's "Skip"). */
  secondary?: React.ReactNode;
}) {
  const [state, action, pending] = useActionState(saveProfile, {});
  useEffect(() => { if (state.ok) onSaved?.(); }, [state, onSaved]);

  return (
    <div className="flex flex-col gap-5">
      <PhotoField member={member} />
      <form action={action} className="flex flex-col gap-4">
        <ProfileFields member={member} />
        <div className="flex flex-wrap items-center justify-end gap-3">
          <span className="mr-auto text-xs" role="status">
            {state.error ? <span className="text-error-strong">{state.error}</span>
              : state.ok && !onSaved ? <span className="text-text-secondary">Saved.</span> : null}
          </span>
          {secondary}
          <Button type="submit" disabled={pending}>{pending ? "Saving…" : submitLabel}</Button>
        </div>
      </form>
    </div>
  );
}
