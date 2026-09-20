"use client";

import { useActionState, useEffect } from "react";
import { setLogin } from "@/app/dashboard/team/actions";
import { Button } from "@/components/ui/button";

const field =
  "rounded-md border border-border-soft bg-card px-3 py-2 text-sm text-text-primary outline-none transition-colors focus:border-accent";

/** Give someone a login, or reset one. Passwords are set by an admin by hand:
 *  there is no mail service wired up, so a self-serve reset would have nowhere
 *  to send. Leaving the password blank keeps the existing one. */
export function LoginForm({
  member,
  close,
}: {
  member: { id: string; name: string; email: string | null; hasLogin: boolean };
  close: () => void;
}) {
  const [state, action, pending] = useActionState(
    setLogin,
    {} as { ok?: boolean; error?: string },
  );

  useEffect(() => {
    if (state?.ok) close();
  }, [state, close]);

  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="id" value={member.id} />

      <div className="flex flex-col gap-1.5">
        <label htmlFor="login-email" className="text-[13px] font-medium text-text-secondary">
          Email
        </label>
        <input
          id="login-email"
          name="email"
          type="email"
          required
          defaultValue={member.email ?? ""}
          placeholder="name@apexure.com"
          className={field}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="login-password" className="text-[13px] font-medium text-text-secondary">
          {member.hasLogin ? "New password" : "Password"}
        </label>
        <input
          id="login-password"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={12}
          required={!member.hasLogin}
          placeholder={member.hasLogin ? "Leave blank to keep the current one" : "At least 12 characters"}
          className={field}
        />
        <p className="text-[12px] text-text-muted">
          You set this and pass it to {member.name}. There is no email reset — tell
          them to change it with you if it leaks.
        </p>
      </div>

      {state?.error && <p className="text-[13px] text-error">{state.error}</p>}

      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={close}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : member.hasLogin ? "Update login" : "Create login"}
        </Button>
      </div>
    </form>
  );
}
