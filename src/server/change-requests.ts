import { z } from "zod";
import type { ChangeRequestStatus, Prisma } from "@/generated/prisma/client";
import { audit } from "@/server/audit";
import { queueEmail } from "@/server/booking/service";
import { db } from "@/server/db";
import { hitRateLimit } from "@/server/rate-limit";

// "Request a change" (spec 7a, mockup 12): an agent asks Apolles to change a booking (names,
// dates, a request to the hotel). Nothing changes by itself: the request is saved, the admin is
// emailed, and the admin marks it done with a note once it is handled with the supplier.
// The agent screens call createChangeRequest with the ids from requireAgent(); every read is
// scoped by that agency.

export const CHANGE_REQUEST_MAX_LENGTH = 2000;
export const CHANGE_NOTE_MAX_LENGTH = 1000;
// Per agent user, so a page left resubmitting cannot flood the admin's mailbox.
const CREATE_LIMIT = { limit: 10, windowMs: 60 * 60_000 };
// A change can only be asked for a booking that is booked or about to be.
const OPEN_FOR: readonly string[] = ["CONFIRMED", "PENDING_CONFIRMATION"];

export type ChangeRequestRefusal = "not_found" | "not_open" | "too_many" | "invalid";

export class ChangeRequestNotAllowed extends Error {
  readonly code: ChangeRequestRefusal;
  constructor(code: ChangeRequestRefusal) {
    super(code);
    this.name = "ChangeRequestNotAllowed";
    this.code = code;
  }
}

// Plain text: control characters other than line breaks and tabs removed, trimmed.
function cleanText(raw: string): string {
  return raw.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "").trim();
}

const requestText = z.string().max(CHANGE_REQUEST_MAX_LENGTH * 2).transform(cleanText).pipe(z.string().min(1).max(CHANGE_REQUEST_MAX_LENGTH));

// Saves the agent's request and emails the admin (queued in the same transaction, sent once).
// The booking must belong to the agency, and the author must be an agent of that agency.
// Throws ChangeRequestNotAllowed: not_found (no such booking for this agency, or the user is not
// one of its agents), not_open (the booking is not confirmed or waiting), too_many (10 an hour
// per agent), invalid (empty or longer than 2000 characters).
export async function createChangeRequest(agencyId: string, userId: string, bookingId: string, text: string): Promise<{ id: string }> {
  const parsed = requestText.safeParse(text);
  if (!parsed.success) throw new ChangeRequestNotAllowed("invalid");
  if (typeof bookingId !== "string" || bookingId.length > 64) throw new ChangeRequestNotAllowed("not_found");
  const [booking, author] = await Promise.all([
    db.booking.findFirst({ where: { id: bookingId, agencyId }, select: { id: true, status: true } }),
    db.user.findFirst({ where: { id: userId, agencyId, role: "AGENT", status: "ACTIVE" }, select: { id: true } }),
  ]);
  if (!booking || !author) throw new ChangeRequestNotAllowed("not_found");
  if (!OPEN_FOR.includes(booking.status)) throw new ChangeRequestNotAllowed("not_open");
  if (!(await hitRateLimit(`change-request:${userId}`, CREATE_LIMIT.limit, CREATE_LIMIT.windowMs)).allowed) throw new ChangeRequestNotAllowed("too_many");

  return db.$transaction(async (tx) => {
    const created = await tx.changeRequest.create({ data: { bookingId: booking.id, agencyId, authorUserId: userId, text: parsed.data }, select: { id: true, createdAt: true } });
    // The trail says a change was asked for; the text itself (it may hold personal details)
    // stays on the request.
    await tx.bookingEvent.create({ data: { bookingId: booking.id, fromStatus: booking.status, toStatus: booking.status, actorUserId: userId, reason: "The agent asked for a change (see change requests)" } });
    await audit(userId, "booking.change-request", "ChangeRequest", created.id, undefined, { bookingId: booking.id }, tx);
    await queueEmail(tx, booking.id, "change_request", created.createdAt);
    return { id: created.id };
  });
}

// The agent's own requests for one booking, newest first (for the agent booking page).
export async function listChangeRequestsForBooking(agencyId: string, bookingId: string) {
  return db.changeRequest.findMany({
    where: { agencyId, bookingId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 20,
    select: { id: true, text: true, status: true, adminNote: true, createdAt: true, doneAt: true },
  });
}

const PAGE = 50;

// Admin list (/admin/change-requests): open first by default, newest first, a cursor page.
export async function listChangeRequests(opts: { status?: ChangeRequestStatus; bookingId?: string; cursor?: string }) {
  const where: Prisma.ChangeRequestWhereInput = {};
  if (opts.status) where.status = opts.status;
  if (opts.bookingId && opts.bookingId.length <= 64) where.bookingId = opts.bookingId;
  const cursor = opts.cursor && opts.cursor.length <= 64 ? await db.changeRequest.findUnique({ where: { id: opts.cursor }, select: { id: true } }) : null;
  const rows = await db.changeRequest.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: PAGE + 1,
    ...(cursor ? { cursor: { id: cursor.id }, skip: 1 } : {}),
    select: {
      id: true,
      text: true,
      status: true,
      adminNote: true,
      createdAt: true,
      doneAt: true,
      booking: { select: { id: true, reference: true, status: true } },
      agency: { select: { id: true, name: true } },
      author: { select: { email: true, name: true } },
      doneBy: { select: { email: true } },
    },
  });
  return { rows: rows.slice(0, PAGE), nextCursor: rows.length > PAGE ? (rows[PAGE - 1]?.id ?? null) : null };
}

export async function countOpenChangeRequests(): Promise<number> {
  return db.changeRequest.count({ where: { status: "OPEN" } });
}

const doneNote = z.string().max(CHANGE_NOTE_MAX_LENGTH * 2).transform(cleanText).pipe(z.string().max(CHANGE_NOTE_MAX_LENGTH));

// "Mark done" with the admin's note: once (a second click changes nothing), with an audit row and
// a line in the booking's trail, in one transaction.
export async function markChangeRequestDone(adminId: string, requestId: string, note: string): Promise<"done" | "already" | "not_found"> {
  const parsed = doneNote.safeParse(note);
  if (!parsed.success) throw new ChangeRequestNotAllowed("invalid");
  if (typeof requestId !== "string" || requestId.length > 64) return "not_found";
  return db.$transaction(async (tx) => {
    const request = await tx.changeRequest.findUnique({ where: { id: requestId }, select: { id: true, bookingId: true, booking: { select: { status: true } } } });
    if (!request) return "not_found";
    const now = new Date();
    const done = await tx.changeRequest.updateMany({ where: { id: request.id, status: "OPEN" }, data: { status: "DONE", doneAt: now, doneById: adminId, adminNote: parsed.data } });
    if (done.count === 0) return "already";
    await tx.bookingEvent.create({
      data: { bookingId: request.bookingId, fromStatus: request.booking.status, toStatus: request.booking.status, actorUserId: adminId, reason: "A change request was handled by an admin" },
    });
    await audit(adminId, "change-request.done", "ChangeRequest", request.id, { status: "OPEN" }, { status: "DONE" }, tx);
    return "done";
  });
}
