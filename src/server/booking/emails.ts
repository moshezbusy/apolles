import { z } from "zod";
import { type StoredGuest, guestLines } from "@/lib/guests";
import { formatUsd } from "@/lib/money";
import { db } from "@/server/db";
import { sendEmail } from "@/server/email/port";
import { getBalance } from "@/server/wallet/ledger";

// Booking emails (spec section 3 row 15). Phase 1: to the agent who booked, never to the
// guest; "needs attention" to the admin. Sent by the job queue ("email.booking"), queued in
// the same transaction as the booking's change, so each one is sent once. The voucher and
// invoice PDFs are attached in a later step; until then the email links to the booking.

export const BOOKING_EMAIL_EVENTS = ["confirmed", "failed", "cancelled", "needs_attention"] as const;
export type BookingEmailEvent = (typeof BOOKING_EMAIL_EVENTS)[number];

const STATUS_FOR: Record<Exclude<BookingEmailEvent, "needs_attention">, string> = { confirmed: "CONFIRMED", failed: "FAILED", cancelled: "CANCELLED" };

function appUrl(): string {
  const parsed = z.url({ protocol: /^https?$/ }).safeParse(process.env.APP_URL);
  if (!parsed.success) throw new Error("APP_URL is not set to a valid http(s) URL");
  return parsed.data.replace(/\/+$/, "");
}

// "Apr 7, 2027, 14:00 UTC": the moment free cancellation ends (the first charge starts).
const DEADLINE_DAY = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
function deadline(at: Date): string {
  return `${DEADLINE_DAY.format(at)}, ${at.toISOString().slice(11, 16)} UTC`;
}

function longDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

export async function sendBookingEmail(bookingId: string, event: BookingEmailEvent): Promise<void> {
  const b = await db.booking.findUnique({ where: { id: bookingId }, include: { user: { select: { email: true, name: true } } } });
  if (!b) return;
  // The booking may have moved on since the job was queued: never send a message that is no
  // longer true (a newer email follows the newer change).
  if (event !== "needs_attention" && b.status !== STATUS_FOR[event]) return;
  const link = `${appUrl()}/bookings/${b.id}`;
  const stay = `${b.hotelName}, ${b.hotelCity}\n${longDate(b.checkin)} to ${longDate(b.checkout)}\n${b.roomName} · ${b.bedDescription} (bed type is a request)`;
  const names = guestLines(b.guests as StoredGuest[], b.adults, b.childAges);
  const lead = names.length ? `Guests:\n${names.map((g) => `  ${g}`).join("\n")}` : `Lead guest: ${b.leadGivenName} ${b.leadFamilyName}`;
  const requests = b.specialRequest ? `\nSpecial requests (sent to the hotel, not guaranteed): ${b.specialRequest}\n` : "";
  const paid = formatUsd(b.chargedMinor ?? b.totalMinor);

  if (event === "needs_attention") {
    const to = z.email().safeParse(process.env.ADMIN_ALERT_EMAIL);
    if (!to.success) throw new Error("ADMIN_ALERT_EMAIL is not set to a valid email address");
    await sendEmail({
      to: to.data,
      subject: `Apolles: booking ${b.reference} needs attention`,
      text: `The automatic check with the supplier gave up for booking ${b.reference} (status ${b.status}).\nCheck it with the supplier and fix it by hand.\n${appUrl()}/admin/bookings/${b.id}\n`,
    });
    return;
  }

  const hello = `Hello ${b.user.name},\n\n`;
  if (event === "confirmed") {
    const { balanceCents } = await getBalance(b.agencyId);
    const free = b.freeCancelEndsAt && b.freeCancelEndsAt > new Date() ? `Free cancellation until ${deadline(b.freeCancelEndsAt)}.` : b.refundable ? "See the booking for the cancellation charges." : "This rate is non-refundable.";
    await sendEmail({
      to: b.user.email,
      subject: `Booking confirmed: ${b.hotelName}, ${longDate(b.checkin)} to ${longDate(b.checkout)}, ${b.reference}`,
      text:
        `${hello}Your booking is confirmed.\n\nApolles reference: ${b.reference}\nHotel confirmation: ${b.hotelConfirmationId ?? "sent by the hotel later; it will show on the booking page"}\n\n` +
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
export async function sendFreeCancelReminders(now: Date = new Date()): Promise<number> {
  const due = await db.booking.findMany({
    where: { status: "CONFIRMED", freeCancelReminderAt: null, freeCancelEndsAt: { gt: now, lte: new Date(now.getTime() + 72 * 3_600_000) } },
    orderBy: { freeCancelEndsAt: "asc" },
    take: 200,
    select: { id: true },
  });
  let sent = 0;
  for (const { id } of due) {
    const claimed = await db.booking.updateMany({ where: { id, freeCancelReminderAt: null, status: "CONFIRMED" }, data: { freeCancelReminderAt: now } });
    if (claimed.count === 0) continue;
    const b = await db.booking.findUniqueOrThrow({ where: { id }, include: { user: { select: { email: true, name: true } } } });
    // Booked already inside the 72 hours: the confirmation gave the deadline; no reminder.
    if (b.confirmedAt && b.freeCancelEndsAt && b.freeCancelEndsAt.getTime() - b.confirmedAt.getTime() <= 72 * 3_600_000) continue;
    try {
      await sendEmail({
      to: b.user.email,
      subject: `Free cancellation ends in 72 hours: ${b.reference}`,
      text:
        `Hello ${b.user.name},\n\nFree cancellation for booking ${b.reference} ends on ${deadline(b.freeCancelEndsAt!)}. After that, cancelling costs a charge (see the booking).\n\n` +
        `${b.hotelName}, ${b.hotelCity}\n${longDate(b.checkin)} to ${longDate(b.checkout)}\nLead guest: ${b.leadGivenName} ${b.leadFamilyName}\n\nView the booking:\n${appUrl()}/bookings/${b.id}\n`,
      });
    } catch (error) {
      // Not sent: the claim is undone, so the next hourly run tries again.
      await db.booking.updateMany({ where: { id, freeCancelReminderAt: now }, data: { freeCancelReminderAt: null } });
      throw error;
    }
    sent += 1;
  }
  return sent;
}
