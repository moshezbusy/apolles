// `pnpm admin:unlock <email>`: clears the sign-in lockout of one account (owner command).
// Prints one line and nothing secret.
import { z } from "zod";
import { unlockUser } from "@/server/auth/unlock";

const USAGE = "Usage: pnpm admin:unlock <email>";

async function main(): Promise<number> {
  const parsed = z.email().safeParse((process.argv[2] ?? "").trim());
  if (!parsed.success || process.argv.length > 3) {
    console.error(USAGE);
    return 1;
  }
  const email = parsed.data.toLowerCase();
  switch (await unlockUser(email)) {
    case "UNLOCKED":
      console.info(`Unlocked ${email}.`);
      return 0;
    case "NOT_LOCKED":
      console.info(`${email} was not locked.`);
      return 0;
    case "NOT_FOUND":
      console.error("No user with that email.");
      return 1;
  }
}

main().then(
  (exitCode) => process.exit(exitCode),
  (error: unknown) => {
    console.error("Unlock failed:", error instanceof Error ? error.message : String(error));
    process.exit(1);
  },
);
