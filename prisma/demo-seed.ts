// Staging start-up (deploy/staging/entrypoint.sh) runs this when SUPPLIER_MODE=fake: adds the
// demo destinations and hotels (src/server/content/demo-seed.ts). It refuses to run anywhere
// the fake supplier is not allowed (never production). Prints counts only.
import { seedDemoContent } from "@/server/content/demo-seed";
import { db } from "@/server/db";
import { isDemoSupplier } from "@/server/supplier";

async function main(): Promise<void> {
  if (!isDemoSupplier()) {
    console.log("Demo seed skipped: SUPPLIER_MODE is not fake.");
    return;
  }
  const { destinations, hotels } = await seedDemoContent();
  console.log(`Demo seed: ${destinations} destinations, ${hotels} hotels.`);
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
