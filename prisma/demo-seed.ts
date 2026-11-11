// Staging start-up (deploy/staging/entrypoint.sh) runs this when SUPPLIER_MODE=fake: adds the
// demo destinations and hotels (src/server/content/demo-seed.ts). It refuses to run anywhere
// the fake supplier is not allowed (never production). Also makes the demo agent login: while
// that agent has no password, it prints a one-time set-password link (60 minutes) to the log.
import { seedDemoAgent, seedDemoContent } from "@/server/content/demo-seed";
import { db } from "@/server/db";
import { isDemoSupplier } from "@/server/supplier";

async function main(): Promise<void> {
  if (!isDemoSupplier()) {
    console.log("Demo seed skipped: SUPPLIER_MODE is not fake.");
    return;
  }
  const { destinations, hotels } = await seedDemoContent();
  console.log(`Demo seed: ${destinations} destinations, ${hotels} hotels.`);
  const appUrl = process.env.APP_URL;
  if (!appUrl) return;
  const agent = await seedDemoAgent(appUrl);
  // The link works once, for 60 minutes; it is printed only while the demo agent has no password.
  if (agent.setPasswordLink) console.log(`Demo agent ${agent.email}: set the password here: ${agent.setPasswordLink}`);
  else console.log(`Demo agent ${agent.email} is ready (password already set).`);
}

main()
  .then(() => db.$disconnect())
  .then(
    () => process.exit(0),
    (error: unknown) => {
      console.error("Demo seed failed:", error instanceof Error ? error.message : String(error));
      process.exit(1);
    },
  );
