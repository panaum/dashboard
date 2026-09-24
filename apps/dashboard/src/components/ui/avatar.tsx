import { cn } from "@/lib/utils";

// Soft tinted pairs (bg + text) — picked deterministically from the name so a
// person/client always gets the same colour across the app.
const PALETTE = [
  "bg-[#ece9fb] text-[#5b4fc7]", // violet
  "bg-[#e3edfd] text-[#3b6fd4]", // blue
  "bg-[#fde7ef] text-[#c44d77]", // pink
  "bg-[#fdeede] text-[#bd763a]", // peach
  "bg-[#e1f4ec] text-[#2f9669]", // green
  "bg-[#fbe9e6] text-[#cc5b48]", // coral
  "bg-[#e7f1f6] text-[#3d7c97]", // teal
];

function hash(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

const SIZES = {
  sm: "size-7 text-[11px]",
  md: "size-9 text-[13px]",
  lg: "size-12 text-base",
  xl: "size-24 text-2xl",
} as const;

export function Avatar({
  name,
  src,
  size = "md",
  className,
}: {
  name: string;
  /** Profile photo. Absent → initials. Present but broken (the photo was
   *  removed between render and load) → the initials underneath show through,
   *  because the image sits on top with an empty alt and a failed one with an
   *  empty alt renders nothing. No event handler, so this stays usable from a
   *  Server Component. */
  src?: string | null;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full font-semibold",
        SIZES[size],
        PALETTE[hash(name) % PALETTE.length],
        className,
      )}
      title={src ? name : undefined}
    >
      <span aria-hidden>{initials(name)}</span>
      {src && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" className="absolute inset-0 size-full object-cover" />
      )}
    </span>
  );
}
