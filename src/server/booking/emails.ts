import { z } from "zod";
import { type StoredGuest, guestLines, oneRoomConfirmation, roomGuestLines, roomHeading } from "@/lib/guests";
import { formatUsd } from "@/lib/money";
import { supportContact } from "@/server/app-info";
import { db } from "@/server/db";
import { sendEmail } from "@/server/email/port";
import { getBalance } from "@/server/wallet/ledger";
import { freeCancelText } from "./free-cancel";

// Booking emails (spec section 3 row 15). Phase 1: to the agent who booked, never to the
// guest; "needs attention" and the other alerts to the admin. Sent by the job queue
// ("email.booking"), queued in the same transaction as the booking's change, so each one is
// sent once. The voucher and invoice PDFs are attached in a later step; until then the email
// links to the booking.
//   cancel_not_done: a cancellation the supplier did not confirm was put back to confirmed.
//   cancelled_by_supplier (agent) and cancelled_by_supplier_admin: the hotel or the supplier
//     cancelled a confirmed booking; no refund is made automatically.
//   found_after_failed (admin): a booking failed as "not found" turned up at the supplier.
//   cancelled_by_support (agent): an admin cancelled the booking for the agent (spec 7a).
//   refund_recorded (agent): an admin recorded the refund of a booking cancelled by the hotel.
//   change_request (admin): an agent asked for a change to a booking (change-requests.ts).

export const BOOKING_EMAIL_EVENTS = ["confirmed", "failed", "cancelled", "needs_attention", "cancel_not_done", "cancelled_by_supplier", "cancelled_by_supplier_admin", "found_after_failed", "cancelled_by_support", "refund_recorded", "change_request"] as const;
export type BookingEmailEvent = (typeof BOOKING_EMAIL_EVENTS)[number];

// The status a booking must still have for the email to be true ("needs attention" and a change
// request fit any).
const STATUS_FOR: Record<Exclude<BookingEmailEvent, "needs_attention" | "change_request">, string> = {
  confirmed: "CONFIRMED",
  failed: "FAILED",
  cancelled: "CANCELLED",
  cancel_not_done: "CONFIRMED",
  cancelled_by_supplier: "CANCELLED_BY_SUPPLIER",
  cancelled_by_supplier_admin: "CANCELLED_BY_SUPPLIER",
  found_after_failed: "FAILED",
  cancelled_by_support: "CANCELLED",
  refund_recorded: "CANCELLED_BY_SUPPLIER",
};

function adminAlertAddress(): string {
  const to = z.email().safeParse(process.env.ADMIN_ALERT_EMAIL);
  if (!to.success) throw new Error("ADMIN_ALERT_EMAIL is not set to a valid email address");
  return to.data;
}

function appUrl(): string {
  const parsed = z.url({ protocol: /^https?$/ }).safeParse(process.env.APP_URL);
  if (!parsed.success) throw new Error("APP_URL is not set to a valid http(s) URL");
  return parsed.data.replace(/\/+$/, "");
}

// "Apr 7, 2027, 14:00 UTC": the stored end of free cancellation, only for a booking whose charges
// cannot be read (the wording otherwise is freeCancelText's, in the hotel's own time).
const DEADLINE_DAY = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
function deadline(at: Date): string {
  return `${DEADLINE_DAY.format(at)}, ${at.toISOString().slice(11, 16)} UTC`;
}

function longDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

const ROOM_FIELDS = { index: true, adults: true, childAges: true, guests: true, hotelConfirmationId: true } as const;
type EmailRoom = { index: number; adults: number; childAges: number[]; guests: unknown; hotelConfirmationId: string | null };

// A booking of several rooms (plan 10): each room with its own guests (children matched to their
// ages within their room) and its own hotel confirmation. Only a confirmed booking shows them: a
// booking the hotel did not confirm, or one that is cancelled, is never promised one "later".
function roomsText(rooms: EmailRoom[], withConfirmation = true): string {
  const blocks = rooms.map((room) => {
    const confirmation = room.hotelConfirmationId ?? "sent by the hotel later; it will show on the booking page";
    return [`  ${roomHeading(room.index, room)}`, ...roomGuestLines(room).map((g) => `    ${g}`), ...(withConfirmation ? [`    Hotel confirmation: ${confirmation}`] : [])].join("\n");
  });
  return `${rooms.length} rooms:\n${blocks.join("\n")}`;
}

export async function sendBookingEmail(bookingId: string, event: BookingEmailEvent): Promise<void> {
  const b = await db.booking.findUnique({ where: { id: bookingId }, include: { user: { select: { email: true, name: true } }, rooms: { orderBy: { index: "asc" }, select: ROOM_FIELDS } } });
  if (!b) return;
  const severalRooms = b.rooms.length > 1;
  // The booking may have moved on since the job was queued: never send a message that is no
  // longer true (a newer email follows the newer change).
  if (event !== "needs_attention" && event !== "change_request" && b.status !== STATUS_FOR[event]) return;
  // Only while the booking is still the one that was put back (not cancelled again since).
  if (event === "cancel_not_done" && b.cancelRestoredAt === null) return;
  const link = `${appUrl()}/bookings/${b.id}`;
  const stay = `${b.hotelName}, ${b.hotelCity}\n${longDate(b.checkin)} to ${longDate(b.checkout)}\n${b.roomName} · ${b.bedDescription} (bed type is a request)`;
  const names = guestLines(b.guests as StoredGuest[], b.adults, b.childAges);
  const lead = severalRooms ? roomsText(b.rooms, event === "confirmed") : names.length ? `Guests:\n${names.map((g) => `  ${g}`).join("\n")}` : `Lead guest: ${b.leadGivenName} ${b.leadFamilyName}`;
  const requests = b.specialRequest ? `\nSpecial requests (sent to the hotel, not guaranteed): ${b.specialRequest}\n` : "";
  const paid = formatUsd(b.chargedMinor ?? b.totalMinor);

  if (event === "needs_attention") {
    await sendEmail({
      to: adminAlertAddress(),
      subject: `Apolles: booking ${b.reference} needs attention`,
      // Sent for any reason a booking is flagged (the supplier gives no clear answer, its rooms do
      // not match ours, only some rooms were cancelled): the text names none of them, and no
      // personal data. The admin page says what happened.
      text: `Booking ${b.reference} (status ${b.status}) needs an admin to check it with the supplier and fix it by hand.\n${appUrl()}/admin/bookings/${b.id}\n`,
    });
    return;
  }
  // The other admin alerts: what happened and what to do, with no personal data.
  const adminLink = `${appUrl()}/admin/bookings/${b.id}`;
  if (event === "cancelled_by_supplier_admin") {
    await sendEmail({
      to: adminAlertAddress(),
      subject: `Apolles: booking ${b.reference} was cancelled by the supplier`,
      text: `Booking ${b.reference} is cancelled at the supplier, and not by the agent. It is now marked as cancelled by the hotel.\nNo refund was made. Check with the supplier what is refunded, then record the refund on the agency's wallet by hand.\n${adminLink}\n`,
    });
    return;
  }
  if (event === "change_request") {
    await sendEmail({
      to: adminAlertAddress(),
      subject: `Apolles: change requested for booking ${b.reference}`,
      // The agent's text may hold personal details: it is on the admin page, not in the email.
      text: `An agent asked for a change to booking ${b.reference}. Read the request and mark it done once it is handled.\n${appUrl()}/admin/change-requests\n${adminLink}\n`,
    });
    return;
  }
  if (event === "found_after_failed") {
    await sendEmail({
      to: adminAlertAddress(),
      subject: `Apolles: booking ${b.reference} is booked at the supplier but was not charged`,
      text: `Booking ${b.reference} was marked not confirmed and the agency's money was returned, because the supplier did not have it. The supplier has it now: the room is booked there and the agency was not charged.\nNothing was charged automatically. Check it with the supplier now: cancel it there, or charge the agency by hand.\n${adminLink}\n`,
    });
    return;
  }

  const hello = `Hello ${b.user.name},\n\n`;
  if (event === "cancel_not_done") {
    const support = supportContact().email;
    await sendEmail({
      to: b.user.email,
      subject: `Cancellation not completed: ${b.reference}`,
      text:
        `${hello}The hotel did not confirm the cancellation of booking ${b.reference}. The booking is still confirmed, and nothing was charged or refunded.\n\n${stay}\n${lead}\n\n` +
        `What to do: open the booking and cancel it again. If it does not go through again, contact Apolles support${support ? ` at ${support}` : ""}.\n` +
        `If the hotel completes the cancellation later after all, we finish it for you and the refund is added to your balance.\n\n${link}\n`,
    });
    return;
  }
  if (event === "refund_recorded") {
    const { balanceCents } = await getBalance(b.agencyId);
    await sendEmail({
      to: b.user.email,
      subject: `Refund recorded: ${b.reference}`,
      text:
        `${hello}Booking ${b.reference} was cancelled by the hotel. Apolles support checked the cancellation and recorded the refund.\n\n${stay}\n\n` +
        `Paid from your balance: ${paid}\nRefunded to your balance: ${formatUsd(b.refundMinor ?? 0)}\nYour balance now: ${formatUsd(balanceCents)}\n\n${link}\n`,
    });
    return;
  }
  if (event === "cancelled_by_support") {
    await sendEmail({
      to: b.user.email,
      subject: `Booking cancelled by Apolles support: ${b.reference}`,
      text:
        `${hello}Apolles support cancelled booking ${b.reference} for you.\n\n${stay}\n${lead}\n\n` +
        `Cancellation charge: ${formatUsd(b.cancelChargeMinor ?? 0)}\nRefunded to your balance: ${formatUsd(b.refundMinor ?? 0)}\nYour balance now: ${formatUsd((await getBalance(b.agencyId)).balanceCents)}\n\n${link}\n`,
    });
    return;
  }
  if (event === "cancelled_by_supplier") {
    const support = supportContact().email;
    await sendEmail({
      to: b.user.email,
      subject: `Booking cancelled by the hotel: ${b.reference}`,
      text:
        `${hello}The hotel or its booking system cancelled booking ${b.reference}. This was not a cancellation you asked for.\n\n${stay}\n${lead}\n\n` +
        `Paid from your balance: ${paid}\nNothing was refunded automatically. Apolles support checks the cancellation with the hotel and records the refund in your balance.\n` +
        `What to do: tell your client, and search again if they still need a room. Contact Apolles support${support ? ` at ${support}` : ""} with any question.\n\n${link}\n`,
    });
    return;
  }
  if (event === "confirmed") {
    const { balanceCents } = await getBalance(b.agencyId);
    const freeText = freeCancelText(b, new Date());
    const free = freeText ? `${freeText}.` : b.refundable ? "See the booking for the cancellation charges." : "This rate is non-refundable.";
    await sendEmail({
      to: b.user.email,
      subject: `Booking confirmed: ${b.hotelName}, ${longDate(b.checkin)} to ${longDate(b.checkout)}, ${b.reference}`,
      text:
        `${hello}Your booking is confirmed.\n\nApolles reference: ${b.reference}\nHotel confirmation: ${severalRooms ? "one for each room, below" : (oneRoomConfirmation(b, b.rooms) ?? "sent by the hotel later; it will show on the booking page")}\n\n` +
        `${stay}\n${lead}\n${requests}\n${free}\n\nPaid from your balance: ${paid}\nYour balance now: ${formatUsd(balanceCents)}\n\nBooking details, voucher and cancellation:\n${link}\n`,
    });

  } else if (event === "failed") {
    await sendEmail({
      to: b.user.email,
      subject: `Booking not confirmed: ${b.reference}`,
      text: `${hello}The hotel did not confirm booking ${b.reference}.\n\n${stay}\n${lead}\n\nNothing was charged: ${paid} is back in your balance.\nSearch again for another room or hotel.\n${link}\n`,
    });
  } else {
    await sendEmail({
      to: b.user.email,
      subject: `Booking cancelled: ${b.reference}`,
      text:
        `${hello}Booking ${b.reference} is cancelled.\n\n${stay}\n${lead}\n\n` +
        `Cancellation charge: ${formatUsd(b.cancelChargeMinor ?? 0)}\nRefunded to your balance: ${formatUsd(b.refundMinor ?? 0)}\nYour balance now: ${formatUsd((await getBalance(b.agencyId)).balanceCents)}\n\n${link}\n`,
    });
  }
}

// Email #14: 72 hours before free cancellation ends, for each confirmed booking, once. Run every
// hour; each booking is claimed (reminder time set) before its email, so it is never sent twice.
// One booking that fails (a refused address, a mail provider error) never stops the others: its
// claim is undone, so the next hourly run tries it again, and the failures are reported in one
// log line at the end (booking references only).
export async function sendFreeCancelReminders(now: Date = new Date()): Promise<number> {
  const due = await db.booking.findMany({
    where: { status: "CONFIRMED", freeCancelReminderAt: null, freeCancelEndsAt: { gt: now, lte: new Date(now.getTime() + 72 * 3_600_000) } },
    orderBy: { freeCancelEndsAt: "asc" },
    take: 200,
    select: { id: true, reference: true },
  });
  let sent = 0;
  const failed: string[] = [];
  for (const { id, reference } of due) {
    try {
      const claimed = await db.booking.updateMany({ where: { id, freeCancelReminderAt: null, status: "CONFIRMED" }, data: { freeCancelReminderAt: now } });
      if (claimed.count === 0) continue;
      const b = await db.booking.findUniqueOrThrow({ where: { id }, include: { user: { select: { email: true, name: true } }, rooms: { orderBy: { index: "asc" }, select: ROOM_FIELDS } } });
      // Booked already inside the 72 hours: the confirmation gave the deadline; no reminder.
      if (b.confirmedAt && b.freeCancelEndsAt && b.freeCancelEndsAt.getTime() - b.confirmedAt.getTime() <= 72 * 3_600_000) continue;
      await sendEmail({
        to: b.user.email,
        subject: `Free cancellation ends in 72 hours: ${b.reference}`,
        text:
          `Hello ${b.user.name},\n\nBooking ${b.reference}: ${freeCancelText(b, now) ?? `Free cancellation until ${deadline(b.freeCancelEndsAt!)}`}. After that, cancelling costs a charge (see the booking).\n\n` +
          `${b.hotelName}, ${b.hotelCity}\n${longDate(b.checkin)} to ${longDate(b.checkout)}\n${b.rooms.length > 1 ? roomsText(b.rooms) : `Lead guest: ${b.leadGivenName} ${b.leadFamilyName}`}\n\nView the booking:\n${appUrl()}/bookings/${b.id}\n`,
      });
      sent += 1;
    } catch {
      failed.push(reference);
      // Not sent: the claim is undone, so the next hourly run tries again.
      await db.booking.updateMany({ where: { id, freeCancelReminderAt: now }, data: { freeCancelReminderAt: null } }).catch(() => undefined);
    }
  }
  if (failed.length > 0) console.error(`free-cancellation reminders: ${failed.length} of ${due.length} not sent, tried again next hour: ${failed.slice(0, 50).join(", ")}`);
  return sent;
}
