"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "motion/react";
import { LayoutDashboard, Users, BarChart3, UsersRound, Search, ListChecks, Lightbulb, Sparkles, LogOut } from "lucide-react";
import { cn } from "@/lib/utils";
import { Logo } from "@/components/shared/logo";
import { logout } from "@/app/dashboard/actions";

const NAV = [
  { href: "/dashboard", label: "Overview", icon: LayoutDashboard, exact: true },
  { href: "/dashboard/reports", label: "Monthly", icon: BarChart3 },
  { href: "/dashboard/search", label: "Search", icon: Search },
  { href: "/dashboard/clients", label: "Clients", icon: Users },
  { href: "/dashboard/team", label: "Team", icon: UsersRound },
  { href: "/dashboard/checklists", label: "Checklists", icon: ListChecks },
  { href: "/dashboard/checklists/candidates", label: "Candidates", icon: Lightbulb },
  { href: "/dashboard/insights", label: "Insights", icon: Sparkles },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-border-soft bg-[#fbfbfd] px-3 py-5 print:hidden">
      <div className="mb-7 flex items-center gap-2.5 px-2">
        <div className="flex size-9 items-center justify-center rounded-xl border border-border-soft bg-card shadow-sm">
          <Logo className="size-6" />
        </div>
        <div className="flex flex-col leading-tight">
          <span className="text-sm font-semibold text-text-primary">
            Deliverables
          </span>
          <span className="text-[11px] text-text-muted">Apexure workspace</span>
        </div>
      </div>

      <button
        type="button"
        onClick={() => window.dispatchEvent(new Event("command-palette:open"))}
        className="mb-5 flex items-center gap-2 rounded-lg border border-border-soft bg-card px-3 py-2 text-sm text-text-muted shadow-xs transition-colors hover:border-accent/40 hover:text-text-primary"
      >
        <Search className="size-4 shrink-0" strokeWidth={1.5} />
        <span className="flex-1 text-left">Search…</span>
        <kbd className="rounded border border-border-soft px-1.5 py-0.5 text-[10px] font-medium">
          ⌘K
        </kbd>
      </button>

      <span className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-[0.1em] text-text-muted">
        Menu
      </span>
      <nav className="flex flex-1 flex-col gap-0.5">
        {NAV.map((item) => {
          const active = item.exact
            ? pathname === item.href
            : pathname.startsWith(item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                active
                  ? "text-accent"
                  : "text-text-secondary hover:bg-card-soft hover:text-text-primary",
              )}
            >
              {active && (
                <motion.span
                  layoutId="nav-active-pill"
                  className="absolute inset-0 rounded-lg bg-accent/10 ring-1 ring-inset ring-accent/15"
                  transition={{ type: "spring", stiffness: 420, damping: 34 }}
                />
              )}
              <Icon
                className="relative z-10 size-[18px]"
                strokeWidth={active ? 2 : 1.5}
              />
              <span className="relative z-10">{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <form action={logout} className="mt-2 border-t border-border-soft pt-3">
        <button
          type="submit"
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-text-secondary transition-colors hover:bg-error/10 hover:text-error"
        >
          <LogOut className="size-[18px]" strokeWidth={1.5} />
          Sign out
        </button>
      </form>

      <p
        className="mt-3 px-3 text-[10px] tracking-wide text-text-muted/40 transition-colors hover:text-text-muted print:hidden"
        title="Crafted by Anaum"
      >
        anaum
      </p>
    </aside>
  );
}
