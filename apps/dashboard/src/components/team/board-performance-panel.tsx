import Link from "next/link";
import type { BoardPerformance } from "@/lib/board-performance";

// The second panel: how each developer handles the faults QA finds, from the
// board's event log. Beside the delivery view, never blended with it —
// shipping on time and fixing what was found are different questions.

export function BoardPerformancePanel({ data, names, month }: {
  data: BoardPerformance;
  names: Map<string, string>;
  month: string;
}) {
  return (
    <section className="mt-8" aria-labelledby="board-performance-heading">
      <h2 id="board-performance-heading" className="mb-1 text-sm font-semibold text-text-primary">Board performance · {month}</h2>
      <p className="mb-3 text-[13px] text-text-secondary">
        From the board's event log. Bounce-backs are cards QA pulled back out of Completed or Closed — the one number a developer cannot inflate.
      </p>
      <div className="overflow-x-auto rounded-xl border border-border-soft bg-card shadow-xs">
        {data.devs.length === 0 ? (
          <p className="px-5 py-4 text-[13px] text-text-secondary">No board activity this month.</p>
        ) : (
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-left text-[11px] font-semibold uppercase tracking-[0.08em] text-text-secondary">
                {["Developer", "Assigned", "Completed", "Closed", "Cycle (h)", "Bounce-backs", "Recurring"].map((h) => (
                  <th key={h} className="px-4 py-2.5 first:pl-5 last:pr-5">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.devs.map((d) => (
                <tr key={d.id} className="border-t border-border-soft tabular-nums">
                  <td className="px-4 py-2.5 pl-5 font-medium text-text-primary">
                    <Link href={`/dashboard/team/${d.id}`} className="hover:underline">
                      {names.get(d.id) ?? d.id}
                    </Link>
                  </td>
                  <td className="px-4 py-2.5">{d.assigned}</td>
                  <td className="px-4 py-2.5">{d.completed}</td>
                  <td className="px-4 py-2.5">{d.closed}</td>
                  <td className="px-4 py-2.5">{d.cycleHours ?? "—"}</td>
                  <td className={"px-4 py-2.5 " + (d.bounceBacks ? "font-semibold text-warning-strong" : "")}>{d.bounceBacks}</td>
                  <td className="px-4 py-2.5 pr-5">{d.recurring}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
