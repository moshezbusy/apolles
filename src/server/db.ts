import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

function createClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set");
  }
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
}

// Cache on globalThis in dev so hot reloads do not open a new connection pool each time.
const globalForDb = globalThis as unknown as { __apollesDb?: PrismaClient };

export const db: PrismaClient = globalForDb.__apollesDb ?? createClient();

if (process.env.NODE_ENV !== "production") {
  globalForDb.__apollesDb = db;
}
