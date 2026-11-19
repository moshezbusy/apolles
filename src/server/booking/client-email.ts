import { z } from "zod";
import { type StoredGuest, guestLines, oneRoomConfirmation, roomGuestLines, roomHeading } from "@/lib/guests";
import { formatMinor } from "@/lib/supplier-money";
import { audit } from "@/server/audit";
import { renderVoucher } from "@/server/booking/voucher";
import { db } from "@/server/db";
import { sendEmail } from "@/server/email/port";
import { hitRateLimit } from "@/server/rate-limit";
import type { PriceBreakdown } from "@/server/supplier/types";

// Plan 8g (mockups 12, 23 #12): the agent emails the client the hotel voucher, in the agency's
// name. Only the agency's own confirmed booking. The email holds what the voucher holds for the
// guest and never a price (not the net price, not the selling price), the supplier or Apolles.
// A booking of several rooms (plan 10) lists each room with its guests and hotel confirmation.

const input = z
  .object({
    bookingId: z.string().min(1).max(64),
    email: z.string().trim().toLowerCase().max(254).pipe(z.email()),
  })
  .strict();

const AGENCY_LIMIT = { limit: 30, windowMs: 60 * 60_000 };
const AGENCY_DAY_LIMIT = { limit: 100, windowMs: 24 * 60 * 60_000 };
const BOOKING_LIMIT = { limit: 5, windowMs: 24 * 60 * 60_000 };
const LIMITED = "Too many client emails for now. Try again later.";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DUE_LABEL: Record<string, { en: string; he: string }> = {
  mandatory_fee: { en: "Mandatory fee", he: "עמלת חובה" },
  resort_fee: { en: "Resort fee", he: "דמי נופש" },
  mandatory_tax: { en: "Mandatory tax", he: "מס חובה" },
};

function enDay(iso: string, withYear: boolean): string {
  const [y, m, d] = iso.split("-");
  return `${MONTHS[Number(m) - 1] ?? m} ${Number(d)}${withYear ? `, ${y}` : ""}`;
}

function heDay(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y}`;
}

const NOT_AVAILABLE = "The booking can be emailed once the hotel has confirmed it.";

type Result = { ok: true } | { ok: false; error: string };

// The address box starts with the quote's client email, when the booking came from a quote.
export async function clientEmailDefault(agencyId: string, bookingId: string): Promise<string> {
  if (typeof bookingId !== "string" || bookingId.length > 64) return "";
  const b = await db.booking.findFirst({ where: { id: bookingId, agencyId }, select: { quote: { select: { client: { select: { email: true } } } } } });
  return b?.quote?.client?.email ?? "";
}

export async function emailBookingToClient(actorUserId: string, agencyId: string, raw: z.input<typeof input>): Promise<Result> {
  const parsed = input.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Enter one valid email address." };
  const { bookingId, email } = parsed.data;
  const b = await db.booking.findFirst({
    where: { id: bookingId, agencyId, status: "CONFIRMED" },
    include: {
      agency: { select: { name: true, email: true, quoteDisplayName: true, quoteAdvisorEmail: true } },
      user: { select: { email: true } },
      quote: { select: { language: true } },
      rooms: { orderBy: { index: "asc" }, select: { index: true, adults: true, childAges: true, guests: true, hotelConfirmationId: true } },
    },
  });
  if (!b) return { ok: false, error: NOT_AVAILABLE };
  // The booking's own limit first, so a refused resend does not use the agency's slots.
  if (!(await hitRateLimit(`booking-email:booking:${b.id}`, BOOKING_LIMIT.limit, BOOKING_LIMIT.windowMs)).allowed) {
    return { ok: false, error: "This booking was emailed several times today. Try again later." };
  }
  if (!(await hitRateLimit(`booking-email:agency:${agencyId}`, AGENCY_LIMIT.limit, AGENCY_LIMIT.windowMs)).allowed) return { ok: false, error: LIMITED };
  if (!(await hitRateLimit(`booking-email:agency-day:${agencyId}`, AGENCY_DAY_LIMIT.limit, AGENCY_DAY_LIMIT.windowMs)).allowed) return { ok: false, error: LIMITED };

  const he = b.quote?.language === "HE";
  const displayName = b.agency.quoteDisplayName ?? b.agency.name;
  const replyTo = b.agency.quoteAdvisorEmail ?? b.agency.email ?? b.user.email;
  const price = b.price as unknown as PriceBreakdown;
  const guests = guestLines(b.guests as StoredGuest[], b.adults, b.childAges);
  const rooms = b.rooms;
  const severalRooms = rooms.length > 1;
  const confirmation = oneRoomConfirmation(b, rooms);
  // Each room's own guests (children matched to their ages within their room) and confirmation.
  const roomBlocks = (title: (room: (typeof rooms)[number]) => string, confirmationLine: (id: string | null) => string) =>
    rooms.flatMap((room) => [title(room), ...roomGuestLines(room).map((g) => `- ${g}`), confirmationLine(room.hotelConfirmationId), ""]);
  const dueLines = (price?.dueAtProperty ?? []).map((d) => {
    const label = DUE_LABEL[d.kind]?.[he ? "he" : "en"] ?? d.kind;
    const local = d.localAmount && d.localAmount.currency !== d.amount.currency ? ` (${formatMinor(d.localAmount.minor, d.localAmount.currency)})` : "";
    return `- ${label}: ${formatMinor(d.amount.minor, d.amount.currency)}${local}`;
  });
  const dates = he ? `${heDay(b.checkin)} עד ${heDay(b.checkout)}` : `${enDay(b.checkin, false)} to ${enDay(b.checkout, true)}`;
  // Supplier text in a header: one line, no control or invisible characters.
  const hotel = b.hotelName.replace(/[\p{Cc}\p{Cf}]/gu, " ").replace(/\s+/g, " ").trim().slice(0, 120);
  const subject = he ? `ההזמנה שלכם במלון: ${hotel}, ${dates}` : `Your hotel booking: ${hotel}, ${dates}`;
  const lines = he
    ? [
        "שלום,",
        "",
        "מצורף שובר המלון להזמנה שלכם. יש להציג אותו בקבלה.",
        "",
        `מלון: ${b.hotelName}, ${b.hotelCity}`,
        `תאריכים: ${dates}`,
        `${severalRooms ? `חדרים: ${rooms.length} x ${b.roomName}` : `חדר: ${b.roomName}`} (${b.bedDescription}; סוג המיטה הוא בקשה ואינו מובטח)`,
        ...(b.amenities.length ? [`התעריף כולל: ${b.amenities.join(", ")}`] : []),
        `מספר הזמנה: ${b.reference}`,
        ...(severalRooms
          ? ["", ...roomBlocks((room) => `חדר ${room.index + 1}:`, (id) => `מספר אישור במלון: ${id ?? "יימסר על ידי המלון"}`)]
          : [`מספר אישור במלון: ${confirmation ?? "יימסר על ידי המלון"}`, "", "אורחים:", ...guests.map((g) => `- ${g}`), ""]),
        ...(dueLines.length ? ["לתשלום במלון (אינו כלול במחיר החדר):", ...dueLines, ""] : []),
        "שעות הצ'ק-אין והצ'ק-אאוט ופרטי המלון נמצאים בשובר המצורף.",
        "",
        displayName,
      ]
    : [
        "Hello,",
        "",
        "Your hotel voucher is attached. Please show it at the front desk.",
        "",
        `Hotel: ${b.hotelName}, ${b.hotelCity}`,
        `Dates: ${dates}`,
        `${severalRooms ? `Rooms: ${rooms.length} x ${b.roomName}` : `Room: ${b.roomName}`} (${b.bedDescription}; the bed type is a request and not guaranteed)`,
        ...(b.amenities.length ? [`Rate includes: ${b.amenities.join(", ")}`] : []),
        `Booking reference: ${b.reference}`,
        ...(severalRooms
          ? ["", ...roomBlocks((room) => `${roomHeading(room.index, room)}:`, (id) => `Hotel confirmation number: ${id ?? "to be confirmed by the hotel"}`)]
          : [`Hotel confirmation number: ${confirmation ?? "to be confirmed by the hotel"}`, "", "Guests:", ...guests.map((g) => `- ${g}`), ""]),
        ...(dueLines.length ? ["To pay at the property (not included in the room price):", ...dueLines, ""] : []),
        "Check-in and check-out times and the hotel's details are in the attached voucher.",
        "",
        displayName,
      ];

  try {
    const pdf = await renderVoucher(agencyId, b.id);
    await sendEmail({
      to: email,
      subject,
      text: lines.join("\n"),
      fromName: displayName,
      replyTo,
      attachments: [{ name: `hotel-voucher-${b.reference.replace(/[^A-Za-z0-9-]/g, "")}.pdf`, contentType: "application/pdf", content: pdf }],
    });
  } catch (error) {
    // By error name only: never the address, the guests or the body.
    console.error("client booking email failed", { error: error instanceof Error ? error.name : "Error", bookingId: b.id });
    return { ok: false, error: "The email could not be sent right now. Try again in a few minutes." };
  }
  // The email went out: a failed audit write is logged, never reported as a failed send (the agent
  // would send it again).
  await audit(actorUserId, "booking.email-client", "Booking", b.id, undefined, { language: he ? "HE" : "EN" }).catch((error: unknown) =>
    console.error("client booking email audit failed", { error: error instanceof Error ? error.name : "Error", bookingId: b.id }),
  );
  return { ok: true };
}
