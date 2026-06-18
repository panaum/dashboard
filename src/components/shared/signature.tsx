"use client";

import { useEffect } from "react";

// A quiet console easter egg — only seen by someone who opens DevTools.
export function Signature() {
  useEffect(() => {
    console.log(
      "%c✦ Deliverables Dashboard%c\nCrafted by Anaum",
      "font-weight:600;font-size:13px;color:#4f46e5",
      "font-size:12px;color:#8a8a99",
    );
  }, []);
  return null;
}
