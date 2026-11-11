import type { BookingStatus, Prisma } from "@/generated/prisma/client";

// The booking state machine (plan 3; spec section 5). Every change of a booking's status goes
// through transition(): it updates the row only if it is still in the expected status (so two
// requests can never both move it), and writes one BookingEvent row, in the caller's
// transaction. A move the table below does not list is refused.

const ALLOWED: Record<BookingStatus, readonly BookingStatus[]> = {
  DRAFT: ["PENDING_CONFIRMATION", "EXPIRED"],
  PENDING_CONFIRMATION: ["CONFIRMED", "FAILED"],
  CONFIRMED: ["CANCEL_PENDING", "CANCELLED_BY_SUPPLIER"],
  CANCEL_PENDING: ["CANCELLED", "CONFIRMED"],
  CANCELLED: [],
  CANCELLED_BY_SUPPLIER: [],
  FAILED: [],
  EXPIRED: [],
};

export class BookingStateConflict extends Error {
  constructor(message = "The booking is no longer in the expected state") {
    super(message);
    this.name = "BookingStateConflict";
  }
}

export function canTransition(from: BookingStatus, to: BookingStatus): boolean {
  return ALLOWED[from].includes(to);
}

type Tx = Prisma.TransactionClient;

export async function transition(
  tx: Tx,
  move: {
    bookingId: string;
    from: BookingStatus;
    to: BookingStatus;
    actorUserId: string | null;
    reason: string;
    data?: Omit<Prisma.BookingUncheckedUpdateManyInput, "status" | "id" | "agencyId" | "reference">;
  },
) {
  if (!canTransition(move.from, move.to)) throw new Error(`Booking move ${move.from} → ${move.to} is not allowed`);
  const updated = await tx.booking.updateMany({
    where: { id: move.bookingId, status: move.from },
    data: { ...move.data, status: move.to },
  });
  if (updated.count === 0) throw new BookingStateConflict();
  await tx.bookingEvent.create({
    data: { bookingId: move.bookingId, fromStatus: move.from, toStatus: move.to, actorUserId: move.actorUserId, reason: move.reason.slice(0, 300) },
  });
  return tx.booking.findUniqueOrThrow({ where: { id: move.bookingId } });
}
