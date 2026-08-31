"use client";

import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Triggers the browser print dialog (Save as PDF) for the certificate. */
export function PrintButton() {
  return (
    <Button size="sm" onClick={() => window.print()}>
      <Download /> Download / Print
    </Button>
  );
}
