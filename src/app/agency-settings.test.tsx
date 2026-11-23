import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Header } from "@/components/Header";
import { requireAgent } from "@/server/auth/guards";
import { getAgencyProfile, setAgencyLogo } from "@/server/agency-profile";
import { db } from "@/server/db";
import { createUser } from "@/server/users";
import { resetTestDb } from "@/test/db";
import { makePng } from "@/test/png";

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }));
vi.mock("@/server/auth/guards", () => ({ requireAgent: vi.fn() }));
vi.mock("@/server/auth/password-tokens", () => ({ requestResetWithinLimits: vi.fn(async () => {}) }));

const png = (width: number, height: number): Uint8Array => makePng(width, height);

function form(fields: Record<string, string | Blob>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

let agencyA: string;
let agencyB: string;
let agentA: string;

function signInAs(agencyId: string, userId = agentA): void {
  vi.mocked(requireAgent).mockResolvedValue({ userId, agencyId });
}

describe("agency settings", () => {
  beforeEach(async () => {
    await resetTestDb();
    vi.mocked(requireAgent).mockReset();
    agencyA = (await db.agency.create({ data: { name: "Sunrise Travel", country: "IL", bankReference: "APL-0001" } })).id;
    agencyB = (await db.agency.create({ data: { name: "Other Agency", country: "US", bankReference: "APL-0002" } })).id;
    agentA = (await createUser({ email: "a@sunrise.example", name: "Dana", role: "AGENT", agencyId: agencyA })).id;
    signInAs(agencyA);
  });

  describe("/settings page", () => {
    it("checks the agent session and shows the agency's saved details", async () => {
      await db.agency.update({ where: { id: agencyA }, data: { email: "office@sunrise.example", phone: "+972 50 123 4567" } });
      const { default: Page } = await import("./(agent)/settings/page");
      const html = renderToStaticMarkup(await Page());
      expect(requireAgent).toHaveBeenCalledTimes(1);
      expect(html).toContain('value="Sunrise Travel"');
      expect(html).toContain('value="office@sunrise.example"');
      expect(html).toContain('value="+972 50 123 4567"');
      expect(html).toContain("PNG or JPEG, at least 300px wide, up to 500 KB.");
      expect(html).not.toContain("Other Agency");
    });

    // The country is the point of sale sent to the hotel supplier and the name is the legal
    // name on vouchers: an agent can read them but not change them.
    it("shows the agency name and country read-only, with who to ask for a change", async () => {
      const { default: Page } = await import("./(agent)/settings/page");
      const html = renderToStaticMarkup(await Page());
      expect(html).toMatch(/<input[^>]*readOnly=""[^>]*value="Sunrise Travel"|<input[^>]*value="Sunrise Travel"[^>]*readOnly=""/);
      expect(html).toMatch(/<input[^>]*readOnly=""[^>]*value="Israel"|<input[^>]*value="Israel"[^>]*readOnly=""/);
      expect(html).toContain("Contact Apolles to change the agency name or country.");
      expect(html).not.toContain('name="name"');
      expect(html).not.toContain('name="country"');
      expect(html).not.toContain("<select");
      // Email and phone stay editable.
      expect(html).toContain('name="email"');
      expect(html).toContain('name="phone"');
    });

    it("an unknown stored country code is shown as it is", async () => {
      await db.agency.update({ where: { id: agencyA }, data: { country: "UK" } });
      const { default: Page } = await import("./(agent)/settings/page");
      const html = renderToStaticMarkup(await Page());
      expect(html).toMatch(/<input[^>]*value="UK"/);
    });

    it("shows the logo from /settings/logo once there is one", async () => {
      await setAgencyLogo(agentA, agencyA, png(600, 200));
      const { default: Page } = await import("./(agent)/settings/page");
      const html = renderToStaticMarkup(await Page());
      expect(html).toMatch(/<img[^>]*src="\/settings\/logo\?v=[0-9a-f]{12}"/);
      expect(html).toContain("Remove logo");
    });
  });

  describe("actions", () => {
    it("saves the email and phone of the session's agency, ignoring any agencyId in the form", async () => {
      const { updateProfileAction } = await import("./(agent)/settings/actions");
      const state = await updateProfileAction(null, form({ email: "a@b.example", phone: "+972501234567", agencyId: agencyB }));
      expect(state).toEqual({ status: "success", message: "Changes saved." });
      expect(await getAgencyProfile(agencyA)).toMatchObject({ name: "Sunrise Travel", email: "a@b.example", phone: "+972501234567", country: "IL" });
      expect(await getAgencyProfile(agencyB)).toMatchObject({ name: "Other Agency", email: null });
    });

    it("an agent cannot change the agency name or country, even by posting them by hand", async () => {
      const { updateProfileAction } = await import("./(agent)/settings/actions");
      const state = await updateProfileAction(null, form({ name: "Renamed Ltd", country: "US", email: "a@b.example", phone: "+972501234567" }));
      expect(state).toEqual({ status: "success", message: "Changes saved." });
      expect(await getAgencyProfile(agencyA)).toMatchObject({ name: "Sunrise Travel", country: "IL", email: "a@b.example" });
      const row = await db.auditLog.findFirstOrThrow({ where: { action: "agency.profile.update" } });
      expect(JSON.stringify(row)).not.toContain("Renamed");
    });

    it("returns an error and saves nothing on invalid input", async () => {
      const { updateProfileAction } = await import("./(agent)/settings/actions");
      const state = await updateProfileAction(null, form({ email: "x", phone: "1" }));
      expect(state).toMatchObject({ status: "error", message: "Check the form: a valid business email and a phone number with 7 to 15 digits." });
      // What the agent typed comes back, so the form can show it again instead of resetting.
      expect(state && "values" in state ? state.values : null).toEqual({ email: "x", phone: "1" });
      expect(await getAgencyProfile(agencyA)).toMatchObject({ name: "Sunrise Travel", email: null });
    });

    it("uploads a logo for the session's agency and refuses an SVG", async () => {
      const { uploadLogoAction } = await import("./(agent)/settings/actions");
      const ok = await uploadLogoAction(null, form({ logo: new Blob([Uint8Array.from(png(600, 200))], { type: "image/png" }) }));
      expect(ok).toEqual({ status: "success", message: "Logo saved." });
      expect(await db.agencyLogo.count({ where: { agencyId: agencyA } })).toBe(1);

      const svg = new Blob(["<svg xmlns='http://www.w3.org/2000/svg'/>"], { type: "image/png" });
      const bad = await uploadLogoAction(null, form({ logo: svg }));
      expect(bad?.status).toBe("error");
    });

    it("no agent session → redirect to /login, nothing saved", async () => {
      vi.mocked(requireAgent).mockRejectedValue(new Error("NEXT_REDIRECT:/login"));
      const { updateProfileAction } = await import("./(agent)/settings/actions");
      await expect(
        updateProfileAction(null, form({ email: "a@b.example", phone: "+972501234567" })),
      ).rejects.toThrow("NEXT_REDIRECT:/login");
      expect(await getAgencyProfile(agencyA)).toMatchObject({ name: "Sunrise Travel", email: null });
    });
  });

  describe("GET /settings/logo", () => {
    it("404 when the agency has no logo", async () => {
      const { GET } = await import("./(agent)/settings/logo/route");
      expect((await GET(new Request("http://x/settings/logo"))).status).toBe(404);
    });

    it("serves the session agency's logo with safe headers", async () => {
      const bytes = png(600, 200);
      await setAgencyLogo(agentA, agencyA, bytes);
      const { GET } = await import("./(agent)/settings/logo/route");
      const res = await GET(new Request("http://x/settings/logo"));
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("image/png");
      expect(res.headers.get("x-content-type-options")).toBe("nosniff");
      expect(res.headers.get("content-security-policy")).toBe("default-src 'none'; sandbox");
      expect(res.headers.get("cache-control")).toBe("private, no-cache");
      expect(res.headers.get("etag")).toMatch(/^"[0-9a-f]{64}"$/);
      expect(Buffer.from(await res.arrayBuffer()).equals(Buffer.from(bytes))).toBe(true);
    });

    it("never serves another agency's logo", async () => {
      await setAgencyLogo(agentA, agencyA, png(600, 200));
      signInAs(agencyB, "someone-else");
      const { GET } = await import("./(agent)/settings/logo/route");
      expect((await GET(new Request("http://x/settings/logo"))).status).toBe(404);
    });

    it("lets the browser keep the logo when the URL names its exact version", async () => {
      await setAgencyLogo(agentA, agencyA, png(600, 200));
      const sha = (await db.agencyLogo.findUniqueOrThrow({ where: { agencyId: agencyA } })).sha256;
      const { GET } = await import("./(agent)/settings/logo/route");
      const current = await GET(new Request(`http://x/settings/logo?v=${sha.slice(0, 12)}`));
      expect(current.headers.get("cache-control")).toBe("private, max-age=31536000, immutable");
      const stale = await GET(new Request("http://x/settings/logo?v=000000000000"));
      expect(stale.headers.get("cache-control")).toBe("private, no-cache");
    });
  });

  describe("tabs (screen 20)", () => {
    async function tab(name: string): Promise<string> {
      const { default: Page } = await import("./(agent)/settings/page");
      return renderToStaticMarkup(await Page({ searchParams: Promise.resolve({ tab: name }) }));
    }

    it("shows the five tabs; an unknown tab shows the profile", async () => {
      const html = await tab("nope");
      for (const label of ["Agency profile", "Quote branding", "Preferences", "Balance &amp; top-ups", "Account"]) expect(html).toContain(label);
      expect(html).toContain('value="Sunrise Travel"');
    });

    it("quote branding saves for the session's agency, and the preview uses it", async () => {
      const { updateBrandingAction } = await import("./(agent)/settings/actions");
      const result = await updateBrandingAction(null, form({ displayName: "Sunrise Trips", advisorName: "Dana Cohen", contactPhone: "", advisorEmail: "", defaultLanguage: "HE", brandColor: "#21436b", defaultMessage: "Hi!", agencyId: agencyB }));
      expect(result).toEqual({ status: "success", message: "Changes saved." });
      expect(await db.agency.findUniqueOrThrow({ where: { id: agencyA } })).toMatchObject({ quoteDisplayName: "Sunrise Trips", quoteBrandColor: "#21436b", defaultQuoteLanguage: "HE" });
      expect(await db.agency.findUniqueOrThrow({ where: { id: agencyB } })).toMatchObject({ quoteDisplayName: null });
      const html = await tab("branding");
      expect(html).toContain('value="Sunrise Trips"');
      expect(html).toContain("background-color:#21436b");
      const bad = await updateBrandingAction(null, form({ displayName: "x", advisorName: "", contactPhone: "", advisorEmail: "", defaultLanguage: "EN", brandColor: "red", defaultMessage: "" }));
      expect(bad).toMatchObject({ status: "error", values: { brandColor: "red" } });
    });

    it("preferences: the default markup and cancellation terms", async () => {
      const { updateDefaultsAction } = await import("./(agent)/settings/actions");
      expect(await updateDefaultsAction(null, form({ markupType: "FIXED", markupValue: "35.5", validDays: "10" }))).toEqual({ status: "success", message: "Changes saved." });
      expect(await db.agency.findUniqueOrThrow({ where: { id: agencyA } })).toMatchObject({ defaultMarkupType: "FIXED", defaultMarkupValue: 3550, defaultShowCancellation: false, quoteValidDays: 10 });
      const html = await tab("preferences");
      expect(html).toContain('value="35.5"');
      // "Offer valid for (days)": shown with its saved value; out of range is refused and what was typed is kept.
      expect(html).toContain("Offer valid for (days)");
      expect(html).toContain('name="validDays"');
      expect(await updateDefaultsAction(null, form({ markupType: "FIXED", markupValue: "35.5", validDays: "45" }))).toMatchObject({ status: "error", values: { validDays: "45" } });
      expect(await db.agency.findUniqueOrThrow({ where: { id: agencyA } })).toMatchObject({ quoteValidDays: 10 });
    });

    it("balance: the balance, the bank details and the agency's reference; no card payment", async () => {
      vi.stubEnv("BANK_DETAILS_BENEFICIARY", "Apolles Ltd");
      const html = await tab("balance");
      vi.unstubAllEnvs();
      expect(html).toContain("USD 0.00");
      expect(html).toContain("APL-0001");
      expect(html).toContain('href="/balance"');
      expect(html).not.toMatch(/card/i);
    });

    it("account: the agent's name and login email, change password and sign out", async () => {
      const html = await tab("account");
      expect(html).toContain("a@sunrise.example");
      expect(html).toContain("Change password");
      expect(html).toContain('action="/logout"');
      const { changePasswordAction } = await import("./(agent)/settings/actions");
      const { requestResetWithinLimits } = await import("@/server/auth/password-tokens");
      expect(await changePasswordAction()).toMatchObject({ status: "success" });
      expect(vi.mocked(requestResetWithinLimits)).toHaveBeenCalledWith("a@sunrise.example", expect.any(String));
    });
  });

  it("the agent area has an error page with a way back (e.g. an upload over the 1 MB limit)", async () => {
    const { default: AgentError } = await import("./(agent)/error");
    const html = renderToStaticMarkup(<AgentError error={new Error("x")} reset={() => {}} />);
    expect(html).toContain("Something went wrong");
    expect(html).toContain("Try again");
    expect(html).not.toContain("x</");
  });

  it("the header's agency menu links to Agency settings", () => {
    const html = renderToStaticMarkup(<Header agencyName="Sunrise Travel" balanceCents={0} />);
    expect(html).toMatch(/<a[^>]*href="\/settings"[^>]*>Agency settings<\/a>/);
  });
});
