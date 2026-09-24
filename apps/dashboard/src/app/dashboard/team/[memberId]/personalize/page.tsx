import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireCapability } from "@/lib/auth";
import { Breadcrumbs } from "@/components/shared/breadcrumbs";
import { PageHeader } from "@/components/shared/page-header";
import { Card } from "@/components/ui/card";
import { MemberPersonalization } from "@/components/team/member-personalization";
import { doesPageWork } from "@/lib/roles";

export const metadata = { title: "Personalization" };

// An admin editing someone else: the member dialog, given a page of its own.
// Same form (MemberForm → ProfileFields), same action (saveMember), same
// check (team:manage) — only the frame changed.
export default async function PersonalizeMemberPage({ params }: { params: Promise<{ memberId: string }> }) {
  await requireCapability("team:manage");
  const { memberId } = await params;
  const m = await db.teamMember.findUnique({
    where: { id: memberId },
    select: { id: true, name: true, nickname: true, role: true, title: true, slackUserId: true, avatarUpdatedAt: true },
  });
  if (!m) notFound();

  return (
    <>
      {/* The member page is a work record (pages built, QA'd); it 404s for
          anyone who does no page work — management, marketing — so their
          name is not a link. */}
      <Breadcrumbs items={[{ label: "Team", href: "/dashboard/team" }, { label: m.name, href: doesPageWork(m.role) ? `/dashboard/team/${m.id}` : undefined }, { label: "Personalization" }]} />
      <PageHeader title="Personalization" subtitle={`${m.name}’s name, photo, role and Slack.`} />
      <Card className="p-6">
        <MemberPersonalization member={{ ...m, avatarUpdatedAt: m.avatarUpdatedAt?.toISOString() ?? null }} />
      </Card>
    </>
  );
}
