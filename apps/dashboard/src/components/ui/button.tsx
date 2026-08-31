import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 font-medium whitespace-nowrap transition-all duration-200 ease-out hover:-translate-y-px active:translate-y-0 active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50 disabled:hover:translate-y-0 [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary:
          "bg-accent text-text-on-dark rounded-full shadow-sm hover:bg-accent-bright hover:shadow-brand active:bg-accent",
        secondary:
          "border border-border-soft bg-card text-text-primary rounded-full shadow-xs hover:border-accent/50 hover:bg-accent/[0.06] active:bg-accent/10",
        ghost:
          "text-text-secondary rounded-full hover:bg-card-soft hover:text-text-primary active:bg-card-soft",
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
