import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DemoBanner } from "./DemoBanner";

vi.mock("next/server", () => ({ connection: vi.fn(async () => undefined) }));

describe("DemoBanner", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("says the data is sample data while the fake supplier is on", async () => {
    vi.stubEnv("SUPPLIER_MODE", "fake");
    vi.stubEnv("APP_ENV", "staging");
    expect(renderToStaticMarkup(await DemoBanner())).toContain("Demo mode");
  });

  it("shows nothing with the real supplier", async () => {
    vi.stubEnv("SUPPLIER_MODE", "");
    expect(await DemoBanner()).toBeNull();
  });
});
