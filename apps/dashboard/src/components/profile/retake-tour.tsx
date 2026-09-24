"use client";

import { Compass } from "lucide-react";
import { Button } from "@/components/ui/button";
import { startTour } from "@/components/onboarding/tour";

/** Replays the tour, filtered by the rank the person holds right now. */
export function RetakeTourButton() {
  return (
    <Button type="button" variant="secondary" onClick={startTour}>
      <Compass /> Retake the tour
    </Button>
  );
}
