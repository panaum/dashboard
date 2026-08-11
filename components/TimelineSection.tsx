import type { TimelineEvent } from "@/lib/living-certificate";
import { orderNewestFirst, formatEventDate, TIMELINE_EMPTY_COPY } from "@/lib/timeline-copy";

// LIVING CERTIFICATE — Section 2, the history timeline.
//
//   HISTORY
//   ┃ ● Quality assurance signed off
//   ┃   38 checks passed
//   ┃   28 July 2026
//   ┃
//   ┃ ● Handed to quality assurance
//   ┃   20 July 2026
//
// Narrative-first, not a log. Each card leads with a sentence a client would say
// out loud; the date is subordinate, muted, underneath. A raw `type` string or a
// timestamp-first row would read as machine output, and this is the one section
// whose whole job is to read like a story.
//
// The caller renders this only when `timeline` is non-null: a failed look at
// LinkSpy hides the section entirely rather than claiming an empty history.

const ACCENT: Record<TimelineEvent["kind"], string> = {
  // Sign-off is the moment the client is being told about — it earns the accent.
  signed_off: "bg-lc-success",
  handed_to_qa: "bg-lc-accent",
};

export function TimelineSection({ events }: { events: TimelineEvent[] }) {
  const ordered = orderNewestFirst(events);

  return (
    <section className="rounded-2xl border border-lc-line bg-lc-card p-6 shadow-lc sm:p-8">
      <h2 className="text-[11px] font-semibold uppercase tracking-[0.07em] text-lc-muted">
        History
      </h2>

      {ordered.length === 0 ? (
        <p className="mt-3 text-sm text-lc-secondary">{TIMELINE_EMPTY_COPY}</p>
      ) : (
        <ol className="mt-4 flex flex-col">
          {ordered.map((event, i) => {
            const date = formatEventDate(event.at);
            const last = i === ordered.length - 1;
            return (
              <li key={`${event.at}-${event.kind}-${i}`} className="flex gap-3 sm:gap-4">
                {/* The rail: a dot per event, joined by a hairline that stops at
                    the last one so the timeline reads as ended, not truncated. */}
                <div className="flex flex-col items-center" aria-hidden>
                  <span className={`mt-1.5 size-2 shrink-0 rounded-full ${ACCENT[event.kind]}`} />
                  {!last && <span className="mt-1 w-px flex-1 bg-lc-line" />}
                </div>

                <div className={last ? "pb-0" : "pb-6"}>
                  <p className="text-sm font-medium leading-snug text-lc-text">{event.title}</p>
                  {event.detail && (
                    <p className="mt-0.5 text-[13px] text-lc-secondary">{event.detail}</p>
                  )}
                  {date && (
                    <p className="tabular mt-1 text-[12px] text-lc-muted">{date}</p>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
