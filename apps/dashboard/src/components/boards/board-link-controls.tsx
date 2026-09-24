"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { useCan } from "@/components/shared/capabilities";

// The developer's way in. Same mechanism as the certificate link: mint once,
// copy, revoke to kill it instantly. The URL is shown in full so QA can see
// exactly what they are handing over.

export function BoardLinkControls({
  boardShareId, origin, createdBy, createdAt, onMint, onRevoke,
}: {
  boardShareId: string | null;
  origin: string;
  /** Who minted the live link and when — null minter means the shared session. */
  createdBy?: string | null;
  createdAt?: string | null;
  onMint: () => Promise<{ ok?: boolean; error?: string; boardShareId?: string }>;
  onRevoke: () => Promise<{ ok?: boolean; error?: string }>;
}) {
  const [copied, setCopied] = useState(false);
  const [pending, start] = useTransition();
  // Minting and revoking are admin-only (sharelink:mint); anyone working the
  // board can still copy a link that exists.
  const canMint = useCan("sharelink:mint");
  const url = boardShareId ? `${origin}/b/${boardShareId}` : null;
  return (
    <div className="flex flex-wrap items-center gap-2 text-[13px]">
      {url ? (
        <>
          <code className="max-w-full truncate rounded-lg bg-card-soft px-3 py-1.5 font-mono text-[12px] text-text-primary">{url}</code>
          <Button type="button" variant="ghost" disabled={pending}
                  onClick={async () => { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>
            {copied ? "Copied" : "Copy developer link"}
          </Button>
          {canMint && (
            <Button type="button" variant="ghost" disabled={pending}
                    onClick={() => { if (confirm("Revoke the developer link? It stops working immediately.")) start(async () => { await onRevoke(); }); }}>
              Revoke
            </Button>
          )}
          {createdAt && (
            <span className="basis-full text-[11px] text-text-secondary">
              Created {createdBy ? `by ${createdBy}, ` : "by the shared login, "}{createdAt}
            </span>
          )}
        </>
      ) : (
        <>
          <span className="text-text-secondary">No developer link yet.</span>
          {canMint && (
            <Button type="button" variant="ghost" disabled={pending} onClick={() => start(async () => { await onMint(); })}>
              Create developer link
            </Button>
          )}
        </>
      )}
    </div>
  );
}
