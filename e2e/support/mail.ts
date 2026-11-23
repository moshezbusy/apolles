import { readFileSync } from "node:fs";
import { BASE_URL, EMAIL_SINK_FILE } from "./paths";

type SinkEmail = { to: string; subject: string; text: string; html?: string; sentAt: string };

// The set-password link of the latest email to `to` in the console adapter's mail sink,
// or null if there is none yet.
export function latestSetPasswordLink(to: string): string | null {
  const lines = readFileSync(EMAIL_SINK_FILE, "utf8").split("\n").filter(Boolean);
  const emails = lines.map((line) => JSON.parse(line) as SinkEmail).filter((e) => e.to === to);
  const latest = emails[emails.length - 1];
  if (!latest) return null;
  const escaped = BASE_URL.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`${escaped}/set-password/[A-Za-z0-9_-]+`).exec(latest.text)?.[0] ?? null;
}

// The 6-digit sign-in code of the latest "sign-in code" email to `to` (an agent on a device
// Apolles does not know yet enters it after the password), or null if there is none yet.
export function latestSignInCode(to: string): string | null {
  const lines = readFileSync(EMAIL_SINK_FILE, "utf8").split("\n").filter(Boolean);
  const emails = lines.map((line) => JSON.parse(line) as SinkEmail).filter((e) => e.to === to && e.subject === "Your Apolles sign-in code");
  return /sign-in code is (\d{6})/.exec(emails[emails.length - 1]?.text ?? "")?.[1] ?? null;
}
