import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold tracking-wide",
  {
    variants: {
      tone: {
        neutral: "bg-card-soft text-text-secondary",
        success: "bg-success/12 text-success",
        warning: "bg-warning/15 text-warning",
        error: "bg-error/12 text-error",
        info: "bg-info/12 text-info",
        brand: "bg-brand-purple/25 text-brand-primary",
      },
    },
    defaultVariants: { tone: "neutral" },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, tone, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}
