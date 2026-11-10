// Expedia Rapid settings from the environment. Outside production only the test endpoint is
// accepted ("no live credentials, ever"): a live URL set by mistake on staging fails at once.
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
  const production = process.env.APP_ENV === "production";
  const baseUrl = (process.env.EXPEDIA_BASE_URL || TEST_BASE_URL).replace(/\/+$/, "");
  if (!production && baseUrl !== TEST_BASE_URL) {
    throw new Error(`EXPEDIA_BASE_URL must be ${TEST_BASE_URL} outside production`);
  }
  if (production && baseUrl !== LIVE_BASE_URL && baseUrl !== TEST_BASE_URL) {
    throw new Error(`EXPEDIA_BASE_URL must be ${LIVE_BASE_URL} or ${TEST_BASE_URL}`);
  }
  return { apiKey, sharedSecret, baseUrl, production };
}
