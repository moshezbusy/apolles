"use server";

import { headers } from "next/headers";
import { getClientIp } from "@/server/client-ip";
import { recordView, submitSelection, type SelectionResult } from "@/server/quotes/sharing";

// The client page's actions (screens 16, 17). There is no session: the token in the URL is the
// only key, and it opens one quote only. Both actions are limited per client IP.

export async function recordViewAction(token: string): Promise<void> {
  await recordView(token, getClientIp(await headers()));
}

export async function submitSelectionAction(token: string, picks: Record<string, string>, note: string): Promise<SelectionResult> {
  // Plain objects only, with string values; anything else is refused by the service's schema.
  const safePicks: Record<string, string> = {};
  if (picks && typeof picks === "object" && !Array.isArray(picks)) {
    for (const [key, value] of Object.entries(picks).slice(0, 20)) {
      if (typeof key === "string" && typeof value === "string") safePicks[key.slice(0, 64)] = value.slice(0, 64);
    }
  }
  return submitSelection(token, { picks: safePicks, note: typeof note === "string" ? note.slice(0, 1100) : "" }, getClientIp(await headers()));
}
