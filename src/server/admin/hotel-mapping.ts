import { z } from "zod";
import type { Prisma, SupplierHotelMapStatus } from "@/generated/prisma/client";
import { audit } from "@/server/audit";
import { db } from "@/server/db";

// The admin's hotel mapping list for the second supplier (owner decision 2026-11-23): "this
// Expedia property is this supplier-layer hotel id". Nothing is searched with Hotelbeds unless
// an admin approved its link: an added link starts PROPOSED; approve makes it live, reject takes
// it offline, remove deletes it. Every change is one transaction with an audit row. The callers
// are server actions that ran requireAdmin() (TOTP included) and pass the admin's user id.
//
// Candidate suggestions by name and location are not offered: the supplier layer gives its
// hotels as ids only (no names or coordinates), so there is nothing to compare without a new call.

const SUPPLIER = "hotelbeds";
const PAGE_SIZE = 50;
export const MAPPING_NOTE_MAX = 300;
// The layer's own hotel ids: what its API accepts as a hotel id (text, at most 100 characters),
// kept to letters, digits, "-" and "_".
const LAYER_HOTEL_ID = /^[A-Za-z0-9_-]{1,100}$/;
const PROPERTY_ID = /^[A-Za-z0-9_-]{1,64}$/;

// The hotels the supplier layer maps today (keys of its config/mappings/hotelbeds.json, as
// deployed on 2026-11-23): the page shows which of them still have no link here.
export const LAYER_MAPPED_HOTEL_IDS = ["59", "60", "24", "156", "21", "91", "72", "73", "89", "32", "23", "31", "66", "177"] as const;

function cleanNote(raw: string): string {
  return raw.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
}

const proposeInput = z
  .object({
    propertyId: z.string().regex(PROPERTY_ID),
    layerHotelId: z.string().trim().regex(LAYER_HOTEL_ID),
    note: z.string().max(MAPPING_NOTE_MAX * 2).transform(cleanNote).pipe(z.string().max(MAPPING_NOTE_MAX)),
  })
  .strict();

export type HotelMappingRow = {
  id: string;
  propertyId: string;
  propertyName: string;
  propertyPlace: string;
  layerHotelId: string;
  status: SupplierHotelMapStatus;
  note: string;
  createdBy: string;
  createdAt: Date;
  approvedBy: string | null;
  approvedAt: Date | null;
};

export async function listHotelMappings(opts: { status?: SupplierHotelMapStatus; cursor?: string } = {}): Promise<{ rows: HotelMappingRow[]; nextCursor: string | null }> {
  const cursor = opts.cursor && /^[a-z0-9]{1,40}$/.test(opts.cursor) ? opts.cursor : undefined;
  const found = await db.supplierHotelMap.findMany({
    where: { supplier: SUPPLIER, ...(opts.status ? { status: opts.status } : {}) },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: PAGE_SIZE + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    include: { property: { select: { name: true, city: true, countryCode: true } }, createdBy: { select: { email: true } }, approvedBy: { select: { email: true } } },
  });
  const page = found.slice(0, PAGE_SIZE);
  return {
    rows: page.map((row) => ({
      id: row.id,
      propertyId: row.propertyId,
      propertyName: row.property.name,
      propertyPlace: [row.property.city, row.property.countryCode].filter(Boolean).join(", "),
      layerHotelId: row.layerHotelId,
      status: row.status,
      note: row.note,
      createdBy: row.createdBy.email,
      createdAt: row.createdAt,
      approvedBy: row.approvedBy?.email ?? null,
      approvedAt: row.approvedAt,
    })),
    nextCursor: found.length > PAGE_SIZE ? (page[page.length - 1]?.id ?? null) : null,
  };
}

// Which of the layer's mapped hotels have no link here yet (any status counts as a link).
export async function unlinkedLayerHotels(): Promise<string[]> {
  const linked = await db.supplierHotelMap.findMany({ where: { supplier: SUPPLIER, layerHotelId: { in: [...LAYER_MAPPED_HOTEL_IDS] } }, select: { layerHotelId: true } });
  const taken = new Set(linked.map((row) => row.layerHotelId));
  return LAYER_MAPPED_HOTEL_IDS.filter((id) => !taken.has(id));
}

export type ProposeOutcome = "added" | "invalid" | "property_not_found" | "property_linked" | "layer_hotel_linked";

// "Add a link": a new PROPOSED link. One link per property and one per layer hotel.
export async function proposeHotelMapping(adminId: string, raw: { propertyId: unknown; layerHotelId: unknown; note: unknown }): Promise<ProposeOutcome> {
  const parsed = proposeInput.safeParse(raw);
  if (!parsed.success) return "invalid";
  const { propertyId, layerHotelId, note } = parsed.data;
  try {
    return await db.$transaction(async (tx) => {
      const property = await tx.property.findUnique({ where: { id: propertyId }, select: { id: true } });
      if (!property) return "property_not_found" as const;
      if (await tx.supplierHotelMap.findUnique({ where: { supplier_propertyId: { supplier: SUPPLIER, propertyId } }, select: { id: true } })) return "property_linked" as const;
      if (await tx.supplierHotelMap.findUnique({ where: { supplier_layerHotelId: { supplier: SUPPLIER, layerHotelId } }, select: { id: true } })) return "layer_hotel_linked" as const;
      const created = await tx.supplierHotelMap.create({ data: { supplier: SUPPLIER, propertyId, layerHotelId, note, createdById: adminId }, select: { id: true } });
      await audit(adminId, "hotel-mapping.propose", "SupplierHotelMap", created.id, undefined, { propertyId, layerHotelId, status: "PROPOSED" }, tx);
      return "added" as const;
    });
  } catch (error) {
    // Added at the same moment by another admin: the unique index decides.
    if ((error as { code?: string }).code === "P2002") return "property_linked";
    throw error;
  }
}

export type DecideOutcome = "approved" | "rejected" | "unchanged" | "not_found";

// Approve (the link goes live: searched from the next search) or reject (never searched).
export async function decideHotelMapping(adminId: string, mappingId: string, decision: "approve" | "reject", now: Date = new Date()): Promise<DecideOutcome> {
  if (typeof mappingId !== "string" || mappingId.length > 40) return "not_found";
  const to: SupplierHotelMapStatus = decision === "approve" ? "APPROVED" : "REJECTED";
  return db.$transaction(async (tx) => {
    const [row] = await tx.$queryRaw<{ id: string; status: SupplierHotelMapStatus }[]>`
      SELECT "id", "status" FROM "SupplierHotelMap" WHERE "id" = ${mappingId} AND "supplier" = ${SUPPLIER} FOR UPDATE`;
    if (!row) return "not_found" as const;
    if (row.status === to) return "unchanged" as const;
    const data: Prisma.SupplierHotelMapUpdateInput = to === "APPROVED" ? { status: to, approvedBy: { connect: { id: adminId } }, approvedAt: now } : { status: to, approvedBy: { disconnect: true }, approvedAt: null };
    await tx.supplierHotelMap.update({ where: { id: row.id }, data });
    await audit(adminId, `hotel-mapping.${decision}`, "SupplierHotelMap", row.id, { status: row.status }, { status: to }, tx);
    return decision === "approve" ? ("approved" as const) : ("rejected" as const);
  });
}

// Removes a link (whatever its status): the property is no longer searched with Hotelbeds.
export async function removeHotelMapping(adminId: string, mappingId: string): Promise<"removed" | "not_found"> {
  if (typeof mappingId !== "string" || mappingId.length > 40) return "not_found";
  return db.$transaction(async (tx) => {
    const row = await tx.supplierHotelMap.findFirst({ where: { id: mappingId, supplier: SUPPLIER }, select: { id: true, propertyId: true, layerHotelId: true, status: true } });
    if (!row) return "not_found" as const;
    const removed = await tx.supplierHotelMap.deleteMany({ where: { id: row.id } });
    if (removed.count === 0) return "not_found" as const;
    await audit(adminId, "hotel-mapping.remove", "SupplierHotelMap", row.id, { propertyId: row.propertyId, layerHotelId: row.layerHotelId, status: row.status }, undefined, tx);
    return "removed" as const;
  });
}
