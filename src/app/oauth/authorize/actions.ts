"use server";

import { notFound, redirect } from "next/navigation";
import { requireAgent } from "@/server/auth/guards";
import { assistantConfig } from "@/server/assistant/config";
import { issueAuthCode, parseAuthorizeRequest, redirectWith } from "@/server/assistant/oauth";
import { authorizeParamsFrom } from "./params";

// The agent's answer on the consent page. Both actions check the agent session themselves and
// read the request again from the form: nothing from the page is trusted. The userId and
// agencyId come only from the session.

export async function allowAssistantAction(formData: FormData): Promise<void> {
  const config = assistantConfig();
  if (!config) notFound();
  const agent = await requireAgent();
  const parsed = parseAuthorizeRequest(authorizeParamsFrom(formData), config);
  if (!parsed.ok) {
    if (parsed.redirectable) redirect(redirectWith(parsed.redirectUri, { error: parsed.error, state: parsed.state }, config.issuer));
    redirect("/search"); // never send anything to an untrusted address
  }
  const code = await issueAuthCode(agent, parsed.request);
  redirect(redirectWith(parsed.request.redirectUri, { code, state: parsed.request.state }, config.issuer));
}

export async function denyAssistantAction(formData: FormData): Promise<void> {
  const config = assistantConfig();
  if (!config) notFound();
  await requireAgent();
  const parsed = parseAuthorizeRequest(authorizeParamsFrom(formData), config);
  if (parsed.ok) redirect(redirectWith(parsed.request.redirectUri, { error: "access_denied", state: parsed.request.state }, config.issuer));
  if (parsed.redirectable) redirect(redirectWith(parsed.redirectUri, { error: "access_denied", state: parsed.state }, config.issuer));
  redirect("/search");
}
