import { sendConsoleEmail } from "@/server/email/console";
import { sendPostmarkEmail } from "@/server/email/postmark";

export type EmailMessage = { to: string; subject: string; text: string; html?: string };

// The single way the app sends email. The adapter is chosen by EMAIL_PROVIDER on every send:
//   console  (default) - development and tests; refuses to run in production
//   postmark           - real delivery through Postmark
// Any other value fails here, loudly, instead of silently dropping the email.
export async function sendEmail(msg: EmailMessage): Promise<void> {
  const provider = process.env.EMAIL_PROVIDER || "console";
  switch (provider) {
    case "console":
      return sendConsoleEmail(msg);
    case "postmark":
      return sendPostmarkEmail(msg);
    default:
      throw new Error(
        `EMAIL_PROVIDER must be "console" or "postmark" (got ${JSON.stringify(provider)})`,
      );
  }
}
