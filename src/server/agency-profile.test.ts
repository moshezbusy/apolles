import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { createUser } from "@/server/users";
import { resetTestDb } from "@/test/db";
import { bombPng, corruptIdatPng, makeJpeg, makePng, pngChunk } from "@/test/png";
import {
  LOGO_MAX_BYTES,
  getAgencyLogo,
  getAgencyProfile,
  removeAgencyLogo,
  setAgencyLogo,
  updateAgencyProfile,
} from "@/server/agency-profile";

// A complete, valid PNG (1-bit grey, so even large sizes stay small). `extra` bytes of text
// chunk make the file bigger without changing the picture.
function png(width: number, height: number, extra = 0): Uint8Array {
  return makePng(width, height, { colorType: 0, bitDepth: 1, ...(extra > 0 ? { before: [pngChunk("tEXt", Buffer.alloc(extra, 0x61))] } : {}) });
}

// Only the first 33 bytes of a PNG: what the upload check accepted before it read whole files.
function headerOnlyPng(width: number, height: number): Uint8Array {
  return Uint8Array.from(png(width, height).subarray(0, 33));
}

const valid = { name: "Sunrise Travel Ltd", email: "Office@Sunrise.example", phone: "+972 50-123-4567", country: "IL" };

let agencyA: string;
let agencyB: string;
let agentA: string;

async function newAgency(name: string, ref: string): Promise<string> {
  return (await db.agency.create({ data: { name, country: "IL", bankReference: ref } })).id;
}

describe("agency profile", () => {
  beforeEach(async () => {
    await resetTestDb();
    agencyA = await newAgency("Sunrise Travel", "APL-0001");
    agencyB = await newAgency("Other Agency", "APL-0002");
    agentA = (await createUser({ email: "a@sunrise.example", name: "Dana", role: "AGENT", agencyId: agencyA })).id;
  });

  describe("updateAgencyProfile", () => {
    it("saves the four fields (email lowercased) and audits before/after", async () => {
      await updateAgencyProfile(agentA, agencyA, valid);
      expect(await getAgencyProfile(agencyA)).toMatchObject({
        name: "Sunrise Travel Ltd",
        email: "office@sunrise.example",
        phone: "+972 50-123-4567",
        country: "IL",
        hasLogo: false,
      });
      const rows = await db.auditLog.findMany({ where: { action: "agency.profile.update" } });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ actorUserId: agentA, targetType: "Agency", targetId: agencyA });
      expect(rows[0]?.before).toMatchObject({ name: "Sunrise Travel", email: null, phone: null, country: "IL" });
      expect(rows[0]?.after).toMatchObject({ name: "Sunrise Travel Ltd", email: "office@sunrise.example" });
    });

    it("never touches another agency", async () => {
      await updateAgencyProfile(agentA, agencyA, valid);
      expect(await getAgencyProfile(agencyB)).toMatchObject({ name: "Other Agency", email: null, phone: null });
    });

    it.each([
      ["short name", { ...valid, name: "A" }],
      ["bad email", { ...valid, email: "not-an-email" }],
      ["phone with letters", { ...valid, phone: "+972 50 CALL ME" }],
      ["phone too short", { ...valid, phone: "12345" }],
      ["phone too long", { ...valid, phone: "+1 234 567 890 123 456" }],
      ["unknown country", { ...valid, country: "XX" }],
      ["unknown field", { ...valid, agencyId: agencyB }],
      ["right-to-left override in name", { ...valid, name: "Sunrise \u202Elevart" }],
      ["NUL in name", { ...valid, name: "Sunrise\u0000Travel" }],
      ["newline in phone", { ...valid, phone: "+972 50\n123 4567" }],
      ["tab in phone", { ...valid, phone: "+972\t501234567" }],
    ])("rejects %s and changes nothing", async (_label, input) => {
      await expect(updateAgencyProfile(agentA, agencyA, input as typeof valid)).rejects.toThrow();
      expect(await getAgencyProfile(agencyA)).toMatchObject({ name: "Sunrise Travel", email: null });
      expect(await db.auditLog.count()).toBe(0);
    });
  });

  describe("logo", () => {
    it("stores a valid PNG with its hash and audits without the bytes", async () => {
      const bytes = png(600, 200);
      expect(await setAgencyLogo(agentA, agencyA, bytes)).toEqual({ ok: true });
      const logo = await getAgencyLogo(agencyA);
      expect(logo).toMatchObject({ mimeType: "image/png", width: 600, height: 200, sizeBytes: bytes.length });
      expect(logo?.sha256).toBe(createHash("sha256").update(bytes).digest("hex"));
      expect(Buffer.from(logo?.data ?? []).equals(Buffer.from(bytes))).toBe(true);
      expect((await getAgencyProfile(agencyA))?.hasLogo).toBe(true);

      const row = await db.auditLog.findFirstOrThrow({ where: { action: "agency.logo.set" } });
      expect(row.after).toEqual({ sha256: logo?.sha256, sizeBytes: bytes.length, width: 600, height: 200, mimeType: "image/png" });
    });

    it("replaces the logo on a second upload (one row per agency)", async () => {
      await setAgencyLogo(agentA, agencyA, png(600, 200));
      await setAgencyLogo(agentA, agencyA, png(900, 300));
      expect(await db.agencyLogo.count()).toBe(1);
      expect(await getAgencyLogo(agencyA)).toMatchObject({ width: 900 });
    });

    it.each([
      ["SVG", new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'><script>x</script></svg>")],
      ["too narrow (under 300px)", png(200, 200)],
      ["too wide (over 2000px)", png(2001, 300)],
      ["too many pixels (over 2 million)", png(2000, 1001)],
      ["a header with no picture behind it", headerOnlyPng(600, 200)],
      ["a zlib bomb (300 MB of pixels in a 300 KB file)", bombPng(600, 200, 300_000_000)],
      ["a corrupt pixel stream", corruptIdatPng(600, 200)],
      ["an interlaced PNG", makePng(600, 200, { interlace: 1 })],
      ["a JPEG cut short", makeJpeg(600, 200).subarray(0, 60)],
      ["too many bytes", png(600, 200, LOGO_MAX_BYTES)],
      ["empty", new Uint8Array()],
    ])("rejects %s and stores nothing", async (_label, bytes) => {
      const result = await setAgencyLogo(agentA, agencyA, bytes);
      expect(result.ok).toBe(false);
      expect(await db.agencyLogo.count()).toBe(0);
      expect(await db.auditLog.count()).toBe(0);
    });

    it("stores a complete JPEG, and a PNG at the edge of the pixel budget", async () => {
      expect(await setAgencyLogo(agentA, agencyA, makeJpeg(600, 200))).toEqual({ ok: true });
      expect(await getAgencyLogo(agencyA)).toMatchObject({ mimeType: "image/jpeg", width: 600, height: 200 });
      expect(await setAgencyLogo(agentA, agencyA, png(2000, 1000))).toEqual({ ok: true });
    });

    it("says what to do when the file is damaged or too large in pixels", async () => {
      const damaged = await setAgencyLogo(agentA, agencyA, corruptIdatPng(600, 200));
      expect(damaged).toEqual({ ok: false, error: "This image file is damaged or in a format we cannot print. Save it again as a standard PNG or JPEG and upload it." });
      const large = await setAgencyLogo(agentA, agencyA, png(2000, 1001));
      expect(large).toEqual({ ok: false, error: "The image is 2000×1001px, which is too large. Use an image of at most 2000px per side and 2 million pixels in total (for example 2000×1000px)." });
    });

    it("a logo is read only for its own agency", async () => {
      await setAgencyLogo(agentA, agencyA, png(600, 200));
      expect(await getAgencyLogo(agencyB)).toBeNull();
    });

    it("remove deletes it and audits; removing nothing is a no-op", async () => {
      await setAgencyLogo(agentA, agencyA, png(600, 200));
      await removeAgencyLogo(agentA, agencyA);
      expect(await getAgencyLogo(agencyA)).toBeNull();
      expect(await db.auditLog.count({ where: { action: "agency.logo.remove" } })).toBe(1);
      await removeAgencyLogo(agentA, agencyA);
      expect(await db.auditLog.count({ where: { action: "agency.logo.remove" } })).toBe(1);
    });
  });
});
