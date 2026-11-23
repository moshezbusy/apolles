// Expedia Rapid settings from the environment. Outside production only the test endpoint is
// accepted ("no live credentials, ever"): a live URL set by mistake on staging fails at once.
// A production build must say which deployment it is (APP_ENV): with APP_ENV forgotten it
// would otherwise run quietly against the test system. The server also refuses to start then
// (src/server/startup-check.ts); this covers every other process that reads the settings.
export const TEST_BASE_URL = "https://test.ean.com/v3";
export const LIVE_BASE_URL = "https://api.ean.com/v3";

export type ExpediaConfig = { apiKey: string; sharedSecret: string; baseUrl: string; production: boolean };

function required(name: "EXPEDIA_API_KEY" | "EXPEDIA_SHARED_SECRET"): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

export function readExpediaConfig(): ExpediaConfig {
  const apiKey = required("EXPEDIA_API_KEY");
  const sharedSecret = required("EXPEDIA_SHARED_SECRET");
  const appEnv = process.env.APP_ENV;
  if (process.env.NODE_ENV === "production" && appEnv !== "staging" && appEnv !== "production") {
    throw new Error('APP_ENV must be "staging" or "production" in a production build');
  }
  const production = appEnv === "production";
  // Production must name its endpoint: a forgotten variable must not quietly run on test.
  if (production && !process.env.EXPEDIA_BASE_URL) throw new Error("EXPEDIA_BASE_URL must be set in production");
  const baseUrl = (process.env.EXPEDIA_BASE_URL || TEST_BASE_URL).replace(/\/+$/, "");
  if (!production && baseUrl !== TEST_BASE_URL) {
    throw new Error(`EXPEDIA_BASE_URL must be ${TEST_BASE_URL} outside production`);
  }
  if (production && baseUrl !== LIVE_BASE_URL && baseUrl !== TEST_BASE_URL) {
    throw new Error(`EXPEDIA_BASE_URL must be ${LIVE_BASE_URL} or ${TEST_BASE_URL}`);
  }
  return { apiKey, sharedSecret, baseUrl, production };
}
