import { RequestError } from './errors.js';
import { luhnValid } from '../security/redact.js';
import type { BookRequest, Guest, Holder, Occupancy, PaymentInstruction, ResolveRequest, SearchRequest } from './types.js';

/**
 * Strict checks of everything that comes in over the API. Every parse
 * function takes the raw JSON body and returns a clean copy holding only the
 * fields we know; anything wrong is a 400 with a message that says what.
 * Nothing here may throw anything but RequestError (a TypeError would
 * surface as a 500).
 */

const MAX_ROOMS = 9;
const MAX_HOTELS = 500;
const MAX_NIGHTS = 60;
const MAX_GUESTS_PER_ROOM = 14;
/** Hotelbeds accepts at most 20 characters; one rule for every supplier keeps references portable. */
export const CLIENT_REF_MAX = 20;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const CLIENT_REF_RE = /^[A-Z0-9-]+$/;
// C0 and C1 control characters and DEL.
const CONTROL_RE = /[\u0000-\u001f\u007f-\u009f]/;
// Same, but line breaks and tabs are fine in a free-text remark.
const CONTROL_EXCEPT_NEWLINE_RE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^[0-9 +\-()]+$/;

type Obj = Record<string, unknown>;

// ---------------------------------------------------------------- search

export function parseSearchRequest(body: unknown, today = new Date()): SearchRequest {
  const o = object(body, 'search body', ['checkIn', 'checkOut', 'rooms', 'hotelIds', 'currency', 'nationality', 'suppliers']);
  const checkIn = date(o['checkIn'], 'checkIn');
  const checkOut = date(o['checkOut'], 'checkOut');
  const nights = (Date.parse(checkOut) - Date.parse(checkIn)) / 86_400_000;
  if (nights < 1) throw bad('checkOut must be after checkIn');
  if (nights > MAX_NIGHTS) throw bad(`Stay longer than ${MAX_NIGHTS} nights`);
  if (checkIn < today.toISOString().slice(0, 10)) throw bad('checkIn is in the past');

  const roomsRaw = array(o['rooms'], 'rooms', 1, MAX_ROOMS);
  const rooms = roomsRaw.map(occupancy);
  const hotelIds = array(o['hotelIds'], 'hotelIds', 1, MAX_HOTELS).map((h) => text(h, 'hotelId', 100));
  if (typeof o['currency'] !== 'string' || !/^[A-Z]{3}$/.test(o['currency'])) throw bad('currency must be ISO 4217, e.g. USD');
  const out: SearchRequest = { checkIn, checkOut, rooms, hotelIds, currency: o['currency'] };
  if (o['nationality'] !== undefined) {
    if (typeof o['nationality'] !== 'string' || !/^[A-Z]{2}$/.test(o['nationality'])) throw bad('nationality must be ISO 3166 alpha-2, e.g. IL');
    out.nationality = o['nationality'];
  }
  if (o['suppliers'] !== undefined) {
    out.suppliers = array(o['suppliers'], 'suppliers', 1, 50).map((s) => {
      if (typeof s !== 'string' || !/^[A-Za-z0-9_-]{1,50}$/.test(s)) throw bad('suppliers must be a list of supplier ids');
      return s;
    });
  }
  return out;
}

function occupancy(v: unknown, i: number): Occupancy {
  if (!isObject(v)) throw bad(`rooms[${i}] must be an object {adults, childrenAges}`);
  const adults = v['adults'];
  if (typeof adults !== 'number' || !Number.isInteger(adults) || adults < 1 || adults > 8) throw bad(`rooms[${i}].adults must be 1-8`);
  const ages = v['childrenAges'];
  if (!Array.isArray(ages) || ages.length > 6) throw bad(`rooms[${i}].childrenAges invalid`);
  if (!ages.every((a) => typeof a === 'number' && Number.isInteger(a) && a >= 0 && a <= 17)) throw bad(`rooms[${i}] child age 0-17`);
  return { adults, childrenAges: [...(ages as number[])] };
}

// ----------------------------------------------------------------- quote

export function parseQuoteRequest(body: unknown): { offerId: string } {
  const o = object(body, 'quote body', ['offerId']);
  return { offerId: text(o['offerId'], 'offerId', 200) };
}

// ------------------------------------------------------------------ book

/**
 * Our booking reference, as every supplier and every lookup sees it:
 * upper case, A-Z 0-9 and "-", 6 to 20 characters. Normalised here once so
 * a later lookup by reference is an exact match.
 */
export function normalizeClientReference(raw: unknown): string {
  const rule = `clientReference must be 6-${CLIENT_REF_MAX} characters: letters, digits or "-"`;
  if (typeof raw !== 'string') throw bad(rule);
  const ref = raw.toUpperCase();
  if (ref.length < 6 || ref.length > CLIENT_REF_MAX || !CLIENT_REF_RE.test(ref)) throw bad(rule);
  if (containsCardNumber(ref)) throw cardNumber();
  return ref;
}

export function parseBookRequest(body: unknown): BookRequest {
  const o = object(body, 'booking body', ['clientReference', 'quoteId', 'approvedTotal', 'holder', 'guests', 'payment', 'specialRequests']);
  const clientReference = normalizeClientReference(o['clientReference']);
  const quoteId = text(o['quoteId'], 'quoteId', 100);

  const total = o['approvedTotal'];
  if (
    !isObject(total) || typeof total['minor'] !== 'number' || !Number.isSafeInteger(total['minor']) || total['minor'] < 0 ||
    typeof total['currency'] !== 'string' || !/^[A-Z]{3}$/.test(total['currency'])
  ) {
    throw bad('approvedTotal {minor, currency} is required: minor is a whole number of cents, currency e.g. USD');
  }

  const out: BookRequest = {
    clientReference,
    quoteId,
    approvedTotal: { minor: total['minor'], currency: total['currency'] },
    holder: holder(o['holder']),
    guests: array(o['guests'], 'guests', 1, MAX_ROOMS).map((room, i) => {
      if (!Array.isArray(room) || room.length < 1 || room.length > MAX_GUESTS_PER_ROOM) throw bad(`guests[${i}]: each room needs 1-${MAX_GUESTS_PER_ROOM} guests`);
      return room.map(guest);
    }),
    payment: payment(o['payment']),
  };
  if (o['specialRequests'] !== undefined) {
    const s = o['specialRequests'];
    if (typeof s !== 'string' || s.length > 500 || CONTROL_EXCEPT_NEWLINE_RE.test(s)) throw bad('specialRequests: text, max 500 chars, no control characters');
    if (containsCardNumber(s)) throw cardNumber();
    out.specialRequests = s;
  }
  return out;
}

function holder(v: unknown): Holder {
  if (!isObject(v)) throw bad('holder {firstName, lastName} is required');
  const out: Holder = { firstName: name(v['firstName'], 'holder firstName'), lastName: name(v['lastName'], 'holder lastName') };
  if (v['email'] !== undefined) {
    const e = v['email'];
    if (typeof e !== 'string' || e.length > 254 || CONTROL_RE.test(e) || !EMAIL_RE.test(e)) throw bad('holder email is not a valid email address');
    if (containsCardNumber(e)) throw cardNumber();
    out.email = e;
  }
  if (v['phone'] !== undefined) {
    // A phone is checked as a phone and nothing else. The card-number guard
    // does not run here: long phone numbers pass the card check digit by chance.
    const p = v['phone'];
    const digits = typeof p === 'string' ? p.replace(/\D/g, '').length : 0;
    if (typeof p !== 'string' || !PHONE_RE.test(p) || digits < 6 || digits > 20) {
      throw bad('holder phone must be a phone number: digits, spaces, + - ( ), 6-20 digits');
    }
    out.phone = p;
  }
  return out;
}

function guest(v: unknown): Guest {
  if (!isObject(v)) throw bad('each guest must be an object {firstName, lastName, type}');
  const out: Guest = { firstName: name(v['firstName'], 'guest firstName'), lastName: name(v['lastName'], 'guest lastName'), type: 'ADULT' };
  if (v['type'] !== 'ADULT' && v['type'] !== 'CHILD') throw bad('guest type must be ADULT or CHILD');
  out.type = v['type'];
  const age = v['age'];
  if (out.type === 'CHILD') {
    if (typeof age !== 'number' || !Number.isInteger(age) || age < 0 || age > 17) throw bad('child age 0-17 required');
    out.age = age;
  } else if (age !== undefined) {
    if (typeof age !== 'number' || !Number.isInteger(age) || age < 0 || age > 120) throw bad('guest age must be a whole number');
    out.age = age;
  }
  if (v['title'] !== undefined) {
    if (v['title'] !== 'Mr' && v['title'] !== 'Mrs' && v['title'] !== 'Ms') throw bad('guest title must be Mr, Mrs or Ms');
    out.title = v['title'];
  }
  return out;
}

function payment(v: unknown): PaymentInstruction {
  if (!isObject(v)) throw bad('payment {type} is required');
  switch (v['type']) {
    case 'AGENCY_CREDIT':
      return { type: 'AGENCY_CREDIT' };
    case 'VIRTUAL_CARD':
      return { type: 'VIRTUAL_CARD', cardToken: token(v['cardToken'], 'payment.cardToken') };
    case 'PAY_AT_HOTEL':
      return v['guaranteeCardToken'] === undefined
        ? { type: 'PAY_AT_HOTEL' }
        : { type: 'PAY_AT_HOTEL', guaranteeCardToken: token(v['guaranteeCardToken'], 'payment.guaranteeCardToken') };
    default:
      throw bad('payment.type invalid: AGENCY_CREDIT, VIRTUAL_CARD or PAY_AT_HOTEL');
  }
}

/** A card TOKEN from the vault. A real card number here must never get past the door. */
function token(v: unknown, field: string): string {
  if (typeof v !== 'string' || v.length < 1 || v.length > 200 || CONTROL_RE.test(v)) throw bad(`${field} required (a card token, max 200 chars)`);
  if (containsCardNumber(v)) throw cardNumber();
  return v;
}

// --------------------------------------------------------------- resolve

/** Body of POST /v1/bookings/:ref/resolve: a person settles a NEEDS_REVIEW booking. */
export function parseResolveRequest(body: unknown): ResolveRequest {
  const o = object(body, 'resolve body', ['status', 'note', 'supplierBookingRef']);
  const status = o['status'];
  if (status !== 'CONFIRMED' && status !== 'CANCELLED' && status !== 'FAILED') throw bad('status must be CONFIRMED, CANCELLED or FAILED');
  const note = o['note'];
  if (typeof note !== 'string' || note.trim().length < 1 || note.length > 500 || CONTROL_EXCEPT_NEWLINE_RE.test(note)) {
    throw bad('note is required: what was checked with the supplier, max 500 chars');
  }
  if (containsCardNumber(note)) throw cardNumber();
  const out: ResolveRequest = { status, note };
  if (o['supplierBookingRef'] !== undefined) {
    out.supplierBookingRef = text(o['supplierBookingRef'], 'supplierBookingRef', 100);
    if (containsCardNumber(out.supplierBookingRef)) throw cardNumber();
  }
  return out;
}

// ------------------------------------------------------- card-number guard

// Dates and times are full of digits and separators; without this, two dates
// next to each other can pass the card check digit by chance.
const DATE_LIKE_RE = /\b\d{4}[-/.]\d{1,2}[-/.]\d{1,2}\b|\b\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}\b|\b\d{1,2}:\d{2}(?::\d{2})?\b/g;

/**
 * True when the text holds something that looks like a payment card number:
 * 13-19 digits that pass the Luhn check, written together or in groups
 * separated by space . - / _ or a line break.
 */
export function containsCardNumber(value: string): boolean {
  const cleaned = value.replace(DATE_LIKE_RE, ' x ');
  for (const run of cleaned.match(/\d[\d .\-/_\n]*\d/g) ?? []) {
    const groups = run.split(/[ .\-/_\n]+/).filter(Boolean);
    // Any run of whole groups: finds a card that follows another number.
    for (let i = 0; i < groups.length; i++) {
      let digits = '';
      for (let j = i; j < groups.length; j++) {
        digits += groups[j]!;
        if (digits.length > 19) break;
        if (digits.length >= 13 && luhnValid(digits)) return true;
      }
    }
  }
  return false;
}

// --------------------------------------------------------------- helpers

function isObject(v: unknown): v is Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** The body must be a JSON object, and may hold only the listed fields. */
function object(v: unknown, what: string, allowed: string[]): Obj {
  if (!isObject(v)) throw bad(`Missing ${what}: send a JSON object`);
  const unknown = Object.keys(v).filter((k) => !allowed.includes(k));
  if (unknown.length) throw bad(`Unknown field: ${unknown.slice(0, 5).map((k) => k.slice(0, 40)).join(', ')}`);
  return v;
}

function array(v: unknown, field: string, min: number, max: number): unknown[] {
  if (!Array.isArray(v) || v.length < min || v.length > max) throw bad(`${field} must be a list with ${min}-${max} entries`);
  return v;
}

function text(v: unknown, field: string, max: number): string {
  if (typeof v !== 'string' || v.length < 1 || v.length > max || CONTROL_RE.test(v)) throw bad(`${field} is required: text, max ${max} chars`);
  return v;
}

function name(v: unknown, field: string): string {
  if (typeof v !== 'string' || v.trim().length < 1 || v.length > 100 || CONTROL_RE.test(v)) throw bad(`${field} required: text, max 100 chars`);
  if (containsCardNumber(v)) throw cardNumber();
  return v;
}

/** YYYY-MM-DD that is a real calendar day (2027-02-30 is not). */
function date(v: unknown, field: string): string {
  if (typeof v === 'string' && DATE_RE.test(v)) {
    const t = Date.parse(`${v}T00:00:00Z`);
    if (!Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === v) return v;
  }
  throw bad(`${field} must be a real date, YYYY-MM-DD`);
}

function cardNumber(): RequestError {
  return bad('Request looks like it contains a card number. Send a card token only.');
}

function bad(msg: string): RequestError {
  return new RequestError('INVALID_REQUEST', msg, 400);
}
