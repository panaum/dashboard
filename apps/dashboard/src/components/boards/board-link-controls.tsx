"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";

// The developer's way in. Same mechanism as the certificate link: mint once,
// copy, revoke to kill it instantly. The URL is shown in full so QA can see
// exactly what they are handing over.

export function BoardLinkControls({
  boardShareId, origin, onMint, onRevoke,
}: {
  boardShareId: string | null;
  origin: string;
  onMint: () => Promise<{ ok?: boolean; error?: string; boardShareId?: string }>;
  onRevoke: () => Promise<{ ok?: boolean; error?: string }>;
}) {
  const [copied, setCopied] = useState(false);
  const [pending, start] = useTransition();
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
          <Button type="button" variant="ghost" disabled={pending}
                  onClick={() => { if (confirm("Revoke the developer link? It stops working immediately.")) start(async () => { await onRevoke(); }); }}>
            Revoke
          </Button>
        </>
      ) : (
        <>
          <span className="text-text-secondary">No developer link yet.</span>
          <Button type="button" variant="ghost" disabled={pending} onClick={() => start(async () => { await onMint(); })}>
            Create developer link
          </Button>
        </>
      )}
    </div>
  );
}
