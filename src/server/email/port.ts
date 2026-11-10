import { sendConsoleEmail } from "@/server/email/console";
import { sendPostmarkEmail } from "@/server/email/postmark";
import { sendStagingLogEmail } from "@/server/email/staging-log";

export type EmailMessage = { to: string; subject: string; text: string; html?: string };

// The single way the app sends email. The adapter is chosen by EMAIL_PROVIDER on every send:
//   console  (default) - development and tests; refuses to run in production
//   postmark           - real delivery through Postmark
//   staging-log        - staging only: writes each email to the log; refuses to run unless
//                        APP_ENV=staging
// Any other value fails here, loudly, instead of silently dropping the email.
export async function sendEmail(msg: EmailMessage): Promise<void> {
  const provider = process.env.EMAIL_PROVIDER || "console";
  switch (provider) {
    case "console":
      return sendConsoleEmail(msg);
    case "postmark":
      return sendPostmarkEmail(msg);
    case "staging-log":
      return sendStagingLogEmail(msg);
    default:
      throw new Error(
        `EMAIL_PROVIDER must be "console", "postmark" or "staging-log" (got ${JSON.stringify(provider)})`,
      );
  }
}
