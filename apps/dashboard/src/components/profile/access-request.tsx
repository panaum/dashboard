"use client";

import { useActionState, useEffect } from "react";
import { Clock, CircleCheck, CircleX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Textarea } from "@/components/ui/field";
import { requestMemberAccess } from "@/app/dashboard/personalization/actions";
import type { AccessState } from "@/lib/onboarding";

/** Dates cross the server/client line as ISO strings. */
export type AccessView = AccessState;

const day = (iso: Date | string | null, timeZone?: string) =>
  iso ? new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone }).format(new Date(iso)) : "";

/**
 * The "ask for Member access" block. Rendered on /dashboard/personalization for good
 * and as step 4 of onboarding; what it shows comes from accessState(), the
 * same function requestMemberAccess checks, so the button never offers what
 * the server would refuse.
 */
export function AccessRequest({
  state,
  timeZone,
  onDone,
  secondary,
}: {
  state: AccessView;
  timeZone?: string;
  /** Called after a request is filed (onboarding moves on). */
  onDone?: () => void;
  secondary?: React.ReactNode;
}) {
  const [result, action, pending] = useActionState(requestMemberAccess, {});
  useEffect(() => { if (result.ok) onDone?.(); }, [result, onDone]);

  return (
    <div className="flex flex-col gap-4">
      {state.kind === "pending" && (
        <p className="flex items-start gap-2.5 rounded-lg bg-accent/[0.06] px-3.5 py-3 text-sm text-text-primary">
          <Clock className="mt-0.5 size-4 shrink-0 text-accent" />
          <span>Your request is awaiting approval — asked on <time suppressHydrationWarning>{day(state.request.createdAt, timeZone)}</time>.</span>
        </p>
      )}
      {state.kind === "denied" && (
        <div className="flex items-start gap-2.5 rounded-lg bg-card-soft px-3.5 py-3 text-sm text-text-primary">
          <CircleX className="mt-0.5 size-4 shrink-0 text-text-secondary" />
          <div className="flex flex-col gap-1">
            <span>Your request from <time suppressHydrationWarning>{day(state.request.createdAt, timeZone)}</time> was declined.</span>
            {state.request.reviewNote && (
              <span className="text-text-secondary">“{state.request.reviewNote}”</span>
            )}
            <span className="text-text-secondary">You can ask again below.</span>
          </div>
        </div>
      )}
      {state.kind === "approved" && (
        <p className="flex items-start gap-2.5 rounded-lg bg-success/[0.08] px-3.5 py-3 text-sm text-text-primary">
          <CircleCheck className="mt-0.5 size-4 shrink-0 text-success-strong" />
          <span>Your Member access was approved on <time suppressHydrationWarning>{day(state.request.reviewedAt ?? state.request.createdAt, timeZone)}</time>.</span>
        </p>
      )}

      {state.canRequest && (
        <form action={action} className="flex flex-col gap-3">
          <Field label="Why you need it" htmlFor="reason" hint="Optional — a line for the admin who reviews it.">
            <Textarea id="reason" name="reason" rows={2} maxLength={500} placeholder="e.g. I'll be filling in QA checklists for the Savvio pages." />
          </Field>
          <div className="flex flex-wrap items-center justify-end gap-3">
            {result.error && <span className="mr-auto text-xs text-error-strong" role="status">{result.error}</span>}
            {secondary}
            <Button type="submit" disabled={pending}>{pending ? "Sending…" : "Request Member access"}</Button>
          </div>
        </form>
      )}
      {!state.canRequest && secondary && <div className="flex justify-end">{secondary}</div>}
    </div>
  );
}
