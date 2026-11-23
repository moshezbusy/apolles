import { type StoredGuest, guestLines, oneRoomConfirmation, roomGuestLines, roomHeading } from "@/lib/guests";
import PDFDocument from "pdfkit";
import { validateImage } from "@/lib/image-info";
import { formatMinor } from "@/lib/supplier-money";
import { toBlocks } from "@/lib/supplier-text";
import { withPdfTimeout } from "@/server/booking/pdf-safety";
import { hasNoCancelDeadline } from "@/lib/cancellation";
import { freeCancelText } from "./free-cancel";
import { db } from "@/server/db";
import { contentShape } from "@/server/content/content-cache";
import type { CancelPenalty, PriceBreakdown, PropertyContent } from "@/server/supplier/types";

// The voucher PDF (spec section 3 row 10; AP3, BP4, ER2, ER4): in English, in the agency's
// name and branding, for the agent to give the traveller. It holds what the hotel and the
// guest need; never the price paid, the supplier's name or its itinerary number. Only for the
// agency's own confirmed booking. Supplier text is drawn as plain text (toBlocks). A booking of
// several rooms (plan 10) is one voucher with a block per room: its guests and its own hotel
// confirmation (each room has one, TR6).
//
// The built-in PDF fonts cover Latin script only: other characters are shown as "?" rather
// than as broken glyphs.

export class VoucherNotAvailable extends Error {}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const INK = "#1d2420";
const MUTED = "#5f6863";
const BRAND = "#173f35";

function latin(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\u0009\u000a -~ -ÿ€]/g, "?");
}

function longDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${MONTHS[Number(m) - 1] ?? m} ${Number(d)}, ${y}`;
}

// "2027-04-07T00:00:00.000+02:00" → "Apr 7, 2027, 00:00 (UTC+02:00)", the property's local time.
function propertyTime(value: string): string {
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?(Z|[+-]\d{2}:\d{2})?$/);
  if (!m) return value;
  return `${longDate(`${m[1]}-${m[2]}-${m[3]}`)}, ${m[4]}:${m[5]} (${!m[6] || m[6] === "Z" ? "UTC" : `UTC${m[6]}`})`;
}

function penaltyLine(p: CancelPenalty): string {
  const charge = p.amount ? formatMinor(p.amount.minor, p.amount.currency) : p.percent ? `${p.percent} of the total` : p.nights !== null ? `${p.nights} night(s)` : "a fee";
  return `From ${propertyTime(p.start)} to ${propertyTime(p.end)}: cancellation charge ${charge}.`;
}

const DUE_LABEL: Record<string, string> = { mandatory_fee: "Mandatory fee", resort_fee: "Resort fee", mandatory_tax: "Mandatory tax" };

export async function renderVoucher(agencyId: string, bookingId: string): Promise<Buffer> {
  if (typeof bookingId !== "string" || bookingId.length > 64) throw new VoucherNotAvailable();
  const b = await db.booking.findFirst({ where: { id: bookingId, agencyId, status: "CONFIRMED" } });
  if (!b) throw new VoucherNotAvailable();
  const [agency, logo, cached, rooms] = await Promise.all([
    db.agency.findUniqueOrThrow({ where: { id: agencyId }, select: { name: true, email: true, phone: true } }),
    db.agencyLogo.findUnique({ where: { agencyId }, select: { data: true } }),
    db.propertyContentCache.findUnique({ where: { propertyId: b.propertyId }, select: { data: true } }),
    db.bookingRoom.findMany({ where: { bookingId: b.id }, orderBy: { index: "asc" }, select: { index: true, adults: true, childAges: true, guests: true, hotelConfirmationId: true } }),
  ]);
  const severalRooms = rooms.length > 1;
  // Hotel content from the cache only: printing a voucher never calls the supplier.
  const parsed = cached ? contentShape.safeParse(cached.data) : null;
  const content: PropertyContent | null = parsed?.success ? parsed.data : null;
  const price = b.price as unknown as PriceBreakdown;
  const guests = guestLines(b.guests as StoredGuest[], b.adults, b.childAges);

  const doc = new PDFDocument({ size: "A4", margin: 48, info: { Title: `Voucher ${b.reference}`, Author: latin(agency.name) } });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
  const width = doc.page.width - 96;
  const heading = (text: string) => {
    doc.moveDown(0.8).font("Helvetica-Bold").fontSize(11).fillColor(BRAND).text(latin(text), { width });
    doc.moveDown(0.2).font("Helvetica").fontSize(9.5).fillColor(INK);
  };
  const line = (text: string, opts: { muted?: boolean; bold?: boolean } = {}) => {
    doc.font(opts.bold ? "Helvetica-Bold" : "Helvetica").fontSize(9.5).fillColor(opts.muted ? MUTED : INK).text(latin(text), { width });
  };
  // A block of `lines` lines starts on a new page when it would not fit on this one, so a room's
  // heading, guests and confirmation are never split over two pages (up to 8 rooms).
  const keepTogether = (lines: number) => {
    doc.font("Helvetica").fontSize(9.5);
    if (doc.y + lines * doc.currentLineHeight(true) + 12 > doc.page.height - doc.page.margins.bottom) doc.addPage();
  };
  const supplierText = (html: string | null | undefined) => {
    for (const block of toBlocks(html)) line(block.kind === "li" ? `- ${block.text}` : block.text);
  };

  // Agency header (ER2: the traveller's contact is the agency). The stored logo is checked in
  // full again right here (validateImage): pdfkit decodes a PNG with transparency in memory and
  // inside a callback, where a crafted file exhausts the server and a damaged one leaves the PDF
  // unfinished for good. Uploads are checked too, but a row stored before that check must not be
  // trusted. A logo that fails is left out; the agency name still shows.
  if (logo) {
    const image = Buffer.from(logo.data);
    try {
      if (validateImage(image)) doc.image(image, 48, 40, { fit: [150, 50] });
    } catch {
      // a logo pdfkit cannot read is left out; the agency name still shows
    }
  }
  doc.font("Helvetica-Bold").fontSize(14).fillColor(INK).text(latin(agency.name), 260, 44, { width: doc.page.width - 308, align: "right" });
  doc.font("Helvetica").fontSize(9).fillColor(MUTED).text(latin([agency.email, agency.phone].filter(Boolean).join("  |  ")), { width: doc.page.width - 308, align: "right" });
  doc.x = 48;
  doc.y = 110;

  doc.font("Helvetica-Bold").fontSize(20).fillColor(INK).text("Hotel voucher", { width });
  doc.moveDown(0.3);
  line(`Booking reference: ${b.reference}`, { bold: true });
  if (severalRooms) line(`Hotel confirmation numbers: one for each room, under "Rooms and guests"`, { bold: true });
  else line(`Hotel confirmation number: ${oneRoomConfirmation(b, rooms) ?? "to be confirmed by the hotel"}`, { bold: true });
  line(`Status: Confirmed · Paid${b.confirmedAt ? `   Issued: ${longDate(b.confirmedAt.toISOString().slice(0, 10))}` : ""}`);
  // Screen 21: the hotel must not charge the guest for the room (paid in advance to the supplier).
  line("The room is paid in advance. Do not charge the guest for it. Only the fees under \"To pay at the property\" are paid by the guest.", { bold: true });

  heading("Hotel");
  line(b.hotelName, { bold: true });
  if (content) line([content.address.line1, content.address.city, content.address.postalCode, content.address.countryCode].filter(Boolean).join(", "));
  else line(b.hotelCity);

  heading("Stay");
  line(`Check-in: ${longDate(b.checkin)}${content?.checkin.beginTime ? `, from ${content.checkin.beginTime}${content.checkin.endTime ? ` to ${content.checkin.endTime}` : ""}` : ""}`);
  line(`Check-out: ${longDate(b.checkout)}${content?.checkout.time ? `, by ${content.checkout.time}` : ""}`);
  line(severalRooms ? `Rooms: ${rooms.length} x ${b.roomName}` : `Room: ${b.roomName}`);
  if (b.amenities.length > 0) line(`Rate includes: ${b.amenities.join(", ")}`);
  line(`Bed type: ${b.bedDescription}`);
  line("Bed type is a request and not guaranteed.", { muted: true });

  if (severalRooms) {
    // Each room's own guests: children are matched to their ages within their room.
    const blocks = rooms.map((room) => ({ title: roomHeading(room.index, room), guests: roomGuestLines(room), confirmation: room.hotelConfirmationId }));
    keepTogether(blocks[0]!.guests.length + 5); // the heading stays with the first room
    heading("Rooms and guests");
    for (const block of blocks) {
      keepTogether(block.guests.length + 2);
      line(block.title, { bold: true });
      for (const g of block.guests) line(g);
      line(`Hotel confirmation number: ${block.confirmation ?? "to be confirmed by the hotel"}`);
      doc.moveDown(0.4);
    }
  } else {
    heading("Guests");
    for (const g of guests) line(g);
  }
  line(`Lead guest contact: ${b.leadEmail}, ${b.leadPhone}`, { muted: true });
  if (b.specialRequest) {
    heading("Special requests");
    line(b.specialRequest);
    line("Sent to the hotel. Requests are not guaranteed.", { muted: true });
  }

  if (price.dueAtProperty.length > 0) {
    heading("To pay at the property");
    for (const fee of price.dueAtProperty) {
      const amount = fee.localAmount ? `${formatMinor(fee.localAmount.minor, fee.localAmount.currency)} (about ${formatMinor(fee.amount.minor, fee.amount.currency)})` : formatMinor(fee.amount.minor, fee.amount.currency);
      line(`${DUE_LABEL[fee.kind] ?? "Fee"}: ${amount}`);
    }
  }

  if (content) {
    if (content.checkin.instructions || content.checkin.specialInstructions || content.checkin.minAge) {
      heading("Check-in instructions");
      if (content.checkin.minAge) line(`Minimum check-in age: ${content.checkin.minAge}`);
      supplierText(content.checkin.instructions);
      supplierText(content.checkin.specialInstructions);
    }
    if (content.fees.mandatory || content.fees.optional) {
      heading("Fees");
      supplierText(content.fees.mandatory);
      supplierText(content.fees.optional);
    }
    if (content.knowBeforeYouGo) {
      heading("Know before you go");
      supplierText(content.knowBeforeYouGo);
    }
  }

  heading("Cancellation policy");
  const penalties = b.cancelPenalties as unknown as CancelPenalty[];
  if (!b.refundable) line("Non-refundable: this booking cannot be cancelled or changed without paying the full amount.");
  for (const p of penalties) line(penaltyLine(p));
  for (const r of b.nonrefundableDateRanges as unknown as { start: string; end: string }[]) line(`Non-refundable for stay dates ${r.start} to ${r.end}.`);
  // The one free-cancellation wording (free-cancel.ts); a refundable rate with no charge listed
  // names no deadline, so nothing is promised.
  const free = freeCancelText(b, new Date());
  if (free) line(`${free}.`);
  else if (hasNoCancelDeadline({ refundable: b.refundable, cancelPenalties: penalties, nonrefundableDateRanges: b.nonrefundableDateRanges as unknown[] })) {
    line("No free cancellation deadline was given for this rate. Cancellation charges may apply.");
  }
  line("Times are the hotel's local time. To cancel or change, contact the travel agency above.", { muted: true });

  doc.end();
  return withPdfTimeout(done);
}
