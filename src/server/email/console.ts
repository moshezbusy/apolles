import { appendFile } from "node:fs/promises";
import type { EmailMessage } from "@/server/email/port";

// Development / test adapter. It never sends anything.
// - stdout gets only the recipient and subject: bodies carry set/reset links, which are
//   secrets and must not end up in logs.
// - If EMAIL_SINK_FILE is set, the whole message is appended to that file as one JSON line,
//   so end-to-end tests can read the links.
// It refuses to run in production, where a "sent" email would silently go nowhere.
export async function sendConsoleEmail(msg: EmailMessage): Promise<void> {
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "The console email adapter cannot be used in production. Set EMAIL_PROVIDER=postmark.",
    );
  }

  console.info(`[email:console] to=${msg.to} subject=${JSON.stringify(msg.subject)}`);

  const sinkFile = process.env.EMAIL_SINK_FILE;
  if (sinkFile) {
    const line = JSON.stringify({
      to: msg.to,
      subject: msg.subject,
      text: msg.text,
      ...(msg.html !== undefined ? { html: msg.html } : {}),
      sentAt: new Date().toISOString(),
    });
    await appendFile(sinkFile, `${line}\n`, "utf8");
  }
}
