import { requireAuth } from "@/lib/auth";
import { Sidebar } from "@/components/shared/sidebar";
import { CommandPaletteLoader } from "@/components/shared/command-palette-loader";
import { PageTransition } from "@/components/shared/page-transition";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireAuth();

  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <main className="flex-1 px-8 py-7">
        <div className="mx-auto max-w-6xl">
          <PageTransition>{children}</PageTransition>
        </div>
      </main>
      <CommandPaletteLoader />
    </div>
  );
}
