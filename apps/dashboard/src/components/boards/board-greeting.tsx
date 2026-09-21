"use client";

import { useEffect, useState } from "react";
import { greeting } from "@/lib/board-alive";

/**
 * The viewer's clock, not the server's: a board opened in Srinagar at 9am
 * should not say "Good evening" because a function in Sydney thinks so.
 *
 * Rendered empty on the server and filled after mount, which also keeps it
 * out of the HTML that gets hydrated — a greeting that disagreed with itself
 * for one frame would be worse than a beat of nothing.
 */
export function BoardGreeting({ name }: { name?: string | null }) {
  const [line, setLine] = useState<string | null>(null);
  useEffect(() => { setLine(greeting(new Date().getHours(), name)); }, [name]);
  return <span suppressHydrationWarning>{line ?? ""}</span>;
}
