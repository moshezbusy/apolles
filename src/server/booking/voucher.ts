import PDFDocument from "pdfkit";
import { formatMinor } from "@/lib/supplier-money";
import { toBlocks } from "@/lib/supplier-text";
import { db } from "@/server/db";
import { contentShape } from "@/server/content/content-cache";
import type { CancelPenalty, PriceBreakdown, PropertyContent } from "@/server/supplier/types";

// The voucher PDF (spec section 3 row 10; AP3, BP4, ER2, ER4): in English, in the agency's
// name and branding, for the agent to give the traveller. It holds what the hotel and the
// guest need; never the price paid, the supplier's name or its itinerary number. Only for the
// agency's own confirmed booking. Supplier text is drawn as plain text (toBlocks).
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
  const [agency, logo, cached] = await Promise.all([
    db.agency.findUniqueOrThrow({ where: { id: agencyId }, select: { name: true, email: true, phone: true } }),
    db.agencyLogo.findUnique({ where: { agencyId }, select: { data: true } }),
    db.propertyContentCache.findUnique({ where: { propertyId: b.propertyId }, select: { data: true } }),
  ]);
  // Hotel content from the cache only: printing a voucher never calls the supplier.
  const parsed = cached ? contentShape.safeParse(cached.data) : null;
  const content: PropertyContent | null = parsed?.success ? parsed.data : null;
  const price = b.price as unknown as PriceBreakdown;
  const guests = (b.guests as { givenName: string; familyName: string }[]).map((g, i) =>
    i < b.adults ? `${g.givenName} ${g.familyName}` : `${g.givenName} ${g.familyName} (child, age ${b.childAges[i - b.adults] ?? "?"})`,
  );

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
  const supplierText = (html: string | null | undefined) => {
    for (const block of toBlocks(html)) line(block.kind === "li" ? `- ${block.text}` : block.text);
  };

  // Agency header (ER2: the traveller's contact is the agency).
  if (logo) {
    try {
      doc.image(Buffer.from(logo.data), 48, 40, { fit: [150, 50] });
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
  line(`Hotel confirmation number: ${b.hotelConfirmationId ?? "to be confirmed by the hotel"}`, { bold: true });

  heading("Hotel");
  line(b.hotelName, { bold: true });
  if (content) line([content.address.line1, content.address.city, content.address.postalCode, content.address.countryCode].filter(Boolean).join(", "));
  else line(b.hotelCity);

  heading("Stay");
  line(`Check-in: ${longDate(b.checkin)}${content?.checkin.beginTime ? `, from ${content.checkin.beginTime}${content.checkin.endTime ? ` to ${content.checkin.endTime}` : ""}` : ""}`);
  line(`Check-out: ${longDate(b.checkout)}${content?.checkout.time ? `, by ${content.checkout.time}` : ""}`);
  line(`Room: ${b.roomName}`);
  line(`Bed type: ${b.bedDescription}`);
  line("Bed type is a request and not guaranteed.", { muted: true });

  heading("Guests");
  for (const g of guests) line(g);
  line(`Lead guest contact: ${b.leadEmail}, ${b.leadPhone}`, { muted: true });

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
  if (b.refundable && penalties.length === 0) line("Free cancellation before check-in.");
  line("Times are the hotel's local time. To cancel or change, contact the travel agency above.", { muted: true });

  doc.end();
  return done;
}
