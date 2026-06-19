import { cn } from "@/lib/utils";

/** Pulsing placeholder block used in loading states. */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div className={cn("animate-pulse rounded-md bg-card-soft", className)} />
  );
}
