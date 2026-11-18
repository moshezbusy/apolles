import type { EmailMessage } from "@/server/email/port";

const POSTMARK_EMAIL_URL = "https://api.postmarkapp.com/email";
const TIMEOUT_MS = 10_000;

function requiredEnv(name: "POSTMARK_SERVER_TOKEN" | "EMAIL_FROM"): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

// A sender name that cannot break the From header: no quotes, angle brackets, backslashes or
// control characters, at most 60 characters.
export function displayName(name: string): string {
  return name.replace(/[\p{Cc}\p{Cf}"<>\\]/gu, "").trim().slice(0, 60);
}

// EMAIL_FROM may be "Name <address>" or just the address.
function senderAddress(from: string): string {
  return /<([^<>\s]+)>\s*$/.exec(from)?.[1] ?? from.trim();
}

// Sends one email through Postmark's HTTP API (no SDK). Errors name only the HTTP status:
// never the server token, the recipient's message or Postmark's response body.
export async function sendPostmarkEmail(msg: EmailMessage): Promise<void> {
  const token = requiredEnv("POSTMARK_SERVER_TOKEN");
  const from = requiredEnv("EMAIL_FROM");

  const response = await fetch(POSTMARK_EMAIL_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-Postmark-Server-Token": token,
    },
    body: JSON.stringify({
      From: msg.fromName ? `"${displayName(msg.fromName)}" <${senderAddress(from)}>` : from,
      ...(msg.replyTo ? { ReplyTo: msg.replyTo } : {}),
      To: msg.to,
      Subject: msg.subject,
      TextBody: msg.text,
      ...(msg.html !== undefined ? { HtmlBody: msg.html } : {}),
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`Postmark send failed: HTTP ${response.status}`);
  }
}
