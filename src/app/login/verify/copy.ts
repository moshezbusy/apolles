import type { SendResult } from "@/server/auth/signin-code";

export type VerifyState = { error?: string; notice?: string } | null;

// What the agent is told for each outcome of sending a sign-in code, on the sign-in form and
// on "Resend code" ("gone" has no text: the agent goes back to sign-in). Kept outside the
// server-action files, which may only export actions.
export const CODE_SENT_NOTICE = "A new code is on its way. It expires in 10 minutes.";
export const CODE_NOT_SENT_COPY: Record<Exclude<SendResult, "sent" | "gone">, string> = {
  limited: "Too many codes for this sign-in. Sign in again to get a new one.",
  "limited-hour": "Too many sign-in codes were sent to this account. Try again in an hour.",
  failed: "We could not send the code. Try again in a few minutes.",
};
