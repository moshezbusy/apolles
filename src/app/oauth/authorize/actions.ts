"use server";

import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { aiSearchEnabled } from "@/server/ai/config";
import {
  approveConnection,
  checkAuthorizeRequest,
  denyRedirect,
  hitAuthorizeLimit,
  type AuthorizeCheck,
  type AuthorizeParams,
} from "@/server/ai/oauth";
import { requireAgent } from "@/server/auth/guards";
import { getClientIp } from "@/server/client-ip";
import { INVALID_LINK_COPY, NO_WINDOW_COPY, TOO_MANY_COPY } from "./copy";

export type ConsentState = { error: string } | null;

type Checked =
  | { agent: { userId: string; sessionId: string }; check: Extract<AuthorizeCheck, { kind: "ok" }> }
  | { error: string };

// The form's fields as authorize parameters; a repeated field becomes an array (refused later),
// a file means the form was not ours.
function fieldsOf(formData: FormData): AuthorizeParams | null {
  const out: Record<string, string | string[]> = {};
  for (const [key, value] of formData) {
    if (typeof value !== "string") return null;
    const previous = out[key];
    out[key] = previous === undefined ? value : [...(Array.isArray(previous) ? previous : [previous]), value];
  }
  return out;
}

// Both buttons: an agent session (admins go to /login), the per-IP limit, and every hidden
// field checked again on the server exactly like the page did. Nothing from the form is trusted.
async function checkForm(formData: FormData): Promise<Checked> {
  if (!aiSearchEnabled()) notFound();
  const { userId, sessionId } = await requireAgent();
  if (!(await hitAuthorizeLimit(getClientIp(await headers())))) return { error: TOO_MANY_COPY };
  const fields = fieldsOf(formData);
  const check = fields ? await checkAuthorizeRequest(fields, { strict: true }) : null;
  if (check?.kind !== "ok") return { error: INVALID_LINK_COPY };
  return { agent: { userId, sessionId }, check };
}

// Allow: only inside a connect window this session opened in the AI assistants tab (against
// consent phishing); the window is spent, a 60-second code is issued and the agent goes back
// to the assistant (303).
export async function allowAction(_previous: ConsentState, formData: FormData): Promise<ConsentState> {
  const checked = await checkForm(formData);
  if ("error" in checked) return checked;
  const redirectTo = await approveConnection(checked.agent, checked.check);
  if (redirectTo === null) return { error: NO_WINDOW_COPY };
  redirect(redirectTo);
}

// Deny: back to the assistant with access_denied. A changed form goes nowhere.
export async function denyAction(formData: FormData): Promise<void> {
  const checked = await checkForm(formData);
  if ("error" in checked) return;
  redirect(denyRedirect(checked.check));
}
