import { RequestError } from './errors.js';
import { maskCardNumbers } from '../security/redact.js';
import type { BookRequest, Occupancy, SearchRequest } from './types.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_ROOMS = 9;
const MAX_HOTELS = 500;
const MAX_NIGHTS = 60;

export function validateSearch(req: SearchRequest, today = new Date()): void {
  if (!req || typeof req !== 'object') throw bad('Missing search body');
  checkDate(req.checkIn, 'checkIn');
  checkDate(req.checkOut, 'checkOut');
  const nights = (Date.parse(req.checkOut) - Date.parse(req.checkIn)) / 86_400_000;
  if (nights < 1) throw bad('checkOut must be after checkIn');
  if (nights > MAX_NIGHTS) throw bad(`Stay longer than ${MAX_NIGHTS} nights`);
  const todayIso = today.toISOString().slice(0, 10);
  if (req.checkIn < todayIso) throw bad('checkIn is in the past');
  if (!Array.isArray(req.rooms) || req.rooms.length < 1 || req.rooms.length > MAX_ROOMS) {
    throw bad(`rooms must have 1-${MAX_ROOMS} entries`);
  }
  req.rooms.forEach(checkOccupancy);
  if (!Array.isArray(req.hotelIds) || req.hotelIds.length < 1 || req.hotelIds.length > MAX_HOTELS) {
    throw bad(`hotelIds must have 1-${MAX_HOTELS} entries`);
  }
  if (!req.hotelIds.every((h) => typeof h === 'string' && h.length > 0 && h.length <= 100)) throw bad('Invalid hotelId');
  if (typeof req.currency !== 'string' || !/^[A-Z]{3}$/.test(req.currency)) throw bad('currency must be ISO 4217, e.g. USD');
  if (req.nationality !== undefined && !/^[A-Z]{2}$/.test(req.nationality)) throw bad('nationality must be ISO 3166 alpha-2, e.g. IL');
}

export function validateBook(req: BookRequest): void {
  if (!req || typeof req !== 'object') throw bad('Missing booking body');
  if (typeof req.clientReference !== 'string' || !/^[A-Za-z0-9_-]{6,64}$/.test(req.clientReference)) {
    throw bad('clientReference must be 6-64 chars: letters, digits, - or _');
  }
  if (typeof req.quoteId !== 'string' || !req.quoteId) throw bad('quoteId is required');
  if (!req.approvedTotal || !Number.isSafeInteger(req.approvedTotal.minor) || !/^[A-Z]{3}$/.test(req.approvedTotal.currency ?? '')) {
    throw bad('approvedTotal {minor, currency} is required');
  }
  if (!req.holder || !nonEmpty(req.holder.firstName) || !nonEmpty(req.holder.lastName)) throw bad('holder firstName/lastName required');
  if (!Array.isArray(req.guests) || req.guests.length < 1) throw bad('guests per room required');
  for (const room of req.guests) {
    if (!Array.isArray(room) || room.length < 1) throw bad('each room needs at least one guest');
    for (const g of room) {
      if (!nonEmpty(g.firstName) || !nonEmpty(g.lastName)) throw bad('guest firstName/lastName required');
      if (g.type !== 'ADULT' && g.type !== 'CHILD') throw bad('guest type must be ADULT or CHILD');
      if (g.type === 'CHILD' && (!Number.isInteger(g.age) || (g.age as number) < 0 || (g.age as number) > 17)) {
        throw bad('child age 0-17 required');
      }
    }
  }
  const p = req.payment;
  if (!p || !['AGENCY_CREDIT', 'VIRTUAL_CARD', 'PAY_AT_HOTEL'].includes(p.type)) throw bad('payment.type invalid');
  if (p.type === 'VIRTUAL_CARD' && !nonEmpty(p.cardToken)) throw bad('payment.cardToken required');
  // A raw card number must never reach this service.
  const freeText = [
    req.holder.firstName, req.holder.lastName, req.holder.email, req.holder.phone, req.specialRequests,
    ...req.guests.flat().flatMap((g) => [g.firstName, g.lastName]),
  ].filter((t): t is string => typeof t === 'string');
  if (freeText.some((t) => maskCardNumbers(t) !== t)) {
    throw bad('Request looks like it contains a card number. Send a card token only.');
  }
  if (req.specialRequests !== undefined && (typeof req.specialRequests !== 'string' || req.specialRequests.length > 500)) {
    throw bad('specialRequests max 500 chars');
  }
}

function checkOccupancy(o: Occupancy, i: number): void {
  if (!o || !Number.isInteger(o.adults) || o.adults < 1 || o.adults > 8) throw bad(`rooms[${i}].adults must be 1-8`);
  if (!Array.isArray(o.childrenAges) || o.childrenAges.length > 6) throw bad(`rooms[${i}].childrenAges invalid`);
  if (!o.childrenAges.every((a) => Number.isInteger(a) && a >= 0 && a <= 17)) throw bad(`rooms[${i}] child age 0-17`);
}

function checkDate(v: unknown, field: string): void {
  if (typeof v !== 'string' || !DATE_RE.test(v) || Number.isNaN(Date.parse(v))) throw bad(`${field} must be YYYY-MM-DD`);
}

function nonEmpty(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0 && v.length <= 100;
}

function bad(msg: string): RequestError {
  return new RequestError('INVALID_REQUEST', msg, 400);
}
