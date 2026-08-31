"use client";

import { useRef } from "react";
import {
  motion,
  useMotionValue,
  useSpring,
  useMotionTemplate,
} from "motion/react";
import { cn } from "@/lib/utils";

/**
 * Wraps a card so it tilts in 3D toward the cursor with a soft glare that
 * tracks the pointer — the certificate reads as a physical object, not a flat
 * page. Subtle by design (max ~6°). No-ops on touch (no hover), and print/
 * reduced-motion render it flat.
 */
export function TiltCard({
  children,
  className,
  max = 6,
}: {
  children: React.ReactNode;
  className?: string;
  max?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);

  const rx = useMotionValue(0);
  const ry = useMotionValue(0);
  const glareX = useMotionValue(50);
  const glareY = useMotionValue(50);
  const glareO = useMotionValue(0);

  const srx = useSpring(rx, { stiffness: 150, damping: 18, mass: 0.4 });
  const sry = useSpring(ry, { stiffness: 150, damping: 18, mass: 0.4 });
  const sGlareO = useSpring(glareO, { stiffness: 120, damping: 20 });

  const glare = useMotionTemplate`radial-gradient(380px circle at ${glareX}% ${glareY}%, rgba(255,255,255,0.22), transparent 45%)`;

  function handleMove(e: React.PointerEvent<HTMLDivElement>) {
    if (e.pointerType === "touch") return;
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width; // 0..1
    const py = (e.clientY - r.top) / r.height;
    ry.set((px - 0.5) * 2 * max);
    rx.set(-(py - 0.5) * 2 * max);
    glareX.set(px * 100);
    glareY.set(py * 100);
    glareO.set(1);
  }

  function reset() {
    rx.set(0);
    ry.set(0);
    glareO.set(0);
  }

  return (
    <div
      ref={ref}
      onPointerMove={handleMove}
      onPointerLeave={reset}
      className={cn("[perspective:1500px] print:[perspective:none]", className)}
    >
      <motion.div
        style={{ rotateX: srx, rotateY: sry, transformStyle: "preserve-3d" }}
        className="relative will-change-transform print:!rotate-0 print:!transform-none"
      >
        {children}
        <motion.div
          aria-hidden
          style={{ background: glare, opacity: sGlareO }}
          className="pointer-events-none absolute inset-0 rounded-2xl mix-blend-soft-light print:hidden"
        />
      </motion.div>
    </div>
  );
}
