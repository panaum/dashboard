"use client";

import { useState, useTransition } from "react";
import { LogOut } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { leaveWorkspace } from "@/app/dashboard/personalization/actions";

/** "Leave the workspace", behind one confirmation that says plainly what
 *  happens: signed out for good, work kept, an admin can undo it. */
export function LeaveWorkspace() {
  return (
    <Dialog
      title="Leave the workspace?"
      trigger={
        <Button type="button" variant="secondary" className="hover:border-error/50 hover:bg-error/[0.06] hover:text-error-strong">
          <LogOut /> Leave the workspace
        </Button>
      }
    >
      {(close) => <Confirm close={close} />}
    </Dialog>
  );
}

function Confirm({ close }: { close: () => void }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm leading-relaxed text-text-secondary">
        You’ll be signed out and won’t be able to sign back in. Everything you built, reported and commented stays, with your name on it. If you change your mind, an admin can restore your access.
      </p>
      {error && <p className="text-xs text-error-strong" role="status">{error}</p>}
      <div className="flex justify-end gap-3">
        <Button type="button" variant="ghost" onClick={close} disabled={pending}>Stay</Button>
        <Button
          type="button"
          variant="destructive"
          disabled={pending}
          onClick={() => start(async () => {
            const r = await leaveWorkspace();
            if (r?.error) setError(r.error);
          })}
        >
          {pending ? "Leaving…" : "Leave"}
        </Button>
      </div>
    </div>
  );
}
