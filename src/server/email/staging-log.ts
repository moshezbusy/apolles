import type { EmailMessage } from "@/server/email/port";

// Staging-only adapter (EMAIL_PROVIDER=staging-log). Staging has no email provider yet, so
// each email is written to stdout as one JSON line, and the operator reads the set-password
// and reset links from the container log:
//   {"type":"staging-email","to":...,"subject":...,"text":...}
// Those links are secrets, which is why logging bodies is forbidden everywhere else (R14).
// So this adapter needs a second, separate switch: it works only when APP_ENV is exactly
// "staging", checked on every send. Anything else throws and nothing is written.
// (NODE_ENV is "production" in the staging container too, so it cannot be the guard.)
export async function sendStagingLogEmail(msg: EmailMessage): Promise<void> {
  if (process.env.APP_ENV !== "staging") {
    throw new Error(
      "EMAIL_PROVIDER=staging-log works only with APP_ENV=staging. Use EMAIL_PROVIDER=postmark.",
    );
  }

  console.log(
    JSON.stringify({ type: "staging-email", to: msg.to, subject: msg.subject, text: msg.text }),
  );
}
