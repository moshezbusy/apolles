import { z } from "zod";
import type { BookInput, BookResult, BookingSupplier, RetrievedItinerary, SupplierContext, SupplierLinks, SupplierRoomStatus } from "../types";
import { SupplierError, SupplierOutcomeUnknown, expediaRequest, recordUnknownFields } from "./client";
import { readExpediaConfig } from "./config";
import { ParseNotes, check, type ObjectFactory } from "./parse";

// Rapid booking calls (plan 3), from the official spec (docs/research/expedia-api/
// rapid-3-specs.yaml; fixtures in ./fixtures):
//   POST   /itineraries?token=…                      create (affiliate_collect: we pay Expedia)
//   GET    /itineraries?affiliate_reference_id&email find our booking after an unclear answer
//   GET    <retrieve link>                           one itinerary (rooms, status, cancel link)
//   DELETE <room cancel link>                        204 cancelled; 202 = not known yet
// Every link is Expedia's own href, checked to stay on the API host and under /v3.
// Outside production every non-GET carries the Test header ("standard").

export class SupplierNotSent extends SupplierError {} // nothing reached the supplier (local check)

const BOOK_TIMEOUT_MS = 60_000; // booking can be slow; an unclear answer is reconciled
const RETRIEVE_TIMEOUT_MS = 20_000;
const BILLING_COUNTRY = "IL"; // TR3: the payer is Taya Tourism, Israel

function schemas(object: ObjectFactory) {
  const unused = z.unknown().optional();
  const link = object({ method: z.string(), href: z.string(), expires: unused, required_parameters: unused, test_href: unused });
  const room = object({
    id: z.string(),
    status: z.string(),
    confirmation_id: object({ expedia: z.string().optional(), property: z.string().optional() }).optional(),
    links: object({ cancel: link.optional(), change: unused, shop_for_change: unused, conversation: unused }).optional(),
  });
  const itinerary = object({
    itinerary_id: z.string(),
    rooms: z.array(room).optional(),
  });
  const created = object({
    itinerary_id: z.string().regex(/^[A-Za-z0-9-]{1,64}$/),
    links: object({ retrieve: link.optional(), resume: link.optional(), cancel: link.optional(), complete_payment_session: unused }).optional(),
    encoded_challenge_config: unused,
    trader_information: unused,
  });
  return { itinerary, created };
}
// Unknown fields in an itinerary are many and irrelevant here: the lenient schema keeps the
// fields we use, the strict one only feeds the unknown-field log.
const lenient = schemas(z.object);
const strict = schemas(z.strictObject as unknown as ObjectFactory);

function billingContact() {
  const given = process.env.EXPEDIA_BILLING_GIVEN_NAME;
  const family = process.env.EXPEDIA_BILLING_FAMILY_NAME;
  const line1 = process.env.EXPEDIA_BILLING_ADDRESS_LINE1;
  const city = process.env.EXPEDIA_BILLING_CITY;
  if (!given || !family || !line1 || !city) throw new SupplierNotSent("The billing contact (EXPEDIA_BILLING_*) is not set");
  const postal = process.env.EXPEDIA_BILLING_POSTAL_CODE;
  return {
    given_name: given,
    family_name: family,
    address: { line_1: line1, city, country_code: BILLING_COUNTRY, ...(postal ? { postal_code: postal } : {}) },
  };
}

// An Expedia href ("/v3/itineraries/…?token=…") → a path for the client, kept exactly as given.
export function linkPath(href: string): string {
  const { baseUrl } = readExpediaConfig();
  const base = new URL(baseUrl);
  let target: URL;
  try {
    target = new URL(href, base);
  } catch {
    throw new SupplierError("Expedia link could not be read");
  }
  if (target.origin !== base.origin || !target.pathname.startsWith(`${base.pathname}/`)) throw new SupplierError("Expedia link points outside the API");
  return `${target.pathname.slice(base.pathname.length)}${target.search}`;
}

function testHeader(): { test?: string } {
  return readExpediaConfig().production ? {} : { test: "standard" };
}

function statusOf(raw: string): SupplierRoomStatus {
  if (raw === "booked") return "booked";
  if (raw === "pending") return "pending";
  if (raw === "canceled" || raw === "cancelled") return "cancelled";
  return "other";
}

function toItinerary(value: z.infer<typeof lenient.itinerary>): RetrievedItinerary {
  return {
    itineraryId: value.itinerary_id,
    rooms: (value.rooms ?? []).map((r) => ({
      id: r.id,
      status: statusOf(r.status),
      hotelConfirmationId: r.confirmation_id?.property ?? null,
      cancelLink: r.links?.cancel?.href ?? null,
    })),
  };
}

const TOKEN_IN_QUERY = /^[A-Za-z0-9._~-]{1,512}$/;
const NAME = /^[^<>()&]{1,60}$/;

export class ExpediaBooking implements BookingSupplier {
  async book(input: BookInput, context: SupplierContext): Promise<BookResult> {
    if (!TOKEN_IN_QUERY.test(input.bookToken)) throw new SupplierNotSent("Invalid book token");
    if (!/^[A-Za-z0-9-]{3,28}$/.test(input.affiliateReferenceId)) throw new SupplierNotSent("Invalid affiliate reference");
    if (!NAME.test(input.lead.givenName) || !NAME.test(input.lead.familyName)) throw new SupplierNotSent("Invalid guest name");
    const body = {
      affiliate_reference_id: input.affiliateReferenceId,
      hold: false,
      email: input.lead.email,
      phone: { country_code: input.lead.phone.countryCode, number: input.lead.phone.number },
      rooms: [{ given_name: input.lead.givenName, family_name: input.lead.familyName, smoking: false }],
      payments: [{ type: "affiliate_collect", billing_contact: billingContact() }],
    };
    const { data, logId } = await expediaRequest({
      method: "POST",
      path: "/itineraries",
      query: { token: input.bookToken },
      body,
      context: { ...context, ...testHeader() },
      timeoutMs: BOOK_TIMEOUT_MS,
      affiliateReferenceId: input.affiliateReferenceId,
    });
    const notes = new ParseNotes();
    const value = check(lenient.created, strict.created, data, "", notes);
    await recordUnknownFields(logId, notes.names);
    // A 2xx we cannot read: the booking may exist. Reconcile, never book again.
    if (!value) throw new SupplierOutcomeUnknown("Expedia booking answer could not be read");
    const links: SupplierLinks = {};
    if (value.links?.retrieve) links.retrieve = value.links.retrieve.href;
    if (value.links?.cancel) links.cancel = value.links.cancel.href;
    return { itineraryId: value.itinerary_id, links };
  }

  async findByAffiliateReference(ref: { affiliateReferenceId: string; email: string }, context: SupplierContext): Promise<RetrievedItinerary | null> {
    const { data, logId } = await expediaRequest({
      method: "GET",
      path: "/itineraries",
      query: { affiliate_reference_id: ref.affiliateReferenceId, email: ref.email },
      context,
      timeoutMs: RETRIEVE_TIMEOUT_MS,
      affiliateReferenceId: ref.affiliateReferenceId,
    });
    if (!Array.isArray(data)) throw new SupplierError("Expedia itinerary search answer is not a list");
    if (data.length === 0) return null; // "No itineraries": not (or not yet) booked
    const notes = new ParseNotes();
    const value = check(lenient.itinerary, strict.itinerary, data[0], "[0]", notes);
    await recordUnknownFields(logId, notes.names);
    if (!value) throw new SupplierError("Expedia itinerary could not be read");
    return toItinerary(value);
  }

  async retrieve(links: SupplierLinks, context: SupplierContext): Promise<RetrievedItinerary> {
    if (!links.retrieve) throw new SupplierNotSent("No retrieve link");
    const { data, logId } = await expediaRequest({ method: "GET", path: linkPath(links.retrieve), context, timeoutMs: RETRIEVE_TIMEOUT_MS });
    const notes = new ParseNotes();
    const value = check(lenient.itinerary, strict.itinerary, data, "", notes);
    await recordUnknownFields(logId, notes.names);
    if (!value) throw new SupplierError("Expedia itinerary could not be read");
    return toItinerary(value);
  }

  async cancelRoom(cancelLink: string, context: SupplierContext): Promise<void> {
    const { status } = await expediaRequest({ method: "DELETE", path: linkPath(cancelLink), context: { ...context, ...testHeader() }, timeoutMs: RETRIEVE_TIMEOUT_MS });
    // 204: cancelled. 202: accepted but the result is not known yet: check with a retrieve.
    if (status !== 204) throw new SupplierOutcomeUnknown(`Expedia cancellation not confirmed yet (HTTP ${status})`);
  }
}
