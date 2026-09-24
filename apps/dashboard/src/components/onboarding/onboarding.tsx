"use client";

import { useCallback, useMemo, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ProfileForm } from "@/components/profile/profile-form";
import { AccessRequest, type AccessView } from "@/components/profile/access-request";
import type { ProfileMember } from "@/components/forms/profile-fields";
import { startTour } from "@/components/onboarding/tour";
import type { Actor } from "@/lib/permissions";
import { completeOnboarding } from "@/app/dashboard/personalization/actions";

type Step = "welcome" | "profile" | "access";

const subscribeNever = () => () => {};

/**
 * First-run onboarding, shown over the dashboard to a signed-in person whose
 * row says they have not finished it. Welcome → personalise → (Viewers only)
 * ask for Member access → the tour over the real sidebar.
 *
 * The flag is written only by an explicit finish or skip (completeOnboarding,
 * here or in TourHost) — never on render — so someone interrupted mid-flow
 * meets it again at their next visit rather than losing it.
 */
export function Onboarding({
  actor,
  member,
  access,
  timeZone,
}: {
  actor: Actor;
  member: ProfileMember;
  access: AccessView;
  timeZone?: string;
}) {
  const [step, setStep] = useState<Step | null>("welcome");
  // Portal only once there is a document — the same pattern as Dialog.
  const mounted = useSyncExternalStore(subscribeNever, () => true, () => false);
  const reduce = useReducedMotion();
  const steps = useMemo<Step[]>(
    () => (actor.rank === "VIEWER" ? ["welcome", "profile", "access"] : ["welcome", "profile"]),
    [actor.rank],
  );

  const toTour = useCallback(() => { setStep(null); startTour(); }, []);
  const advance = useCallback(() => {
    const n = steps.indexOf(step!);
    if (n < steps.length - 1) setStep(steps[n + 1]); else toTour();
  }, [steps, step, toTour]);
  const skipAll = useCallback(() => { setStep(null); void completeOnboarding(); }, []);

  const skip = (
    <button type="button" onClick={skipAll} className="text-xs font-medium text-text-secondary underline-offset-2 hover:text-text-primary hover:underline">
      Skip setup
    </button>
  );

  return (
    <>
      {mounted && createPortal(
        <AnimatePresence>
          {step && (
            <motion.div
              className="fixed inset-0 z-[60] overflow-y-auto bg-[rgba(20,20,43,0.55)]"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
            >
              <div className="flex min-h-full items-center justify-center p-4">
                <AnimatePresence mode="wait">
                  <motion.div
                    key={step}
                    className="w-full max-w-md"
                    role="dialog" aria-modal="true" aria-labelledby="onboarding-title"
                    initial={reduce ? { opacity: 0 } : { opacity: 0, y: 24, scale: 0.97 }}
                    animate={reduce ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
                    exit={reduce ? { opacity: 0 } : { opacity: 0, y: -16, scale: 0.98 }}
                    transition={reduce ? { duration: 0.15 } : { type: "spring", stiffness: 320, damping: 28 }}
                  >
                    <Card className="p-6 shadow-lg">
                      <div className="mb-4 flex items-center justify-between">
                        <span className="text-[11px] font-semibold uppercase tracking-[0.07em] text-text-muted">
                          Step {steps.indexOf(step) + 1} of {steps.length}
                        </span>
                        {skip}
                      </div>

                      {step === "welcome" && (
                        <div className="flex flex-col items-start gap-3">
                          <motion.span
                            className="flex size-11 items-center justify-center rounded-xl bg-accent/10 text-accent"
                            initial={reduce ? false : { rotate: -12, scale: 0.6 }}
                            animate={{ rotate: 0, scale: 1 }}
                            transition={{ type: "spring", stiffness: 300, damping: 14, delay: 0.1 }}
                          >
                            <Sparkles className="size-5" />
                          </motion.span>
                          <h2 id="onboarding-title" className="text-xl font-semibold text-text-primary">
                            Welcome, {member.nickname || member.name.split(" ")[0]}
                          </h2>
                          <p className="text-sm leading-relaxed text-text-secondary">
                            This is where Apexure tracks every page it builds and the QA behind it. A minute to set up your profile, then a short look around.
                          </p>
                          <Button className="mt-2 self-end" onClick={advance}>Let’s get you set up</Button>
                        </div>
                      )}

                      {step === "profile" && (
                        <div className="flex flex-col gap-4">
                          <div>
                            <h2 id="onboarding-title" className="text-lg font-semibold text-text-primary">Make it yours</h2>
                            <p className="mt-1 text-sm text-text-secondary">Your name as the team sees it, a nickname if you have one, and a photo. All optional to change.</p>
                          </div>
                          <ProfileForm
                            member={member}
                            submitLabel="Continue"
                            onSaved={advance}
                            secondary={<Button type="button" variant="ghost" onClick={advance}>Not now</Button>}
                          />
                        </div>
                      )}

                      {step === "access" && (
                        <div className="flex flex-col gap-4">
                          <div>
                            <h2 id="onboarding-title" className="text-lg font-semibold text-text-primary">Want more access?</h2>
                            <p className="mt-1 text-sm leading-relaxed text-text-secondary">
                              You’re currently a Viewer — you can view and work every board, but can’t add clients, sign off QA, or fill checklists. An admin can make you a Member.
                            </p>
                          </div>
                          <AccessRequest
                            state={access}
                            timeZone={timeZone}
                            onDone={advance}
                            secondary={<Button type="button" variant="ghost" onClick={advance}>Skip for now</Button>}
                          />
                        </div>
                      )}
                    </Card>
                  </motion.div>
                </AnimatePresence>
              </div>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </>
  );
}
