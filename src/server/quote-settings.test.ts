import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { getQuoteSettings, updateQuoteBranding, updateQuoteDefaults } from "@/server/quote-settings";
import { createQuote } from "@/server/quotes/quotes";
import { resetTestDb } from "@/test/db";

const BRANDING = {
  displayName: "Sunrise Trips",
  advisorName: "Dana Cohen",
  contactPhone: "+972 50 555 0100",
  advisorEmail: "Dana@Sunrise.example",
  defaultLanguage: "HE",
  brandColor: "#1F5E4A",
  defaultMessage: "Need help choosing?\r\nMessage me on WhatsApp.",
};

beforeEach(async () => {
  await resetTestDb();
  for (const id of ["A", "B"]) {
    await db.agency.create({ data: { id, name: `Agency ${id}`, country: "IL", bankReference: `APL-${id}` } });
    await db.user.create({ data: { id: `u-${id}`, email: `${id}@test.local`, name: id, role: "AGENT", agencyId: id } });
  }
});

describe("quote branding and defaults (screen 20)", () => {
  it("starts empty: the agency's own name and phone are used", async () => {
    expect(await getQuoteSettings("A")).toEqual({
      displayName: "",
      advisorName: "",
      contactPhone: "",
      advisorEmail: "",
      defaultLanguage: "EN",
      brandColor: "",
      defaultMessage: "",
      defaultMarkupType: "PERCENT",
      defaultMarkupValue: 0,
      defaultShowCancellation: true,
    });
  });

  it("saves the branding for the agency only, cleaned, with an audit row", async () => {
    expect(await updateQuoteBranding("u-A", "A", BRANDING)).toEqual({ ok: true });
    expect(await getQuoteSettings("A")).toMatchObject({
      displayName: "Sunrise Trips",
      advisorEmail: "dana@sunrise.example",
      brandColor: "#1f5e4a",
      defaultLanguage: "HE",
      defaultMessage: "Need help choosing?\nMessage me on WhatsApp.",
    });
    expect(await getQuoteSettings("B")).toMatchObject({ displayName: "", brandColor: "" });
    expect(await db.auditLog.count({ where: { action: "agency.quote-branding.update", targetId: "A" } })).toBe(1);
  });

  it("refuses unsafe or wrong values: a color that is not #rrggbb, control characters, a bad email, unknown fields", async () => {
    for (const bad of [
      { ...BRANDING, brandColor: "red;background:url(x)" },
      { ...BRANDING, brandColor: "#12345" },
      { ...BRANDING, displayName: "Sun‮rise" },
      { ...BRANDING, advisorEmail: "not-an-email" },
      { ...BRANDING, contactPhone: "call me" },
      { ...BRANDING, defaultLanguage: "FR" },
      { ...BRANDING, extra: "x" },
    ]) {
      expect(await updateQuoteBranding("u-A", "A", bad as never)).toEqual({ ok: false, error: expect.any(String) });
    }
    expect(await getQuoteSettings("A")).toMatchObject({ displayName: "" });
  });

  it("empty fields go back to the agency's own details", async () => {
    await updateQuoteBranding("u-A", "A", BRANDING);
    await updateQuoteBranding("u-A", "A", { displayName: "", advisorName: "", contactPhone: "", advisorEmail: "", defaultLanguage: "EN", brandColor: "", defaultMessage: "" });
    const agency = await db.agency.findUniqueOrThrow({ where: { id: "A" } });
    expect(agency).toMatchObject({ quoteDisplayName: null, quoteBrandColor: null, quoteAdvisorEmail: null });
  });

  it("defaults: a percent or a fixed USD markup, and the cancellation terms", async () => {
    expect(await updateQuoteDefaults("u-A", "A", { markupType: "PERCENT", markupValue: "12.5", showCancellation: false })).toEqual({ ok: true });
    expect(await getQuoteSettings("A")).toMatchObject({ defaultMarkupType: "PERCENT", defaultMarkupValue: 1250, defaultShowCancellation: false });
    expect(await updateQuoteDefaults("u-A", "A", { markupType: "FIXED", markupValue: "40", showCancellation: true })).toEqual({ ok: true });
    expect(await getQuoteSettings("A")).toMatchObject({ defaultMarkupType: "FIXED", defaultMarkupValue: 4000 });
    expect((await updateQuoteDefaults("u-A", "A", { markupType: "PERCENT", markupValue: "101", showCancellation: true })).ok).toBe(false);
    expect((await updateQuoteDefaults("u-A", "A", { markupType: "OTHER", markupValue: "1", showCancellation: true })).ok).toBe(false);
  });

  it("a new quote starts with the agency's defaults", async () => {
    await updateQuoteBranding("u-A", "A", { ...BRANDING });
    await updateQuoteDefaults("u-A", "A", { markupType: "FIXED", markupValue: "25", showCancellation: false });
    const created = await createQuote("u-A", "A");
    if (!created.ok) throw new Error(created.error);
    expect(await db.quote.findUniqueOrThrow({ where: { id: created.id } })).toMatchObject({
      language: "HE",
      message: "Need help choosing?\nMessage me on WhatsApp.",
      markupType: "FIXED",
      markupValue: 2500,
      showCancellation: false,
    });
  });
});
