import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { UserMenu } from "@/components/UserMenu";
import { DoorCard } from "@/components/DoorCard";
import { Clipboard, Radar, Kanban } from "@/components/icons";

export default async function Home() {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/auth/signin"); // middleware also guards this

  const user = session.user;

  return (
    <main className="door-grain min-h-screen">
      {/* Shell chrome — the parent frame over both apps */}
      <header className="mx-auto flex max-w-5xl items-center justify-between px-6 py-6">
        <div className="flex items-center gap-2.5">
          <div className="flex size-9 items-center justify-center rounded-xl border border-line bg-ink-850">
            <span className="font-display text-lg font-bold tracking-tight text-text-primary">A</span>
          </div>
          <span className="font-display text-lg font-bold tracking-tight text-text-primary">
            Apexure <span className="text-signal">Platform</span>
          </span>
        </div>
        <UserMenu name={user.name ?? ""} email={user.email ?? ""} image={user.image ?? null} />
      </header>

      <section className="mx-auto max-w-5xl px-6 pb-24 pt-8 sm:pt-16">
        <div className="mb-10 max-w-2xl">
          <h1 className="font-display text-3xl font-bold tracking-tight text-text-primary sm:text-4xl">
            Where do you want to go?
          </h1>
          <p className="mt-2 text-[15px] text-text-secondary">
            Three specialist tools, one identity. Pick a door — you&apos;re already signed in.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
          <DoorCard
            icon={<Clipboard />}
            name="Deliverables"
            description="QA checklists, delivery tracking, team ops."
            cta="Open Dashboard"
            accent="teal"
            href="/go/dashboard"
          />
          <DoorCard
            icon={<Radar />}
            name="LinkSpy"
            description="Broken links, monitoring, production verification."
            cta="Open LinkSpy"
            accent="violet"
            href="/go/linkspy"
          />
          <DoorCard
            icon={<Kanban />}
            name="Board"
            description="Issue tracking, developer workflow, ready signals."
            cta="Coming soon"
            accent="slate"
            disabled
            badge="Soon"
          />
        </div>

        <p className="mt-10 text-xs text-text-muted">
          Links are signed and short-lived — each door hands you off securely, no second sign-in.
        </p>
      </section>
    </main>
  );
}
