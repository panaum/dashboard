import { ShieldCheck } from "lucide-react";

/**
 * Iridescent "verified" seal for a passed certificate — a slowly rotating
 * holographic ring with a sweeping light glint over a clean disc. Pure CSS
 * (keyframes in globals.css); honours prefers-reduced-motion globally.
 */
export function HolographicSeal({ size = 80 }: { size?: number }) {
  return (
    <div
      className="relative shrink-0 -rotate-6 print:rotate-0"
      style={{ width: size, height: size }}
    >
      {/* iridescent rotating ring */}
      <div
        className="holo-ring absolute inset-0 rounded-full opacity-90 print:animate-none"
        style={{
          background:
            "conic-gradient(from 0deg, #b8b0f0, #9bb5f5, #f5c5a3, #f9e8a0, #4caf7d, #9bb5f5, #b8b0f0)",
        }}
      />
      {/* clean inner disc */}
      <div className="absolute inset-[3px] rounded-full bg-card shadow-inner" />
      {/* diagonal light sweep, clipped to the seal */}
      <div className="absolute inset-0 overflow-hidden rounded-full print:hidden">
        <div className="holo-sweep absolute inset-y-0 -left-1/2 w-1/2 bg-gradient-to-r from-transparent via-white/75 to-transparent" />
      </div>
      {/* content */}
      <div className="absolute inset-0 flex flex-col items-center justify-center text-success">
        <ShieldCheck style={{ width: size * 0.26, height: size * 0.26 }} />
        <span
          className="mt-0.5 font-bold uppercase tracking-[0.15em] text-text-primary"
          style={{ fontSize: Math.max(7, size * 0.1) }}
        >
          Verified
        </span>
        <span
          className="uppercase tracking-[0.1em] text-text-secondary"
          style={{ fontSize: Math.max(6, size * 0.088) }}
        >
          Apexure QA
        </span>
      </div>
    </div>
  );
}
