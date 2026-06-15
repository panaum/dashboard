"use client";

import { useActionState } from "react";
import { login } from "./actions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export default function LoginPage() {
  const [state, formAction, pending] = useActionState(login, {});

  return (
    <div className="flex min-h-screen items-center justify-center bg-[linear-gradient(160deg,#FAF9FF_0%,#EDE8F8_50%,#E0DBF5_100%)] p-4">
      <Card className="w-full max-w-sm p-8 shadow-lg">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <div className="flex size-11 items-center justify-center rounded-full bg-brand-primary text-base font-bold text-text-on-dark">
            D
          </div>
          <h1 className="text-xl font-semibold text-text-primary">
            Deliverables Dashboard
          </h1>
          <p className="text-sm text-text-secondary">
            Sign in to access the team workspace.
          </p>
        </div>

        <form action={formAction} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="password"
              className="text-[13px] font-medium text-text-secondary"
            >
              Team password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              autoFocus
              required
              className="rounded-md border border-border-soft bg-card px-3 py-2.5 text-sm text-text-primary outline-none focus:border-brand-purple"
            />
          </div>

          {state?.error && (
            <p className="text-[13px] text-error">{state.error}</p>
          )}

          <Button type="submit" disabled={pending} className="w-full">
            {pending ? "Signing in…" : "Sign in"}
          </Button>
        </form>
      </Card>
    </div>
  );
}
