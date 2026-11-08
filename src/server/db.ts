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
let client: PrismaClient | undefined;

function getClient(): PrismaClient {
  if (!client) {
    client = globalForDb.__apollesDb ?? createClient();
    if (process.env.NODE_ENV !== "production") {
      globalForDb.__apollesDb = client;
    }
  }
  return client;
}

// The client is created on first use, not at import time: `next build` loads server modules
// (pages, route handlers) without a database, and must not fail there. A missing
// DATABASE_URL still fails loudly, on the first query.
export const db: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, property) {
    const target = getClient();
    const value: unknown = Reflect.get(target, property, target);
    return typeof value === "function" ? value.bind(target) : value;
  },
});
