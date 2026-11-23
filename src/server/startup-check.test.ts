import { describe, expect, it, vi } from "vitest";
import { refuseToStartOnBadEnv, startupProblems } from "./startup-check";

// A complete, valid production environment (made-up values).
const PRODUCTION = {
  NODE_ENV: "production",
  APP_ENV: "production",
  DATABASE_URL: "postgresql://u:p@db:5432/apolles",
  APP_URL: "https://app.apolles.example",
  ADMIN_ALERT_EMAIL: "alerts@apolles.example",
  EMAIL_PROVIDER: "postmark",
  EMAIL_FROM: "Apolles <no-reply@apolles.example>",
  POSTMARK_SERVER_TOKEN: "pm-token-value",
  EXPEDIA_API_KEY: "key-value",
  EXPEDIA_SHARED_SECRET: "secret-value",
  EXPEDIA_BASE_URL: "https://api.ean.com/v3",
  EXPEDIA_BILLING_GIVEN_NAME: "Taya",
  EXPEDIA_BILLING_FAMILY_NAME: "Tourism",
  EXPEDIA_BILLING_ADDRESS_LINE1: "1 Example St",
  EXPEDIA_BILLING_CITY: "Tel Aviv",
  TOTP_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
};
const STAGING = { NODE_ENV: "production", APP_ENV: "staging", DATABASE_URL: "postgresql://u:p@db:5432/apolles_staging", SUPPLIER_MODE: "fake", EMAIL_PROVIDER: "staging-log" };

const without = (env: Record<string, string>, ...names: string[]) => Object.fromEntries(Object.entries(env).filter(([key]) => !names.includes(key)));

describe("startupProblems", () => {
  it("development and tests (not a production build) are never checked", () => {
    expect(startupProblems({})).toEqual([]);
    expect(startupProblems({ NODE_ENV: "development" })).toEqual([]);
    expect(startupProblems({ NODE_ENV: "test", APP_ENV: "production" })).toEqual([]);
  });

  it("a production build must say which deployment it is: exactly staging or production", () => {
    for (const appEnv of [undefined, "", "prod", "Production", "staging ", "development"]) {
      const problems = startupProblems({ ...PRODUCTION, APP_ENV: appEnv });
      expect(problems, String(appEnv)).toHaveLength(1);
      expect(problems[0]).toContain("APP_ENV");
    }
  });

  it("a complete production environment and the staging demo both start", () => {
    expect(startupProblems(PRODUCTION)).toEqual([]);
    expect(startupProblems({ ...PRODUCTION, EXPEDIA_BASE_URL: "https://test.ean.com/v3", SUPPLIER_MODE: "expedia" })).toEqual([]);
    expect(startupProblems(STAGING)).toEqual([]);
  });

  it("production refuses the fake supplier", () => {
    const problems = startupProblems({ ...PRODUCTION, SUPPLIER_MODE: "fake" });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("SUPPLIER_MODE");
    expect(startupProblems({ ...PRODUCTION, SUPPLIER_MODE: "something" })).toHaveLength(1);
  });

  it("production refuses the email settings meant for development and staging", () => {
    for (const provider of [undefined, "", "console", "staging-log", "smtp"]) {
      const problems = startupProblems({ ...PRODUCTION, EMAIL_PROVIDER: provider });
      expect(problems, String(provider)).toHaveLength(1);
      expect(problems[0]).toContain("EMAIL_PROVIDER");
    }
    expect(startupProblems(without(PRODUCTION, "POSTMARK_SERVER_TOKEN", "EMAIL_FROM"))).toHaveLength(2);
  });

  it.each([
    "DATABASE_URL", "APP_URL", "ADMIN_ALERT_EMAIL", "EXPEDIA_API_KEY", "EXPEDIA_SHARED_SECRET", "EXPEDIA_BASE_URL",
    "EXPEDIA_BILLING_GIVEN_NAME", "EXPEDIA_BILLING_FAMILY_NAME", "EXPEDIA_BILLING_ADDRESS_LINE1", "EXPEDIA_BILLING_CITY", "TOTP_ENCRYPTION_KEY",
  ])("production refuses to start without %s, and names it", (name) => {
    for (const env of [without(PRODUCTION, name), { ...PRODUCTION, [name]: "" }, { ...PRODUCTION, [name]: "   " }]) {
      const problems = startupProblems(env);
      expect(problems).toHaveLength(1);
      expect(problems[0]).toContain(name);
    }
  });

  it("production refuses values of the wrong shape", () => {
    expect(startupProblems({ ...PRODUCTION, APP_URL: "http://app.apolles.example" })[0]).toContain("APP_URL");
    expect(startupProblems({ ...PRODUCTION, APP_URL: "app.apolles.example" })[0]).toContain("APP_URL");
    expect(startupProblems({ ...PRODUCTION, ADMIN_ALERT_EMAIL: "not-an-email" })[0]).toContain("ADMIN_ALERT_EMAIL");
    expect(startupProblems({ ...PRODUCTION, EXPEDIA_BASE_URL: "https://evil.example/v3" })[0]).toContain("EXPEDIA_BASE_URL");
    expect(startupProblems({ ...PRODUCTION, TOTP_ENCRYPTION_KEY: "too-short" })[0]).toContain("TOTP_ENCRYPTION_KEY");
    expect(startupProblems({ ...PRODUCTION, TOTP_ENCRYPTION_KEY: Buffer.alloc(16).toString("base64") })[0]).toContain("TOTP_ENCRYPTION_KEY");
  });

  it("staging needs its database, and a TOTP key only has to be valid when one is set", () => {
    expect(startupProblems(without(STAGING, "DATABASE_URL"))[0]).toContain("DATABASE_URL");
    expect(startupProblems({ ...STAGING, TOTP_ENCRYPTION_KEY: "bad" })[0]).toContain("TOTP_ENCRYPTION_KEY");
    expect(startupProblems({ ...STAGING, TOTP_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString("base64") })).toEqual([]);
  });

  it("lists every problem at once and never prints a value", () => {
    const problems = startupProblems({ ...PRODUCTION, SUPPLIER_MODE: "fake", EMAIL_PROVIDER: "console", APP_URL: "", ADMIN_ALERT_EMAIL: "bad-value-here" });
    expect(problems).toHaveLength(4);
    const text = problems.join("\n");
    for (const secret of ["pm-token-value", "key-value", "secret-value", "bad-value-here", "u:p@db", PRODUCTION.TOTP_ENCRYPTION_KEY]) expect(text).not.toContain(secret);
  });
});

describe("refuseToStartOnBadEnv", () => {
  it("does nothing when the environment is fine", () => {
    const exit = vi.fn();
    const log = vi.fn();
    refuseToStartOnBadEnv(PRODUCTION, { exit, log });
    expect(exit).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
  });

  it("logs each problem and exits with code 1", () => {
    const exit = vi.fn();
    const log = vi.fn();
    refuseToStartOnBadEnv(without(PRODUCTION, "APP_ENV"), { exit, log });
    expect(exit).toHaveBeenCalledWith(1);
    expect(log.mock.calls.flat().join("\n")).toContain("Refusing to start");
    expect(log.mock.calls.flat().join("\n")).toContain("APP_ENV");
  });
});
