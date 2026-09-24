import Link from "next/link";
import { Trash2, Pencil } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { ConfirmDelete } from "@/components/forms/confirm-delete";
import { deleteMember } from "@/app/dashboard/team/actions";
import { RankSelect } from "@/components/team/rank-select";
import { ViewAsButton } from "@/components/team/view-as";
import { RankRequestBadge } from "@/components/team/rank-request-badge";
import { RestoreButton } from "@/components/team/restore-button";
import { LoginButton } from "@/components/team/login-button";
import type { MemberRow } from "@/components/team/team-table";
import { memberLabel } from "@/lib/designations";

// The people who run the place, named rather than measured.
//
// They do not build pages and they do not QA pages, so every column in the
// table below is a zero for them, and the per-person page behind it is a
// scorecard for work they were never going to do. Naming them here is the
// whole feature: present on the team, absent from the numbers, and — unlike
// every other row — not a link, because there is nothing to open.
//
// The admin controls stay. Access, a login, a photo and a title are all still
// things somebody has to be able to change about the CEO.
export function Managers({ members }: { members: MemberRow[] }) {
  if (members.length === 0) return null;
  return (
    <div className="overflow-hidden rounded-xl border border-border-soft bg-card">
      {members.map((m) => (
        <div
          key={m.id}
          className="flex items-center gap-3 border-b border-border-soft px-4 py-3 last:border-b-0"
        >
          <Avatar
            name={m.name}
            src={m.avatarUpdatedAt ? `/api/team-avatar?id=${m.id}&v=${encodeURIComponent(m.avatarUpdatedAt)}` : null}
          />
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="truncate text-sm font-medium text-text-primary">{m.name}</span>
            <div className="flex items-center gap-1.5">
              <span className="truncate text-[12px] text-text-secondary">
                {memberLabel(m)}
              </span>
              {!m.active ? <span className="text-[11px] font-medium text-warning-strong">Left</span>
                : !m.hasLogin && <span className="text-[11px] text-text-muted">no login</span>}
            </div>
          </div>
          {m.pendingRequest && <RankRequestBadge name={m.name} request={m.pendingRequest} />}
          {!m.active && <RestoreButton id={m.id} name={m.name} />}
          <div className="ml-auto flex items-center gap-2">
            <RankSelect
              memberId={m.id}
              rank={m.rank}
              name={m.name}
              disabled={m.isSelf}
              disabledReason="You cannot change your own access level."
            />
            <div className="flex items-center gap-0.5">
              {/* Admins see what you see; yourself, likewise. */}
              {m.rank !== "ADMIN" && !m.isSelf && m.active && <ViewAsButton memberId={m.id} name={m.name} />}
              <LoginButton
                member={{ id: m.id, name: m.name, email: m.email, hasLogin: m.hasLogin }}
              />
              {/* A page, not a dialog: Personalization has room to breathe. */}
              <Link href={`/dashboard/team/${m.id}/personalize`} aria-label={`Edit ${m.name}`} title="Personalization"
                    className="rounded-md p-1.5 text-text-secondary transition-colors hover:bg-card-soft hover:text-text-primary">
                <Pencil className="size-4" />
              </Link>
              <ConfirmDelete
                action={deleteMember}
                fields={{ id: m.id }}
                title="Remove team member"
                description={`Remove ${m.name}? They'll be unassigned from any pages.`}
                trigger={
                  <button
                    className="rounded-md p-1.5 text-text-secondary transition-colors hover:bg-error/10 hover:text-error"
                    aria-label="Delete member"
                  >
                    <Trash2 className="size-4" />
                  </button>
                }
              />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
