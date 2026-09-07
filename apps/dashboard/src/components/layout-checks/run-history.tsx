import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";

// Run-level history for both kinds of check, below the tab shell — it is
// about runs, not about one screenshot, so it does not belong beside one.

export type HistoryRow = {
  id: string;
  kind: "Viewports" | "Devices";
  checkedAt: string;
  worst: string;
  summary: string;
};

const TONE: Record<string, "error" | "warning" | "neutral" | "success"> = {
  FAIL: "error", REGRESSED: "error", WARN: "warning", SKIP: "neutral", BLOCKED: "neutral", PASS: "success",
};

export function RunHistory({ rows }: { rows: HistoryRow[] }) {
  if (!rows.length) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>History</CardTitle>
      </CardHeader>
      <div className="flex flex-col divide-y divide-border-soft">
        {rows.map((r) => (
          <div key={`${r.kind}-${r.id}`} className="flex flex-wrap items-center gap-3 px-5 py-2.5">
            <span className="w-44 text-[13px] text-text-secondary">{new Date(r.checkedAt).toLocaleString()}</span>
            <Badge tone="neutral">{r.kind}</Badge>
            <Badge tone={TONE[r.worst] ?? "neutral"}>{r.worst}</Badge>
            <span className="text-[12px] text-text-muted">{r.summary}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}
