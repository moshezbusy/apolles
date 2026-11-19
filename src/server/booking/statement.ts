import PDFDocument from "pdfkit";
import { oneRoomConfirmation, roomHeading } from "@/lib/guests";
import { formatUsd } from "@/lib/money";
import { formatMinor } from "@/lib/supplier-money";
import { db } from "@/server/db";
import type { PriceBreakdown } from "@/server/supplier/types";

// The booking statement (mockup 22, owner decision 18.11.2026): a PDF from Apolles to the agency
// with what was paid from its balance for one booking, and after a cancellation what was charged
// and refunded. It is NOT a tax invoice (the agency's tax invoice comes from Apolles' accounting).
// For the agency only (never the client): it shows the net price. A booking of several rooms
// (plan 10) has a line per room with its price; the totals stay the booking's own.

export class StatementNotAvailable extends Error {}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const INK = "#1d2420";
const MUTED = "#5f6863";
const BRAND = "#173f35";

function latin(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\u0009\u000a -~ -ÿ€]/g, "?");
}

function day(value: Date | string): string {
  const iso = typeof value === "string" ? value : value.toISOString().slice(0, 10);
  const [y, m, d] = iso.split("-");
  return `${MONTHS[Number(m) - 1] ?? m} ${Number(d)}, ${y}`;
}

export async function renderStatement(agencyId: string, bookingId: string): Promise<Buffer> {
  if (typeof bookingId !== "string" || bookingId.length > 64) throw new StatementNotAvailable();
  const b = await db.booking.findFirst({
    where: { id: bookingId, agencyId, status: { in: ["CONFIRMED", "CANCEL_PENDING", "CANCELLED", "CANCELLED_BY_SUPPLIER"] }, chargedMinor: { not: null } },
  });
  if (!b) throw new StatementNotAvailable();
  const [agency, rooms] = await Promise.all([
    db.agency.findUniqueOrThrow({ where: { id: agencyId }, select: { name: true, bankReference: true, country: true } }),
    db.bookingRoom.findMany({
      where: { bookingId: b.id },
      orderBy: { index: "asc" },
      select: { index: true, adults: true, childAges: true, givenName: true, familyName: true, totalMinor: true, hotelConfirmationId: true, status: true },
    }),
  ]);
  const cancelled = b.status === "CANCELLED" || b.status === "CANCELLED_BY_SUPPLIER";
  const price = b.price as unknown as PriceBreakdown;

  const doc = new PDFDocument({ size: "A4", margin: 48, info: { Title: `Statement ${b.reference}`, Author: "Apolles" } });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
  const width = doc.page.width - 96;
  const heading = (text: string) => {
    doc.moveDown(0.8).font("Helvetica-Bold").fontSize(11).fillColor(BRAND).text(latin(text), { width });
    doc.moveDown(0.2);
  };
  const line = (text: string, opts: { muted?: boolean; bold?: boolean } = {}) => {
    doc.font(opts.bold ? "Helvetica-Bold" : "Helvetica").fontSize(9.5).fillColor(opts.muted ? MUTED : INK).text(latin(text), { width });
  };

  doc.font("Helvetica-Bold").fontSize(20).fillColor(INK).text("Apolles", { width });
  doc.moveDown(0.6);
  doc.font("Helvetica-Bold").fontSize(16).fillColor(INK).text(cancelled ? "Cancellation statement" : "Booking statement", { width });
  line(`Statement ${cancelled ? "CS" : "ST"}-${b.reference.replace(/^APL-/, "")}   Issued ${day(cancelled && b.cancelledAt ? b.cancelledAt : (b.confirmedAt ?? b.createdAt))}`);
  line("This is not a tax invoice.", { bold: true });

  heading("Billed to");
  line(agency.name, { bold: true });
  line(`Agency reference: ${agency.bankReference}   Country: ${agency.country}`);

  heading("Booking");
  line(`Apolles reference: ${b.reference}`, { bold: true });
  const confirmation = rooms.length > 1 ? null : oneRoomConfirmation(b, rooms);
  if (confirmation) line(`Hotel confirmation: ${confirmation}`);
  line(`${b.hotelName}, ${b.hotelCity}`);
  line(`${day(b.checkin)} to ${day(b.checkout)} · ${b.roomName}`);
  line(`Lead guest: ${b.leadGivenName} ${b.leadFamilyName}`);
  if (rooms.length > 1) {
    heading("Rooms");
    for (const room of rooms) {
      const extra = [room.hotelConfirmationId ? `hotel confirmation ${room.hotelConfirmationId}` : null, room.status === "CANCELLED" ? "Cancelled" : null].filter(Boolean);
      line(`${roomHeading(room.index, room)} · ${room.givenName} ${room.familyName}: ${formatUsd(room.totalMinor)}${extra.length ? ` · ${extra.join(" · ")}` : ""}`);
    }
  }

  heading("Payment");
  const paid = b.chargedMinor ?? b.totalMinor;
  line(`Paid from your Apolles balance: ${formatUsd(paid)}${b.confirmedAt ? ` on ${day(b.confirmedAt)}` : ""}`, { bold: true });
  if (cancelled && b.refundMinor !== null) {
    // The charge is what was kept, so the lines always add up to what was paid.
    line(`Cancellation charge: ${formatUsd(paid - b.refundMinor)}`);
    line(`Refunded to your balance: ${formatUsd(b.refundMinor)}${b.cancelledAt ? ` on ${day(b.cancelledAt)}` : ""}`, { bold: true });
  } else if (cancelled) {
    line("Cancelled by the hotel. Apolles support handles the refund; it shows in your balance once done.", { muted: true });
  } else if (b.status === "CANCEL_PENDING") {
    line("A cancellation is waiting for the hotel to confirm. The refund follows.", { muted: true });
  }
  if (price?.dueAtPropertyTotal) {
    line(`Not included: ${formatMinor(price.dueAtPropertyTotal.minor, price.dueAtPropertyTotal.currency)} paid by the guest at the hotel (taxes and fees).`, { muted: true });
  }

  doc.moveDown(1.2);
  line("Amounts in USD. Bookings are paid from the agency's prepaid Apolles balance. The tax invoice is issued separately.", { muted: true });
  doc.end();
  return done;
}
