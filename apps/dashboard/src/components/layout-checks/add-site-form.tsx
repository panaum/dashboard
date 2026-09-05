"use client";

import { useActionState, useEffect, useRef } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { addLayoutSite } from "@/app/dashboard/layout-checks/actions";

const field =
  "h-10 rounded-lg border border-border-soft bg-card px-3 text-sm text-text-primary shadow-xs outline-none transition-colors placeholder:text-text-muted focus:border-accent/50";

export function AddSiteForm() {
  const [state, action, pending] = useActionState(addLayoutSite, {} as { error?: string; ok?: boolean });
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state?.ok) formRef.current?.reset();
  }, [state]);

  return (
    <form ref={formRef} action={action} className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <input name="url" type="text" required placeholder="https://client.com/landing-page"
               className={`${field} min-w-[18rem] flex-1`} aria-label="Page URL" />
        <input name="label" type="text" placeholder="Name (optional)"
               className={`${field} w-44`} aria-label="Name for this page" />
        <Button type="submit" disabled={pending}>
          <Plus className="size-4" /> {pending ? "Adding…" : "Add page"}
        </Button>
      </div>
      {state?.error && <p className="text-[13px] text-error">{state.error}</p>}
    </form>
  );
}
