"use client";

import { useRouter } from "next/navigation";
import { MemberForm } from "@/components/forms/member-form";

type Member = {
  id: string; name: string; nickname: string | null; role: string;
  title: string | null; slackUserId: string | null; avatarUpdatedAt: string | null;
};

/** The member form on its own page: saving or cancelling goes back to Team. */
export function MemberPersonalization({ member }: { member: Member }) {
  const router = useRouter();
  const back = () => { router.push("/dashboard/team"); router.refresh(); };
  return <MemberForm close={back} initial={member} />;
}
