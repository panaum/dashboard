// CLIENT PRESENCE LINE — four chips, each coloured by its own state.
//
// Presentational only: aggregation, worst-of and handoff signing all happened
// server-side. This file formats and nothing else.
//
// Unlike the checklist strip, this renders even when everything is green — a
// client page is a status board, and "all green, and here is what green means"
// is the answer to the question the reader actually asked. See the design note.
import type { AggregatedChip, ChipState, ClientPresence } from "@/lib/linkspy/chips-shape";
import { stateEmoji } from "@/lib/linkspy/chips-shape";

// One class per state. Colour reflects THAT chip, never the line's worst.
const TONE: Record<ChipState, string> = {
  critical: "border-error/30 bg-error/10 text-error",
  warn: "border-warning/30 bg-warning/10 text-warning",
  notice: "border-brand-yellow/50 bg-brand-yellow/20 text-text-primary",
  settling: "border-border-soft bg-card-soft text-text-muted",
  unknown: "border-border-soft bg-card-soft text-text-muted",
  ok: "border-success/25 bg-success/10 text-success",
};

function Chip({ chip, href }: { chip: AggregatedChip; href?: string }) {
  const inner = (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs ${TONE[chip.state]}`}
      title={chip.detail ?? undefined}
    >
      <span className="font-medium">{chip.label}</span>
      <span className="opacity-80">{chip.text}</span>
    </span>
  );
  return href ? (
    <a href={href} target="_blank" rel="noreferrer" className="hover:opacity-80">
      {inner}
    </a>
  ) : (
    inner
  );
}

// Decision 1: an unlinked client is never silent. A faint grey strip says so in
// plain words, because "no chips" and "no data" look identical otherwise — and
// silence would read as "everything is fine" on a client nobody is watching.
export function NotLinkedStrip({ action }: { action?: React.ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-center gap-x-2 gap-y-2 rounded-xl border border-border-soft bg-card-soft px-4 py-2.5">
      <span className="size-2 shrink-0 rounded-full bg-text-muted/40" aria-hidden />
      <span className="text-sm text-text-muted">Not linked to LinkSpy</span>
      <span className="text-text-muted">·</span>
      <span className="text-xs text-text-muted">
        no production signals for this client
      </span>
      {action && <span className="ml-auto">{action}</span>}
    </div>
  );
}

export function ClientPresenceLine({
  presence,
  hrefByChip,
}: {
  presence: ClientPresence | null;
  hrefByChip: Record<string, string>;
}) {
  // Flag off, or LinkSpy unreachable with no cache: nothing. (An UNLINKED
  // client is a different case and renders <NotLinkedStrip/> instead.)
  if (!presence) return null;

  return (
    <div className="mb-5 flex flex-wrap items-center gap-x-2 gap-y-2 rounded-xl border border-brand-purple/40 bg-brand-purple/10 px-4 py-2.5">
      <span className="text-sm" aria-hidden>
        {stateEmoji(presence.worst)}
      </span>
      <span className="text-sm font-medium text-text-primary">{presence.clientName}</span>
      <span className="text-text-muted">·</span>
      {presence.chips.map((chip, i) => (
        <span key={chip.key} className="inline-flex items-center gap-2">
          <Chip chip={chip} href={hrefByChip[chip.key]} />
          {i < presence.chips.length - 1 && <span className="text-text-muted">·</span>}
        </span>
      ))}
      {presence.stale && (
        <span className="ml-auto text-xs text-text-muted">production status last known</span>
      )}
    </div>
  );
}
