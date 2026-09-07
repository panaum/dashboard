import type { ReactNode } from "react";
import { CheckCircle2, AlertTriangle, XCircle, MinusCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { TabVerdict } from "@/lib/layout-checks/verdict";

// The one layout both tabs share: a verdict you can read in two seconds, then
// a picker over a screenshot on the left and the findings for that ONE
// screenshot on the right. Learn it once, it works everywhere. On a narrow
// screen the rail drops below the screenshot instead of being squeezed.

const ICON = { success: CheckCircle2, warning: AlertTriangle, error: XCircle, neutral: MinusCircle } as const;
const TONE = {
  success: "text-success", warning: "text-warning", error: "text-error", neutral: "text-text-muted",
} as const;

export function VerdictLine({ verdict }: { verdict: TabVerdict }) {
  const Icon = ICON[verdict.tone];
  return (
    <div className="flex flex-col gap-0.5">
      <p className={cn("flex items-center gap-2 text-[17px] font-semibold tracking-tight", TONE[verdict.tone])}>
        <Icon className="size-5 shrink-0" strokeWidth={2} aria-hidden />
        <span className="text-text-primary">{verdict.headline}</span>
      </p>
      {verdict.compare && <p className="pl-7 text-[12.5px] text-text-muted">{verdict.compare}</p>}
    </div>
  );
}

export function CheckShell({
  verdict,
  picker,
  frame,
  action,
  rail,
  railLabel,
}: {
  verdict: TabVerdict;
  picker: ReactNode;
  frame: ReactNode;
  action?: ReactNode;
  rail: ReactNode;
  railLabel?: string;
}) {
  return (
    <div className="flex flex-col gap-5">
      <VerdictLine verdict={verdict} />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,7fr)_minmax(0,3fr)]">
        <section className="flex min-w-0 flex-col gap-4" aria-label="Screenshot">
          <div>{picker}</div>
          <div className="flex min-w-0 justify-center">{frame}</div>
          {action && <div className="flex justify-center">{action}</div>}
        </section>
        <aside className="min-w-0 rounded-xl border border-border-soft bg-card p-4 shadow-xs" aria-label={railLabel ?? "Findings"}>
          {rail}
        </aside>
      </div>
    </div>
  );
}
