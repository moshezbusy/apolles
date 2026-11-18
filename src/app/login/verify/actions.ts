"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { requireAgentPendingCode } from "@/server/auth/guards";
import { DEVICE_COOKIE, DEVICE_TTL_MS, sendSignInCode, trustDevice, verifySignInCode } from "@/server/auth/signin-code";

export type VerifyState = { error?: string; notice?: string } | null;

// The 6-digit code from the email (plan 8e). Right: this browser is remembered for 90 days.
export async function verifyCodeAction(_previous: VerifyState, formData: FormData): Promise<VerifyState> {
  const { userId, sessionId } = await requireAgentPendingCode();
  const raw = formData.get("code");
  const code = typeof raw === "string" ? raw.replace(/\s/g, "").slice(0, 6) : "";
  const result = await verifySignInCode(sessionId, code);
  if (result === "locked") redirect("/login?code=locked");
  if (result === "expired") return { error: "This code has expired. Send a new code." };
  if (result === "wrong") return { error: "That code is not right. Check the email and try again." };
  (await cookies()).set(DEVICE_COOKIE, await trustDevice(userId), { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: DEVICE_TTL_MS / 1000 });
  redirect("/search");
}

export async function resendCodeAction(): Promise<VerifyState> {
  const { sessionId } = await requireAgentPendingCode();
  const result = await sendSignInCode(sessionId);
  if (result === "gone") redirect("/login");
  return result === "sent" ? { notice: "A new code is on its way. It expires in 10 minutes." } : { error: "Too many codes for this sign-in. Sign in again to get a new one." };
}
