import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { RANK_BLURB, RANK_LABELS, can } from "@/lib/permissions";
import { accessState } from "@/lib/onboarding";
import { PageHeader } from "@/components/shared/page-header";
import { Card } from "@/components/ui/card";
import { ProfileForm } from "@/components/profile/profile-form";
import { AccessRequest } from "@/components/profile/access-request";
import { RetakeTourButton } from "@/components/profile/retake-tour";
import { ShowOnboarding } from "@/components/profile/show-onboarding";
import { LeaveWorkspace } from "@/components/profile/leave-workspace";
import { NotificationSettings, TimeZoneSetting } from "@/components/profile/preferences";

export const metadata = { title: "Personalization" };

// Personal settings. Open to every rank — they are never rank-gated — and
// deliberately outside /dashboard/settings, which stays workspace admin.
export default async function PersonalizationPage() {
  const actor = await requireAuth();

  if (actor.bootstrap) {
    return (
      <>
        <PageHeader title="Personalization" subtitle="Your name, photo and access." />
        <Card className="p-6 text-sm text-text-secondary">
          You are signed in with the shared team password, which has no person behind it. Sign in with your own email to set up a profile.
        </Card>
        <Card className="mt-6 flex flex-wrap items-center justify-between gap-3 p-6">
          <p className="text-sm text-text-secondary">Walk someone through the first-run experience. Nothing is saved.</p>
          <ShowOnboarding />
        </Card>
      </>
    );
  }

  const me = await db.teamMember.findUnique({
    where: { id: actor.id },
    select: {
      id: true, name: true, nickname: true, avatarUpdatedAt: true, slackUserId: true,
      notifyMentions: true, notifyReplies: true, notifyDueReminders: true, timeZone: true,
      rankRequests: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  });
  if (!me) return null; // getActor already refused a missing row
  const access = accessState(actor.rank, me.rankRequests[0] ?? null);
  // Members and admins only see this section if they have a request on
  // record — an approval is worth showing; an empty offer is not.
  const showAccess = actor.rank === "VIEWER" || access.kind !== "none";

  return (
    <>
      <PageHeader title="Personalization" subtitle="Your name, photo and access." />

      <div className="grid gap-6">
        <section>
          <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.07em] text-text-muted">You</h2>
          <Card className="p-6">
            <ProfileForm member={{ id: me.id, name: me.name, nickname: me.nickname, slackUserId: me.slackUserId, avatarUpdatedAt: me.avatarUpdatedAt?.toISOString() ?? null }} />
          </Card>
        </section>

        <section>
          <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.07em] text-text-muted">Slack notifications</h2>
          <Card className="p-6">
            <NotificationSettings initial={{ notifyMentions: me.notifyMentions, notifyReplies: me.notifyReplies, notifyDueReminders: me.notifyDueReminders }} />
          </Card>
        </section>

        <section>
          <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.07em] text-text-muted">Time zone</h2>
          <Card className="p-6">
            <TimeZoneSetting initial={me.timeZone} />
          </Card>
        </section>

        <section>
          <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.07em] text-text-muted">Access</h2>
          <Card className="flex flex-col gap-4 p-6">
            <div>
              <p className="text-sm font-medium text-text-primary">You are {RANK_LABELS[actor.rank] === "Admin" ? "an" : "a"} {RANK_LABELS[actor.rank]}</p>
              <p className="mt-1 text-sm text-text-secondary">{RANK_BLURB[actor.rank]}</p>
            </div>
            {showAccess && <AccessRequest state={access} />}
          </Card>
        </section>

        <section>
          <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.07em] text-text-muted">Getting around</h2>
          <Card className="flex flex-wrap items-center justify-between gap-4 p-6">
            <p className="text-sm text-text-secondary">A short walk through the parts of the app you can use.</p>
            <RetakeTourButton />
            {/* For admins showing others what a new person sees. */}
            {can(actor, "rank:assign") && (
              <div className="flex basis-full flex-wrap items-center justify-between gap-3 border-t border-border-soft pt-4">
                <p className="text-sm text-text-secondary">Walk someone through the first-run experience. Nothing is saved.</p>
                <ShowOnboarding />
              </div>
            )}
          </Card>
        </section>

        {/* Viewers and Members may leave on their own; an admin hands over
            first. Not offered in a preview: that is someone else's account. */}
        {actor.rank !== "ADMIN" && !actor.preview && (
          <section>
            <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.07em] text-text-muted">Leaving</h2>
            <Card className="flex flex-wrap items-center justify-between gap-4 p-6">
              <p className="max-w-md text-sm text-text-secondary">
                Signs you out for good. Your work stays, with your name on it, and an admin can restore your access.
              </p>
              <LeaveWorkspace />
            </Card>
          </section>
        )}
      </div>
    </>
  );
}
