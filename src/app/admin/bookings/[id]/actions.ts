"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { formatUsd, parseUsdToCents } from "@/lib/money";
import { requireAdmin } from "@/server/auth/guards";
import {
  ADMIN_NOTE_MAX,
  BookingInputInvalid,
  BookingNotFound,
  adminCancelForAgent,
  adminCheckWithSupplier,
  adminMarkResolved,
  adminRecordSupplierRefund,
  adminReleaseHold,
} from "@/server/booking/service";
import type { BookingActionState } from "./form-state";

// The admin booking page's actions. Each one checks the admin session (TOTP included) itself;
// the service checks the booking's state again and decides every amount: the browser only
// sends the booking id, a note, the charge the admin was shown (compared with the server's own
// charge, never used as the charge) and the refund the admin typed (at most what was charged).

const PAGE = "/admin/bookings/[id]";
const bookingId = z.string().min(1).max(64);
const note = z.string().max(ADMIN_NOTE_MAX * 2);
const NOTE_INVALID = `Write a note of 3 to ${ADMIN_NOTE_MAX} characters: what you checked and what you did.`;
const NOT_FOUND = "This booking was not found. Go back to the bookings list.";

const error = (message: string): BookingActionState => ({ status: "error", message });
const info = (message: string): BookingActionState => ({ status: "info", message });
const success = (message: string): BookingActionState => ({ status: "success", message });

// Only the named fields are read (the form also carries Next.js internals).
function fields<T extends z.ZodRawShape>(shape: T, formData: FormData) {
  return z
    .object(shape)
    .strict()
    .safeParse(Object.fromEntries(Object.keys(shape).map((key) => [key, formData.get(key)])));
}

async function settle(run: () => Promise<BookingActionState>): Promise<BookingActionState> {
  try {
    return await run();
  } catch (caught) {
    if (caught instanceof BookingInputInvalid) return error(NOTE_INVALID);
    if (caught instanceof BookingNotFound) return error(NOT_FOUND);
    throw caught;
  } finally {
    revalidatePath(PAGE, "page");
  }
}

export async function checkWithSupplierAction(_previous: BookingActionState, formData: FormData): Promise<BookingActionState> {
  const { userId } = await requireAdmin();
  const parsed = fields({ bookingId }, formData);
  if (!parsed.success) return error(NOT_FOUND);
  return settle(async () => {
    switch (await adminCheckWithSupplier(userId, parsed.data.bookingId)) {
      case "queued":
        return success("A check with the supplier is on its way. It runs within a minute: reload the page to see what it found.");
      case "already_queued":
        return info("A check with the supplier is already on its way. Reload the page in a minute to see what it found.");
      case "not_checkable":
        return info("Nothing to check with the supplier for a booking in this status.");
    }
  });
}

export async function markResolvedAction(_previous: BookingActionState, formData: FormData): Promise<BookingActionState> {
  const { userId } = await requireAdmin();
  const parsed = fields({ bookingId, note }, formData);
  if (!parsed.success) return error(NOTE_INVALID);
  return settle(async () =>
    (await adminMarkResolved(userId, parsed.data.bookingId, parsed.data.note)) === "resolved"
      ? success("Marked resolved. Your note is in the history below.")
      : info("This booking was already resolved. Nothing changed."),
  );
}

export async function cancelForAgentAction(_previous: BookingActionState, formData: FormData): Promise<BookingActionState> {
  const { userId } = await requireAdmin();
  const parsed = fields({ bookingId, expectedChargeMinor: z.string().regex(/^\d{1,10}$/) }, formData);
  if (!parsed.success) return error("Reload the page and try again.");
  return settle(async () => {
    const outcome = await adminCancelForAgent(userId, parsed.data.bookingId, { expectedChargeMinor: Number(parsed.data.expectedChargeMinor) });
    switch (outcome.kind) {
      case "cancelled":
        return success("Cancelled at the supplier. The refund is in the agency's wallet and the agent was emailed.");
      case "pending":
        return info("The cancellation was sent. The supplier has not confirmed it yet: the check carries on and the refund follows once it confirms.");
      default:
        return error(outcome.message);
    }
  });
}

export async function recordRefundAction(_previous: BookingActionState, formData: FormData): Promise<BookingActionState> {
  const { userId } = await requireAdmin();
  const parsed = fields({ bookingId, amount: z.string().max(40) }, formData);
  if (!parsed.success) return error("Enter the refund in USD, e.g. 250.00.");
  const cents = parseUsdToCents(parsed.data.amount);
  if (cents === null) return error("Enter the refund in USD, e.g. 250.00 (at most 2 decimals).");
  return settle(async () => {
    const outcome = await adminRecordSupplierRefund(userId, parsed.data.bookingId, cents);
    if (outcome.kind === "recorded") return success(`Refund of ${formatUsd(outcome.refundMinor)} recorded in the agency's wallet. The agent was emailed.`);
    if (outcome.kind === "already") return info(`A refund of ${formatUsd(outcome.refundMinor)} was already recorded for this booking. Nothing changed.`);
    return error(outcome.message);
  });
}

export async function releaseHoldAction(_previous: BookingActionState, formData: FormData): Promise<BookingActionState> {
  const { userId } = await requireAdmin();
  const parsed = fields({ bookingId, note }, formData);
  if (!parsed.success) return error(NOTE_INVALID);
  return settle(async () => {
    switch (await adminReleaseHold(userId, parsed.data.bookingId, parsed.data.note)) {
      case "released":
        return success("The hold was released and the booking is marked not confirmed. The agent was emailed.");
      case "already":
        return info("This booking is already marked not confirmed. Nothing changed.");
      case "not_allowed":
        return error("The hold cannot be released: the booking is no longer waiting for the hotel (the supplier may have confirmed it). Reload the page.");
    }
  });
}
