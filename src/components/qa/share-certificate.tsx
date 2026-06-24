"use client";

import { useState, useTransition } from "react";
import { Share2, Copy, Check, Code2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  createShareLink,
  revokeShareLink,
} from "@/app/dashboard/clients/[clientId]/[projectId]/[pageId]/actions";

export function ShareCertificate({
  clientId,
  projectId,
  pageId,
  initialShareId,
}: {
  clientId: string;
  projectId: string;
  pageId: string;
  initialShareId: string | null;
}) {
  const [shareId, setShareId] = useState<string | null>(initialShareId);
  const [pending, startTransition] = useTransition();
  const [copied, setCopied] = useState(false);
  const [embedCopied, setEmbedCopied] = useState(false);
  const [showEmbed, setShowEmbed] = useState(false);

  const path = { clientId, projectId, pageId };
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const url = shareId ? `${origin}/c/${shareId}` : "";
  // Embeddable "QA verified" trust badge for the client's own website.
  const embed = shareId
    ? `<iframe src="${origin}/c/${shareId}/badge" title="QA verified by Apexure" width="260" height="60" style="border:0;overflow:hidden" loading="lazy"></iframe>`
    : "";

  function create() {
    startTransition(async () => {
      const r = await createShareLink({ pageId, path });
      if (r.shareId) setShareId(r.shareId);
    });
  }

  function revoke() {
    startTransition(async () => {
      await revokeShareLink({ pageId, path });
      setShareId(null);
    });
  }

  async function copy() {
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  async function copyEmbed() {
    await navigator.clipboard.writeText(embed);
    setEmbedCopied(true);
    setTimeout(() => setEmbedCopied(false), 1500);
  }

  return (
    <div className="mb-4 rounded-xl border border-border-soft bg-card p-4 print:hidden">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Share2 className="size-4 text-text-secondary" />
          <span className="text-sm font-medium text-text-primary">
            Client share link
          </span>
        </div>
        {!shareId ? (
          <Button size="sm" onClick={create} disabled={pending}>
            {pending ? "Creating…" : "Create link"}
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

      {shareId ? (
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
        </div>
      ) : null}

      {shareId && (
        <div className="mt-3 border-t border-border-soft pt-3">
          <button
            onClick={() => setShowEmbed((v) => !v)}
            className="inline-flex items-center gap-1.5 text-[13px] font-medium text-text-secondary transition-colors hover:text-text-primary"
          >
            <Code2 className="size-3.5" />
            {showEmbed ? "Hide trust badge embed" : "Embed a trust badge on their site"}
          </button>
          {showEmbed && (
            <div className="mt-2.5">
              <p className="mb-2 text-[13px] text-text-muted">
                Paste this where the client wants a live &ldquo;QA verified by
                Apexure&rdquo; badge — it links back to this certificate.
              </p>
              <div className="flex items-start gap-2">
                <code className="min-w-0 flex-1 overflow-x-auto whitespace-pre rounded-md border border-border-soft bg-card-soft px-3 py-2 font-mono text-[12px] text-text-secondary">
                  {embed}
                </code>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={copyEmbed}
                  className="shrink-0"
                >
                  {embedCopied ? (
                    <>
                      <Check /> Copied
                    </>
                  ) : (
                    <>
                      <Copy /> Copy
                    </>
                  )}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {!shareId && (
        <p className="mt-1.5 text-[13px] text-text-muted">
          Generate a public, read-only link to send the client — no login
          required. You can revoke it anytime.
        </p>
      )}
    </div>
  );
}
