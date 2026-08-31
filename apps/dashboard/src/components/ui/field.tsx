import * as React from "react";
import { cn } from "@/lib/utils";

const fieldBase =
  "w-full rounded-md border border-border-soft bg-card px-3 py-2.5 text-sm text-text-primary outline-none transition-colors placeholder:text-text-muted focus:border-accent disabled:opacity-50";

export function Field({
  label,
  htmlFor,
  children,
  hint,
}: {
  label: string;
  htmlFor?: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label
        htmlFor={htmlFor}
        className="text-[13px] font-medium text-text-secondary"
      >
        {label}
      </label>
      {children}
      {hint && <span className="text-xs text-text-muted">{hint}</span>}
    </div>
  );
}

export const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, ...props }, ref) => (
  <input ref={ref} className={cn(fieldBase, className)} {...props} />
));
Input.displayName = "Input";

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea ref={ref} className={cn(fieldBase, "min-h-20", className)} {...props} />
));
Textarea.displayName = "Textarea";

export const Select = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(({ className, children, ...props }, ref) => (
  <select ref={ref} className={cn(fieldBase, "cursor-pointer", className)} {...props}>
    {children}
  </select>
));
Select.displayName = "Select";
