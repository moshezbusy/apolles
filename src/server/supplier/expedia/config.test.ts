import { afterEach, describe, expect, it, vi } from "vitest";
import { readExpediaConfig } from "./config";

describe("readExpediaConfig", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("defaults to the test endpoint", () => {
    vi.stubEnv("EXPEDIA_API_KEY", "k");
    vi.stubEnv("EXPEDIA_SHARED_SECRET", "s");
    vi.stubEnv("EXPEDIA_BASE_URL", "");
    vi.stubEnv("APP_ENV", "staging");
    expect(readExpediaConfig()).toEqual({ apiKey: "k", sharedSecret: "s", baseUrl: "https://test.ean.com/v3", production: false });
  });

  it("refuses the live endpoint outside production (no live credentials, ever)", () => {
    vi.stubEnv("EXPEDIA_API_KEY", "k");
    vi.stubEnv("EXPEDIA_SHARED_SECRET", "s");
    vi.stubEnv("EXPEDIA_BASE_URL", "https://api.ean.com/v3");
    vi.stubEnv("APP_ENV", "staging");
    expect(() => readExpediaConfig()).toThrow(/test\.ean\.com/);
  });

  it("in production accepts only Expedia's two endpoints", () => {
    vi.stubEnv("EXPEDIA_API_KEY", "k");
    vi.stubEnv("EXPEDIA_SHARED_SECRET", "s");
    vi.stubEnv("APP_ENV", "production");
    vi.stubEnv("EXPEDIA_BASE_URL", "https://api.ean.com/v3");
    expect(readExpediaConfig()).toMatchObject({ baseUrl: "https://api.ean.com/v3", production: true });
    vi.stubEnv("EXPEDIA_BASE_URL", "https://evil.example/v3");
    expect(() => readExpediaConfig()).toThrow();
  });

  it("names a missing variable without printing any value", () => {
    vi.stubEnv("EXPEDIA_API_KEY", "");
    vi.stubEnv("EXPEDIA_SHARED_SECRET", "secret-value");
    expect(() => readExpediaConfig()).toThrow("EXPEDIA_API_KEY is not set");
    try {
      readExpediaConfig();
    } catch (error) {
      expect(String(error)).not.toContain("secret-value");
    }
  });
});
