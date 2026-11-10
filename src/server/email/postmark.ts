import type { EmailMessage } from "@/server/email/port";

const POSTMARK_EMAIL_URL = "https://api.postmarkapp.com/email";
const TIMEOUT_MS = 10_000;

function requiredEnv(name: "POSTMARK_SERVER_TOKEN" | "EMAIL_FROM"): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
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
      From: from,
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
