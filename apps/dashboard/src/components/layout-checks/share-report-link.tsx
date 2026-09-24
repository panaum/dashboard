"use client";

import { useState } from "react";
import { Check, Link2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { mintReportLink } from "@/app/dashboard/layout-checks/share-actions";
import { useCan } from "@/components/shared/capabilities";
import type { ComponentProps } from "react";

// The deliverable used to be a screenshot of this page. Now it is a link: the
// button mints one for this run and puts it on the clipboard, and says how
// long the link lives. Minting is a server action; nothing secret is here.
function ShareReportLinkInner({ runId }: { runId: string }) {
  const [state, setState] = useState<{ kind: "idle" } | { kind: "done"; expiry: string } | { kind: "failed"; why: string }>({ kind: "idle" });
  const share = async () => {
    const r = await mintReportLink(runId);
    if ("error" in r) { setState({ kind: "failed", why: r.error }); return; }
    try {
      await navigator.clipboard.writeText(r.url);
      setState({ kind: "done", expiry: r.expiry });
    } catch {
      setState({ kind: "failed", why: `Could not copy. The link: ${r.url}` });
    }
    window.setTimeout(() => setState({ kind: "idle" }), 6000);
  };
  return (
    <span className="inline-flex flex-wrap items-center gap-2 print:hidden">
      <button
        type="button"
        onClick={share}
        title="A link the client can open without a login. One run, valid for a fortnight."
        className={cn(
          "inline-flex h-8 items-center gap-2 rounded-full border border-border-soft px-4 text-[11px] font-medium text-text-secondary transition-colors hover:bg-card-soft hover:text-text-primary focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-text-primary",
          state.kind === "done" && "border-success/40 text-success-strong",
          state.kind === "failed" && "border-error/40 text-error-strong",
        )}
      >
        {state.kind === "done" ? <Check className="size-3.5" aria-hidden /> : <Link2 className="size-3.5" aria-hidden />}
        {state.kind === "done" ? "Link copied" : state.kind === "failed" ? "No link" : "Copy share link"}
      </button>
      {state.kind === "done" && <span className="text-[11px] text-text-secondary">{state.expiry}</span>}
      {state.kind === "failed" && <span className="max-w-[40ch] text-[11px] text-error-strong">{state.why}</span>}
    </span>
  );
}

/** Only for someone who may use it (sharelink:mint); otherwise it does not render.
 *  A wrapper rather than an early return, so the inner hooks keep their order. */
export function ShareReportLink(props: ComponentProps<typeof ShareReportLinkInner>) {
  return useCan("sharelink:mint") ? <ShareReportLinkInner {...props} /> : null;
}
