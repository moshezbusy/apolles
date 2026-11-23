"use server";

import { cookies, headers } from "next/headers";
import { SESSION_COOKIE, getSession } from "@/server/auth/session";
import { getClientIp } from "@/server/client-ip";
import { recordView, submitSelection, type SelectionResult } from "@/server/quotes/sharing";

// The client page's actions (screens 16, 17). There is no session: the token in the URL is the
// only key, and it opens one quote only. Both actions are limited per client IP.

// The agency of an agent signed in on this browser, if any: only to leave the agency's own
// people out of the client's view count. It opens nothing and is never required.
async function viewerAgencyId(): Promise<string | null> {
  const raw = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!raw) return null;
  return (await getSession(raw))?.agency?.id ?? null;
}

export async function recordViewAction(token: string): Promise<void> {
  await recordView(token, getClientIp(await headers()), await viewerAgencyId());
}

// `seen`: for each picked room, the price the page showed (cents). It is only compared on the
// server with the price now, so a choice made on an out-of-date page is not recorded.
export async function submitSelectionAction(token: string, picks: Record<string, string>, note: string, seen?: Record<string, number>): Promise<SelectionResult> {
  // Plain objects only, with string (or whole number) values; anything else is refused by the
  // service's schema.
  const safePicks: Record<string, string> = {};
  if (picks && typeof picks === "object" && !Array.isArray(picks)) {
    for (const [key, value] of Object.entries(picks).slice(0, 20)) {
      if (typeof key === "string" && typeof value === "string") safePicks[key.slice(0, 64)] = value.slice(0, 64);
    }
  }
  const safeSeen: Record<string, number> = {};
  if (seen && typeof seen === "object" && !Array.isArray(seen)) {
    for (const [key, value] of Object.entries(seen).slice(0, 20)) {
      if (typeof key === "string" && typeof value === "number" && Number.isSafeInteger(value)) safeSeen[key.slice(0, 64)] = value;
    }
  }
  return submitSelection(token, { picks: safePicks, seen: safeSeen, note: typeof note === "string" ? note.slice(0, 1100) : "" }, getClientIp(await headers()));
}
