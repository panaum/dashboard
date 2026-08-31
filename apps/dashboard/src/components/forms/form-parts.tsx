"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import type { ActionResult } from "@/lib/validation";

/** Runs a side-effect (close dialog + refresh) when an action returns ok. */
export function useOnOk(state: ActionResult, close: () => void) {
  const router = useRouter();
  React.useEffect(() => {
    if (state.ok) {
      close();
      router.refresh();
    }
  }, [state, close, router]);
}

export function FormFooter({
  pending,
  error,
  close,
  submitLabel = "Save",
}: {
  pending: boolean;
  error?: string;
  close: () => void;
  submitLabel?: string;
}) {
  return (
    <div className="mt-2 flex flex-col gap-3">
      {error && <p className="text-[13px] text-error">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={close}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : submitLabel}
        </Button>
      </div>
    </div>
  );
}
