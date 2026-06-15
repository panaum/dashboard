import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 font-medium whitespace-nowrap transition-all duration-200 ease-out hover:-translate-y-px active:translate-y-0 active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50 disabled:hover:translate-y-0 [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary:
          "bg-gradient-to-b from-[#2a2a48] to-brand-primary text-text-on-dark rounded-full shadow-sm hover:shadow-brand active:from-brand-primary",
        secondary:
          "border border-border-soft bg-card text-text-primary rounded-full shadow-xs hover:border-brand-purple/50 hover:bg-brand-purple/[0.06] active:bg-brand-purple/15",
        ghost:
          "text-text-secondary rounded-full hover:bg-brand-purple/10 hover:text-text-primary active:bg-brand-purple/20",
        destructive: "bg-error text-white rounded-full shadow-xs hover:opacity-90 active:brightness-95",
      },
      size: {
        sm: "px-4 py-2 text-[13px]",
        md: "px-5 py-2.5 text-sm",
        lg: "px-7 py-3.5 text-base",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => (
    <button
      ref={ref}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  ),
);
Button.displayName = "Button";

export { buttonVariants };
