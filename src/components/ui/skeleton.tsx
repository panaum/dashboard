import { cn } from "@/lib/utils";

/** Shimmering placeholder block used in loading states. */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("skeleton rounded-md", className)} />;
}
