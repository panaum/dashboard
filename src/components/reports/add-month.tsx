"use client";

import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";

/** A "+ Add month" pill that opens the native month picker and navigates there. */
export function AddMonth() {
  const router = useRouter();
  return (
    <div className="relative">
      <span
        className={cn(buttonVariants({ variant: "secondary", size: "sm" }), "pointer-events-none")}
      >
        <Plus /> Add month
      </span>
      <input
        type="month"
        aria-label="Add or open a month"
        onChange={(e) => {
          if (e.target.value) {
            router.push(`/dashboard/reports?month=${e.target.value}`);
          }
        }}
        className="absolute inset-0 cursor-pointer opacity-0"
      />
    </div>
  );
}
