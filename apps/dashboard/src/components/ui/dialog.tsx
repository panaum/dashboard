"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "motion/react";
import { X } from "lucide-react";
import { Card } from "@/components/ui/card";

export function Dialog({
  trigger,
  title,
  size = "md",
  children,
}: {
  trigger: React.ReactNode;
  title: string;
  size?: "md" | "lg";
  /** Render-prop: receives a `close` callback to dismiss the dialog. */
  children: (close: () => void) => React.ReactNode;
}) {
  const [open, setOpen] = React.useState(false);
  const [mounted, setMounted] = React.useState(false);
  const close = React.useCallback(() => setOpen(false), []);

  React.useEffect(() => setMounted(true), []);

  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, close]);

  // Portal to <body> so the fixed overlay escapes any transformed ancestor
  // (e.g. the page-transition wrapper), which would otherwise break `fixed`.
  const overlay = (
    <AnimatePresence>
      {open && (
          <motion.div
            className="fixed inset-0 z-50 overflow-y-auto bg-black/30"
            onClick={close}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
          >
            <div className="flex min-h-full items-center justify-center p-4">
              <motion.div
                onClick={(e) => e.stopPropagation()}
                initial={{ opacity: 0, scale: 0.96, y: 8 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.96, y: 8 }}
                transition={{ type: "spring", stiffness: 400, damping: 30 }}
                className={size === "lg" ? "w-full max-w-2xl" : "w-full max-w-md"}
              >
                <Card className="flex max-h-[90vh] flex-col p-6 shadow-lg">
                  <div className="mb-5 flex items-center justify-between">
                    <h2 className="text-lg font-semibold text-text-primary">
                      {title}
                    </h2>
                    <button
                      type="button"
                      onClick={close}
                      className="rounded-md p-1 text-text-secondary hover:bg-card-soft hover:text-text-primary"
                      aria-label="Close"
                    >
                      <X className="size-4" />
                    </button>
                  </div>
                  <div className="-mx-1 overflow-y-auto px-1">
                    {children(close)}
                  </div>
                </Card>
              </motion.div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
  );

  return (
    <>
      <span onClick={() => setOpen(true)} className="contents">
        {trigger}
      </span>
      {mounted && createPortal(overlay, document.body)}
    </>
  );
}
