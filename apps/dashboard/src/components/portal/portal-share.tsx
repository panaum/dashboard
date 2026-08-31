"use client";

import { useState, useTransition } from "react";
import { LayoutGrid, Copy, Check, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  createPortalLink,
  revokePortalLink,
} from "@/app/dashboard/clients/[clientId]/actions";

export function PortalShare({
  clientId,
  initialPortalId,
}: {
  clientId: string;
  initialPortalId: string | null;
}) {
  const [portalId, setPortalId] = useState<string | null>(initialPortalId);
  const [pending, startTransition] = useTransition();
  const [copied, setCopied] = useState(false);

  const url =
    portalId && typeof window !== "undefined"
      ? `${window.location.origin}/portal/${portalId}`
      : "";

  function create() {
    startTransition(async () => {
      const r = await createPortalLink({ clientId });
      if (r.portalId) setPortalId(r.portalId);
    });
  }

  function revoke() {
    startTransition(async () => {
      await revokePortalLink({ clientId });
      setPortalId(null);
    });
  }

  async function copy() {
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="mb-6 rounded-xl border border-border-soft bg-card p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <LayoutGrid className="size-4 text-text-secondary" />
          <span className="text-sm font-medium text-text-primary">
            Client portal link
          </span>
        </div>
        {!portalId ? (
          <Button size="sm" onClick={create} disabled={pending}>
            {pending ? "Creating…" : "Create portal"}
          </Button>
        ) : (
          <button
            onClick={revoke}
            disabled={pending}
            className="text-[13px] font-medium text-text-secondary transition-colors hover:text-error disabled:opacity-50"
          >
            Revoke
          </button>
        )}
      </div>

      {portalId ? (
        <div className="mt-3 flex items-center gap-2">
          <input
            readOnly
            value={url}
            onFocus={(e) => e.currentTarget.select()}
            className="min-w-0 flex-1 rounded-md border border-border-soft bg-card-soft px-3 py-2 text-[13px] text-text-secondary outline-none"
          />
          <Button variant="secondary" size="sm" onClick={copy} className="shrink-0">
            {copied ? (
              <>
                <Check /> Copied
              </>
            ) : (
              <>
                <Copy /> Copy
              </>
            )}
          </Button>
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex shrink-0 items-center justify-center rounded-md border border-border-soft p-2 text-text-secondary transition-colors hover:bg-card-soft hover:text-text-primary"
            aria-label="Open portal in new tab"
          >
            <ExternalLink className="size-4" />
          </a>
        </div>
      ) : (
        <p className="mt-1.5 text-[13px] text-text-muted">
          One read-only link to every deliverable and its QA certificate for this
          client — no login required. Each deliverable shows a live quality score.
          Revoke anytime.
        </p>
      )}
    </div>
  );
}
