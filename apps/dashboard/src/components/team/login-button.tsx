"use client";

import { KeyRound } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { LoginForm } from "@/components/team/login-form";

export function LoginButton({
  member,
}: {
  member: { id: string; name: string; email: string | null; hasLogin: boolean };
}) {
  return (
    <Dialog
      title={member.hasLogin ? `Login for ${member.name}` : `Give ${member.name} a login`}
      trigger={
        <button
          className="rounded-md p-1.5 text-text-secondary hover:bg-card-soft hover:text-text-primary"
          aria-label={member.hasLogin ? "Edit login" : "Create login"}
          title={member.hasLogin ? "Edit login" : "No login yet — create one"}
        >
          <KeyRound className={member.hasLogin ? "size-4" : "size-4 text-warning"} />
        </button>
      }
    >
      {(close) => <LoginForm member={member} close={close} />}
    </Dialog>
  );
}
