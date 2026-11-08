export type EmailMessage = { to: string; subject: string; text: string; html?: string };

// The single way the app sends email. For now it only writes to the server console;
// Task 5 adds the Postmark adapter and EMAIL_PROVIDER selection behind this same function.
export async function sendEmail(msg: EmailMessage): Promise<void> {
  console.info(`[email:console] to=${msg.to} subject=${JSON.stringify(msg.subject)}\n${msg.text}`);
}
