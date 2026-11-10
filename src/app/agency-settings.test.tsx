import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Header } from "@/components/Header";
import { requireAgent } from "@/server/auth/guards";
import { getAgencyProfile, setAgencyLogo } from "@/server/agency-profile";
import { db } from "@/server/db";
import { createUser } from "@/server/users";
import { resetTestDb } from "@/test/db";

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/server/auth/guards", () => ({ requireAgent: vi.fn() }));

function png(width: number, height: number): Uint8Array {
  const b = new Uint8Array(33);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52], 0);
  new DataView(b.buffer).setUint32(16, width);
  new DataView(b.buffer).setUint32(20, height);
  return b;
}

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
      expect(html).toMatch(/<option value="IL" selected="">Israel<\/option>/);
      expect(html).toContain("PNG or JPEG, at least 300px wide, up to 500 KB.");
      expect(html).not.toContain("Other Agency");
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
    it("saves the profile of the session's agency, ignoring any agencyId in the form", async () => {
      const { updateProfileAction } = await import("./(agent)/settings/actions");
      const state = await updateProfileAction(
        null,
        form({ name: "Sunrise Ltd", email: "a@b.example", phone: "+972501234567", country: "IL", agencyId: agencyB }),
      );
      expect(state).toEqual({ status: "success", message: "Changes saved." });
      expect(await getAgencyProfile(agencyA)).toMatchObject({ name: "Sunrise Ltd", email: "a@b.example" });
      expect(await getAgencyProfile(agencyB)).toMatchObject({ name: "Other Agency", email: null });
    });

    it("returns an error and saves nothing on invalid input", async () => {
      const { updateProfileAction } = await import("./(agent)/settings/actions");
      const state = await updateProfileAction(null, form({ name: "S", email: "x", phone: "1", country: "XX" }));
      expect(state?.status).toBe("error");
      expect(await getAgencyProfile(agencyA)).toMatchObject({ name: "Sunrise Travel" });
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
        updateProfileAction(null, form({ name: "Hacked", email: "a@b.example", phone: "+972501234567", country: "IL" })),
      ).rejects.toThrow("NEXT_REDIRECT:/login");
      expect(await getAgencyProfile(agencyA)).toMatchObject({ name: "Sunrise Travel" });
    });
  });

  describe("GET /settings/logo", () => {
    it("404 when the agency has no logo", async () => {
      const { GET } = await import("./(agent)/settings/logo/route");
      expect((await GET()).status).toBe(404);
    });

    it("serves the session agency's logo with safe headers", async () => {
      const bytes = png(600, 200);
      await setAgencyLogo(agentA, agencyA, bytes);
      const { GET } = await import("./(agent)/settings/logo/route");
      const res = await GET();
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
      expect((await GET()).status).toBe(404);
    });
  });

  it("the header's agency menu links to Agency settings", () => {
    const html = renderToStaticMarkup(<Header agencyName="Sunrise Travel" balanceCents={0} />);
    expect(html).toMatch(/<a[^>]*href="\/settings"[^>]*>Agency settings<\/a>/);
  });
});
