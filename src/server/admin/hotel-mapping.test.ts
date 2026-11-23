import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { requireAdmin } from "@/server/auth/guards";
import { db } from "@/server/db";
import { HotelbedsLayer, approvedLinks } from "@/server/supplier/hotelbeds-layer/adapter";
import { resetTestDb } from "@/test/db";
import { decideHotelMapping, listHotelMappings, proposeHotelMapping, removeHotelMapping, unlinkedLayerHotels } from "./hotel-mapping";

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/server/auth/guards", () => ({ requireAdmin: vi.fn() }));
vi.mock("@/server/admin/header", () => ({ countsForAdminHeader: async () => null }));

const STAGING = { APP_ENV: "staging", SUPPLIER_LAYER_URL: "http://apolles-suppliers:8080", SUPPLIER_LAYER_API_KEY: "k".repeat(32) };
const QUERY = { propertyIds: ["11"], checkin: "2027-04-10", checkout: "2027-04-12", occupancies: [{ adults: 2, childAges: [] }], countryCode: "IL" };

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

describe("hotel mapping (admin-approved list)", () => {
  beforeEach(async () => {
    await resetTestDb();
    vi.mocked(requireAdmin).mockResolvedValue({ userId: "admin" });
    await db.user.create({ data: { id: "admin", email: "admin@test.local", name: "Admin", role: "ADMIN" } });
    for (const id of ["11", "12"]) await db.property.create({ data: { id, name: `Hotel ${id}`, city: "Paris", countryCode: "FR", rank: 1, expediaCollect: true, active: true, catalogSeenRunId: "r" } });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("only an approved link is searched: proposed and rejected ones never reach the supplier layer", async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ offers: [], suppliers: [], unmappedHotelIds: [] }), { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    const layer = new HotelbedsLayer({ env: STAGING });
    expect(await proposeHotelMapping("admin", { propertyId: "11", layerHotelId: "59", note: "Same address" })).toBe("added");
    const [link] = (await listHotelMappings()).rows;
    expect(link).toMatchObject({ propertyId: "11", propertyName: "Hotel 11", layerHotelId: "59", status: "PROPOSED", note: "Same address", createdBy: "admin@test.local", approvedBy: null });
    expect(await approvedLinks(["11"])).toEqual(new Map());
    await layer.searchAvailability(QUERY);
    expect(fetch).not.toHaveBeenCalled();

    expect(await decideHotelMapping("admin", link!.id, "approve", new Date("2027-03-01T10:00:00Z"))).toBe("approved");
    expect(await approvedLinks(["11", "12"])).toEqual(new Map([["11", "59"]]));
    await layer.searchAvailability(QUERY);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect((await listHotelMappings({ status: "APPROVED" })).rows[0]).toMatchObject({ approvedBy: "admin@test.local", approvedAt: new Date("2027-03-01T10:00:00Z") });

    expect(await decideHotelMapping("admin", link!.id, "reject")).toBe("rejected");
    expect(await approvedLinks(["11"])).toEqual(new Map());
    expect((await listHotelMappings()).rows[0]).toMatchObject({ status: "REJECTED", approvedBy: null, approvedAt: null });
    expect(await decideHotelMapping("admin", link!.id, "reject")).toBe("unchanged");

    expect(await removeHotelMapping("admin", link!.id)).toBe("removed");
    expect(await removeHotelMapping("admin", link!.id)).toBe("not_found");
    expect((await db.auditLog.findMany({ where: { targetType: "SupplierHotelMap" }, orderBy: { createdAt: "asc" } })).map((a) => a.action)).toEqual([
      "hotel-mapping.propose",
      "hotel-mapping.approve",
      "hotel-mapping.reject",
      "hotel-mapping.remove",
    ]);
  });

  it("one link per hotel and per layer hotel id; unknown hotels and bad ids are refused; the page lists the layer's hotels still without a link", async () => {
    expect(await proposeHotelMapping("admin", { propertyId: "11", layerHotelId: "59", note: "" })).toBe("added");
    expect(await proposeHotelMapping("admin", { propertyId: "11", layerHotelId: "60", note: "" })).toBe("property_linked");
    expect(await proposeHotelMapping("admin", { propertyId: "12", layerHotelId: "59", note: "" })).toBe("layer_hotel_linked");
    expect(await proposeHotelMapping("admin", { propertyId: "99", layerHotelId: "60", note: "" })).toBe("property_not_found");
    for (const layerHotelId of ["", "59 60", "x".repeat(101), "<b>"]) expect(await proposeHotelMapping("admin", { propertyId: "12", layerHotelId, note: "" }), layerHotelId).toBe("invalid");
    expect(await proposeHotelMapping("admin", { propertyId: "12", layerHotelId: "60", note: "n".repeat(301) })).toBe("invalid");
    expect(await unlinkedLayerHotels()).toEqual(["60", "24", "156", "21", "91", "72", "73", "89", "32", "23", "31", "66", "177"]);
    expect(await decideHotelMapping("admin", "nope", "approve")).toBe("not_found");
  });

  it("the actions check the admin first: a caller who is not a signed-in admin with the second step changes nothing (no IDOR)", async () => {
    await proposeHotelMapping("admin", { propertyId: "11", layerHotelId: "59", note: "" });
    const [link] = (await listHotelMappings()).rows;
    const { decideMappingAction, proposeMappingAction, removeMappingAction } = await import("@/app/admin/hotel-mapping/actions");
    vi.mocked(requireAdmin).mockRejectedValue(new Error("NEXT_REDIRECT:/login"));
    await expect(proposeMappingAction(null, form({ propertyId: "12", layerHotelId: "60", note: "" }))).rejects.toThrow("NEXT_REDIRECT");
    await expect(decideMappingAction(null, form({ mappingId: link!.id, decision: "approve" }))).rejects.toThrow("NEXT_REDIRECT");
    await expect(removeMappingAction(null, form({ mappingId: link!.id, confirm: "yes" }))).rejects.toThrow("NEXT_REDIRECT");
    expect(await db.supplierHotelMap.findMany({ select: { propertyId: true, status: true } })).toEqual([{ propertyId: "11", status: "PROPOSED" }]);
    expect(await db.auditLog.count({ where: { action: { not: "hotel-mapping.propose" } } })).toBe(0);

    // As the admin: remove needs the confirmation box; approve works.
    vi.mocked(requireAdmin).mockResolvedValue({ userId: "admin" });
    expect(await removeMappingAction(null, form({ mappingId: link!.id }))).toMatchObject({ status: "error" });
    expect(await decideMappingAction(null, form({ mappingId: link!.id, decision: "approve" }))).toMatchObject({ status: "success" });
    expect(await proposeMappingAction(null, form({ propertyId: "12", layerHotelId: "59", note: "" }))).toMatchObject({ status: "error", message: expect.stringContaining("already linked") });
    expect(await removeMappingAction(null, form({ mappingId: link!.id, confirm: "yes" }))).toMatchObject({ status: "success" });
    expect(await db.supplierHotelMap.count()).toBe(0);
  });

  it("the page lists the links with their status and tools", async () => {
    await proposeHotelMapping("admin", { propertyId: "11", layerHotelId: "59", note: "Checked the address" });
    const { default: Page } = await import("@/app/admin/hotel-mapping/page");
    const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({}) }));
    expect(html).toContain("Hotel mapping");
    expect(html).toContain("Hotel 11");
    expect(html).toContain("supplier layer id 59");
    expect(html).toContain("Proposed");
    expect(html).toContain("Checked the address");
    for (const button of ["Approve link", "Reject link", "Remove link", "Search hotels"]) expect(html).toContain(`>${button}</button>`);
    expect(html).toContain("Supplier layer hotel ids with no link yet: 60, 24");
    vi.mocked(requireAdmin).mockRejectedValue(new Error("NEXT_REDIRECT:/login"));
    await expect(Page({ searchParams: Promise.resolve({}) })).rejects.toThrow("NEXT_REDIRECT");
  });
});
