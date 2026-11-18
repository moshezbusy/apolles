import { z } from "zod";
import type { BookingStatus } from "@/generated/prisma/client";
import { audit } from "@/server/audit";
import { db } from "@/server/db";
import { parseMarkup, sellingMinor } from "@/server/quotes/pricing";

// The agency's own selling price of a booking (plan 6, screens 11 and 12), for its reports only.
// It never changes what Apolles charges and is never on the voucher. It is a markup on the
// charged total (the supplier's price, checked at booking), so it follows a price change.

const CANCELLED: BookingStatus[] = ["CANCELLED", "CANCELLED_BY_SUPPLIER"];

export type Sale = { netMinor: number; saleMinor: number; profitMinor: number; priced: boolean };

export function bookingSale(b: {
  status: BookingStatus;
  totalMinor: number;
  chargedMinor: number | null;
  sellMarkupType: "PERCENT" | "FIXED" | null;
  sellMarkupValue: number | null;
}): Sale {
  const priced = b.sellMarkupType !== null && b.sellMarkupValue !== null;
  if (CANCELLED.includes(b.status)) return { netMinor: 0, saleMinor: 0, profitMinor: 0, priced };
  const netMinor = b.chargedMinor ?? b.totalMinor;
  if (!priced) return { netMinor, saleMinor: netMinor, profitMinor: 0, priced };
  const saleMinor = sellingMinor({ netMinor, sellMinor: null }, { markupType: b.sellMarkupType!, markupValue: b.sellMarkupValue! });
  return { netMinor, saleMinor, profitMinor: saleMinor - netMinor, priced };
}

const input = z.object({ markupType: z.string().max(10), markupValue: z.string().max(20) }).strict();

export type SellResult = { ok: true } | { ok: false; error: string };

// "" as the type clears the selling price.
export async function setSellingPrice(actorUserId: string, agencyId: string, bookingId: string, raw: z.input<typeof input>): Promise<SellResult> {
  const parsed = input.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Enter a markup." };
  const clear = parsed.data.markupType === "";
  const markup = clear ? null : parseMarkup(parsed.data.markupType, parsed.data.markupValue);
  if (!clear && !markup) return { ok: false, error: "Enter a markup of 0 to 100% or a fixed USD amount up to 10,000, with up to 2 decimals." };
  if (typeof bookingId !== "string" || bookingId.length > 64) return { ok: false, error: "This booking was not found." };
  const data = { sellMarkupType: markup?.markupType ?? null, sellMarkupValue: markup?.markupValue ?? null };
  const done = await db.$transaction(async (tx) => {
    const updated = await tx.booking.updateMany({ where: { id: bookingId, agencyId, status: { not: "EXPIRED" } }, data });
    if (updated.count === 0) return false;
    await audit(actorUserId, "booking.selling-price", "Booking", bookingId, undefined, data, tx);
    return true;
  });
  return done ? { ok: true } : { ok: false, error: "This booking was not found." };
}
