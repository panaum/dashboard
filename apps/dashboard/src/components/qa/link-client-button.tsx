"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Link2, Loader2 } from "lucide-react";
import { linkClientToLinkSpy } from "@/app/dashboard/clients/[clientId]/link-actions";

// "Link to LinkSpy" — a DELIBERATE operator action, one client at a time.
// There is no bulk sweep and no auto-linking anywhere in this feature: linking
// mints or claims a registry id, and registry ids are eternal (§8.2). Getting
// one wrong is expensive to undo, so a human presses this per client.
//
// Mirrors the page-level RegistryLink affordance from Phase 1.
export function LinkClientButton({
  clientId,
  clientName,
}: {
  clientId: string;
  clientName: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [existingId, setExistingId] = useState("");
  const [open, setOpen] = useState(false);

  async function submit() {
    setBusy(true);
    setError(null);
    const res = await linkClientToLinkSpy(clientId, existingId.trim() || undefined);
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setOpen(false);
    startTransition(() => router.refresh());
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-md border border-border-soft bg-card px-2.5 py-1 text-xs text-text-secondary transition-colors hover:border-accent/40 hover:text-text-primary"
      >
        <Link2 className="size-3.5" /> Link to LinkSpy
      </button>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        value={existingId}
        onChange={(e) => setExistingId(e.target.value)}
        placeholder="LinkSpy client id (optional)"
        className="h-7 w-56 rounded-md border border-border-soft bg-card px-2 text-xs text-text-primary outline-none focus:border-accent/50"
      />
      <button
        onClick={submit}
        disabled={busy || pending}
        className="inline-flex items-center gap-1.5 rounded-md bg-accent px-2.5 py-1 text-xs text-white disabled:opacity-60"
      >
        {busy || pending ? <Loader2 className="size-3.5 animate-spin" /> : <Link2 className="size-3.5" />}
        Link {clientName}
      </button>
      <button
        onClick={() => { setOpen(false); setError(null); }}
        className="text-xs text-text-muted hover:text-text-secondary"
      >
        Cancel
      </button>
      {/* Leave the id blank and LinkSpy matches by name, or creates the client. */}
      {error && <span className="text-xs text-error">{error}</span>}
    </div>
  );
}
