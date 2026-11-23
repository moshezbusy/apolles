import { describe, expect, it } from 'vitest';
import {
  containsCardNumber,
  normalizeClientReference,
  parseBookRequest,
  parseQuoteRequest,
  parseSearchRequest,
} from '../src/core/validate.js';
import { bookReq, search } from './helpers.js';

const today = new Date('2026-11-14T10:00:00Z');
const book = (patch: Record<string, unknown> = {}) => ({ ...bookReq('q-1', { minor: 80000, currency: 'USD' }), ...patch });
const bad = (fn: () => unknown, re: RegExp) => expect(fn).toThrow(expect.objectContaining({ status: 400, message: expect.stringMatching(re) }));

describe('search validation', () => {
  it('accepts a good request and returns a clean copy', () => {
    expect(parseSearchRequest({ ...search, suppliers: ['alpha'] }, today)).toEqual({ ...search, suppliers: ['alpha'] });
  });
  it('rejects wrong types, unknown fields and impossible dates with 400', () => {
    bad(() => parseSearchRequest(null, today), /body/i);
    bad(() => parseSearchRequest([], today), /body/i);
    bad(() => parseSearchRequest({ ...search, suppliers: 5 }, today), /suppliers/);
    bad(() => parseSearchRequest({ ...search, suppliers: [7] }, today), /suppliers/);
    bad(() => parseSearchRequest({ ...search, extra: 1 }, today), /unknown field.*extra/i);
    bad(() => parseSearchRequest({ ...search, checkIn: '2027-02-30', checkOut: '2027-03-02' }, today), /checkIn/);
    bad(() => parseSearchRequest({ ...search, checkOut: '2027-13-01' }, today), /checkOut/);
    bad(() => parseSearchRequest({ ...search, rooms: [null] }, today), /rooms/);
    bad(() => parseSearchRequest({ ...search, rooms: [{ adults: '2', childrenAges: [] }] }, today), /adults/);
    bad(() => parseSearchRequest({ ...search, hotelIds: ['ok', 'bad\u0000id'] }, today), /hotelId/);
    bad(() => parseSearchRequest({ ...search, nationality: 5 }, today), /nationality/);
  });
});

describe('quote validation', () => {
  it('needs exactly one string offerId', () => {
    expect(parseQuoteRequest({ offerId: 'alpha~1' })).toEqual({ offerId: 'alpha~1' });
    bad(() => parseQuoteRequest(null), /body/i);
    bad(() => parseQuoteRequest({ offerId: 5 }), /offerId/);
    bad(() => parseQuoteRequest({ offerId: 'x'.repeat(300) }), /offerId/);
    bad(() => parseQuoteRequest({ offerId: 'a', other: true }), /unknown field/i);
  });
});

describe('clientReference', () => {
  it('is upper-cased; only A-Z, 0-9 and "-" ; 6 to 20 characters', () => {
    expect(normalizeClientReference('apl-bk-0001')).toBe('APL-BK-0001');
    expect(parseBookRequest(book({ clientReference: 'apl-bk-0001' })).clientReference).toBe('APL-BK-0001');
    bad(() => normalizeClientReference('APL_BK_0001'), /clientReference/);
    bad(() => normalizeClientReference('X'.repeat(21)), /clientReference/); // Hotelbeds limit
    bad(() => normalizeClientReference('SHORT'), /clientReference/);
    bad(() => normalizeClientReference('APL BK 0001'), /clientReference/);
    bad(() => normalizeClientReference(undefined), /clientReference/);
  });
  it('a raw card number is refused as clientReference', () => {
    bad(() => normalizeClientReference('4111111111111111'), /card number/);
    bad(() => normalizeClientReference('4111-1111-1111-1111'), /card number/);
  });
});

describe('booking validation', () => {
  it('accepts a good request and drops nothing it needs', () => {
    const req = book({ holder: { firstName: 'Dana', lastName: 'Levi', email: 'dana@example.com', phone: '+972 (50) 123-4567' }, specialRequests: 'High floor' });
    expect(parseBookRequest(req)).toEqual(req);
  });
  it('rejects broken structures with 400 instead of crashing', () => {
    bad(() => parseBookRequest(null), /body/i);
    bad(() => parseBookRequest(book({ guests: [[null]] })), /guest/);
    bad(() => parseBookRequest(book({ guests: 'x' })), /guests/);
    bad(() => parseBookRequest(book({ holder: null })), /holder/);
    bad(() => parseBookRequest(book({ holder: { firstName: 5, lastName: 'Levi' } })), /holder/);
    bad(() => parseBookRequest(book({ payment: null })), /payment/);
    bad(() => parseBookRequest(book({ approvedTotal: { minor: '80000', currency: 'USD' } })), /approvedTotal/);
    bad(() => parseBookRequest(book({ approvedTotal: { minor: -1, currency: 'USD' } })), /approvedTotal/);
    bad(() => parseBookRequest(book({ quoteId: 7 })), /quoteId/);
    bad(() => parseBookRequest(book({ surprise: 1 })), /unknown field.*surprise/i);
    bad(() => parseBookRequest(book({ specialRequests: 'x'.repeat(501) })), /specialRequests/);
    bad(() => parseBookRequest(book({ specialRequests: 'bell\u0007' })), /specialRequests/);
    bad(() => parseBookRequest(book({ guests: [[{ firstName: 'A', lastName: 'B', type: 'ADULT', title: 'Dr' }]] })), /title/);
    bad(() => parseBookRequest(book({ guests: [[{ firstName: 'A', lastName: 'B', type: 'CHILD' }]] })), /age/);
  });
  it('phone must look like a phone and email like an email', () => {
    const holder = (h: Record<string, unknown>) => book({ holder: { firstName: 'Dana', lastName: 'Levi', ...h } });
    bad(() => parseBookRequest(holder({ phone: 'call me' })), /phone/);
    bad(() => parseBookRequest(holder({ phone: '12345' })), /phone/);
    bad(() => parseBookRequest(holder({ phone: '1'.repeat(21) })), /phone/);
    bad(() => parseBookRequest(holder({ email: 'not-an-email' })), /email/);
    expect(parseBookRequest(holder({ phone: '(03) 555-0100', email: 'a.b@example.co.il' })).holder.phone).toBe('(03) 555-0100');
  });
  it('a phone number that happens to pass the card check is NOT refused', () => {
    // 16 digits that pass the card check digit: the old guard refused this booking.
    expect(containsCardNumber('4111 1111 1111 1111')).toBe(true);
    const req = book({ holder: { firstName: 'Dana', lastName: 'Levi', phone: '4111 1111 1111 1111' } });
    expect(parseBookRequest(req).holder.phone).toBe('4111 1111 1111 1111');
  });
  it('dates and times in free text are not taken for a card number', () => {
    const text = 'Arrival 2027-03-01 14:30, departure 2027-03-05 11:00. Second stay 01/04/2027 - 05/04/2027.';
    expect(containsCardNumber(text)).toBe(false);
    expect(parseBookRequest(book({ specialRequests: text })).specialRequests).toBe(text);
  });
  it('refuses a card number in any text field, whatever the separators', () => {
    for (const card of ['4111111111111111', '4111 1111 1111 1111', '4111-1111-1111-1111', '4111.1111.1111.1111', '4111/1111/1111/1111', '4111_1111_1111_1111', '4111\n1111\n1111\n1111']) {
      expect(containsCardNumber(`pay with ${card} please`), card).toBe(true);
    }
    expect(containsCardNumber('ref 1234 4111 1111 1111 1111')).toBe(true); // card after another number
    expect(containsCardNumber('booking 1234567890123')).toBe(false); // 13 digits, fails the check digit
    bad(() => parseBookRequest(book({ specialRequests: 'card 4111.1111.1111.1111' })), /card number/);
    bad(() => parseBookRequest(book({ holder: { firstName: 'Dana', lastName: '4111 1111 1111 1111' } })), /card number/);
    bad(() => parseBookRequest(book({ holder: { firstName: 'Dana', lastName: 'Levi', email: '4111111111111111@example.com' } })), /card number/);
  });
  it('a raw card number is refused as a card token', () => {
    bad(() => parseBookRequest(book({ payment: { type: 'PAY_AT_HOTEL', guaranteeCardToken: '4111 1111 1111 1111' } })), /card number/);
    bad(() => parseBookRequest(book({ payment: { type: 'VIRTUAL_CARD', cardToken: '4111111111111111' } })), /card number/);
    expect(parseBookRequest(book({ payment: { type: 'VIRTUAL_CARD', cardToken: 'tok_1' } })).payment).toEqual({ type: 'VIRTUAL_CARD', cardToken: 'tok_1' });
    bad(() => parseBookRequest(book({ payment: { type: 'VIRTUAL_CARD' } })), /cardToken/);
    bad(() => parseBookRequest(book({ payment: { type: 'CASH' } })), /payment/);
  });
});
