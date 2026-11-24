"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { approveAuthRequest, BROWSER_COOKIE, denyAuthRequest } from "@/server/assistant/oauth";
import { requireAgent } from "@/server/auth/guards";

// The consent page's two buttons (plan 2026-11-22-mcp-search-connector). Each checks the agent
// session itself; the user and agency come only from it. The request id is the only form field,
// and the sign-in must belong to this browser (the cookie set when it was opened).

function requestId(formData: FormData): string {
  const value = formData.get("request");
  return typeof value === "string" ? value.slice(0, 64) : "";
}

async function browserNonce(): Promise<string | undefined> {
  return (await cookies()).get(BROWSER_COOKIE)?.value;
}

export async function allowAssistantAction(formData: FormData): Promise<void> {
  const { userId, agencyId } = await requireAgent();
  const id = requestId(formData);
  const location = await approveAuthRequest({ userId, agencyId }, id, await browserNonce());
  // Back to Claude or ChatGPT with the one-time code; or the page again, which says it expired.
  redirect(location ?? `/oauth/consent/${encodeURIComponent(id)}`);
}

export async function cancelAssistantAction(formData: FormData): Promise<void> {
  await requireAgent();
  const id = requestId(formData);
  const location = await denyAuthRequest(id, await browserNonce());
  redirect(location ?? "/settings?tab=assistants");
}
