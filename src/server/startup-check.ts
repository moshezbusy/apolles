// Start-up safety: a production build refuses to boot with settings that would make it run
// quietly in the wrong mode. Before this check a production build with APP_ENV unset started
// normally and talked to Expedia's TEST system; production with the fake supplier or the
// console email adapter would only fail later, request by request.
//
// Called from src/instrumentation.ts when the server starts (never during `next build`).
// Kept free of imports so it can run anywhere (the one import, the second supplier's settings
// check, has no imports either), and it names variables only: never a value.

import { fxProblems, layerConfigProblems, readSupplierList } from "./supplier/hotelbeds-layer/config";

export type Env = Record<string, string | undefined>;

const EXPEDIA_BASE_URLS = ["https://api.ean.com/v3", "https://test.ean.com/v3"];

// Must hold in production. Each one is something a request would otherwise fail on later.
const REQUIRED_IN_PRODUCTION = [
  "EXPEDIA_API_KEY",
  "EXPEDIA_SHARED_SECRET",
  "EXPEDIA_BILLING_GIVEN_NAME",
  "EXPEDIA_BILLING_FAMILY_NAME",
  "EXPEDIA_BILLING_ADDRESS_LINE1",
  "EXPEDIA_BILLING_CITY",
] as const;

function isSet(env: Env, name: string): boolean {
  return (env[name] ?? "").trim() !== "";
}

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

// TOTP_ENCRYPTION_KEY: exactly 32 bytes, written as base64 (src/server/auth/totp-secret.ts).
export function isValidTotpKey(value: string): boolean {
  const text = value.trim();
  return /^[A-Za-z0-9+/]+={0,2}$/.test(text) && Buffer.from(text, "base64").length === 32;
}

// Every reason this environment must not start, in plain words. Empty = fine.
export function startupProblems(env: Env): string[] {
  if (env.NODE_ENV !== "production") return []; // development and tests
  const appEnv = env.APP_ENV;
  if (appEnv !== "staging" && appEnv !== "production") {
    return ['APP_ENV must be exactly "staging" or "production" in a production build. It says which deployment this is; without it the app would run against Expedia\'s test system.'];
  }

  const problems: string[] = [];
  if (!isSet(env, "DATABASE_URL")) problems.push("DATABASE_URL is not set.");
  if (isSet(env, "TOTP_ENCRYPTION_KEY") && !isValidTotpKey(env.TOTP_ENCRYPTION_KEY ?? "")) {
    problems.push("TOTP_ENCRYPTION_KEY must be 32 random bytes written as base64 (make one with: openssl rand -base64 32).");
  }
  // The second supplier (Hotelbeds through the supplier layer) and the temporary staging-only
  // currency conversion: the conversion is refused in production (fxProblems says so).
  let suppliers: ReturnType<typeof readSupplierList> = { main: null, hotelbeds: false };
  try {
    suppliers = readSupplierList(env);
  } catch (error) {
    problems.push(error instanceof Error ? `${error.message}.` : "SUPPLIERS cannot be read.");
  }
  if (suppliers.hotelbeds) problems.push(...layerConfigProblems(env));
  problems.push(...fxProblems(env));
  if (appEnv !== "production") return problems;
  if (suppliers.main === "fake") {
    problems.push('SUPPLIERS must not name "fake" in production. The fake supplier is only for development and the staging demo.');
  }

  const supplierMode = env.SUPPLIER_MODE ?? "";
  if (supplierMode !== "" && supplierMode !== "expedia") {
    problems.push('SUPPLIER_MODE must be unset or "expedia" in production. The fake supplier (made-up hotels and bookings) is only for development and the staging demo.');
  }
  if (env.EMAIL_PROVIDER !== "postmark") {
    problems.push('EMAIL_PROVIDER must be "postmark" in production. "console" and "staging-log" do not send real emails.');
  } else {
    for (const name of ["POSTMARK_SERVER_TOKEN", "EMAIL_FROM"]) if (!isSet(env, name)) problems.push(`${name} is not set (needed to send email).`);
  }
  if (!isSet(env, "APP_URL")) problems.push("APP_URL is not set (the address used in email links).");
  else if (!isHttpsUrl(env.APP_URL ?? "")) problems.push("APP_URL must be a full https:// address in production.");
  if (!isSet(env, "ADMIN_ALERT_EMAIL")) problems.push("ADMIN_ALERT_EMAIL is not set (where lockout and booking alerts go).");
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((env.ADMIN_ALERT_EMAIL ?? "").trim())) problems.push("ADMIN_ALERT_EMAIL is not a valid email address.");
  for (const name of REQUIRED_IN_PRODUCTION) if (!isSet(env, name)) problems.push(`${name} is not set.`);
  if (!isSet(env, "EXPEDIA_BASE_URL")) problems.push("EXPEDIA_BASE_URL is not set. Production must name its Expedia endpoint.");
  else if (!EXPEDIA_BASE_URLS.includes((env.EXPEDIA_BASE_URL ?? "").trim().replace(/\/+$/, ""))) {
    problems.push(`EXPEDIA_BASE_URL must be ${EXPEDIA_BASE_URLS.join(" or ")}.`);
  }
  if (!isSet(env, "TOTP_ENCRYPTION_KEY")) {
    problems.push("TOTP_ENCRYPTION_KEY is not set. It encrypts the admin's authenticator key in the database (make one with: openssl rand -base64 32).");
  }
  return problems;
}

type Effects = { exit: (code: number) => void; log: (line: string) => void };

// Logs every problem and stops the process. Does nothing when the environment is fine.
export function refuseToStartOnBadEnv(env: Env = process.env, effects: Effects = { exit: (code) => process.exit(code), log: (line) => console.error(line) }): void {
  const problems = startupProblems(env);
  if (problems.length === 0) return;
  effects.log("Refusing to start: the environment is not safe to run.");
  for (const problem of problems) effects.log(`- ${problem}`);
  effects.exit(1);
}
