import { Eye } from "lucide-react";
import { exitPreview } from "@/app/dashboard/preview/actions";

/** Pinned over every page while an admin is previewing. It says whose view
 *  this is, that nothing here saves, and how to leave. */
export function PreviewBanner({ label }: { label: string }) {
  return (
    <div
      role="status"
      className="sticky top-0 z-40 flex flex-wrap items-center gap-x-3 gap-y-1 bg-accent px-5 py-2.5 text-sm text-text-on-dark shadow-sm print:hidden"
    >
      <Eye className="size-4 shrink-0" />
      <span className="font-semibold">Viewing as {label}</span>
      <span className="opacity-90">Read-only: nothing you do here is saved.</span>
      <form action={exitPreview} className="ml-auto">
        <button
          type="submit"
          className="rounded-full bg-card px-3.5 py-1 text-[13px] font-semibold text-accent transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-card"
        >
          Exit preview
        </button>
      </form>
    </div>
  );
}
