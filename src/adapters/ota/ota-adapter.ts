import { SupplierError, type SupplierErrorCode } from '../../core/errors.js';
import { moneyToDecimal } from '../../core/money.js';
import type {
  BookingLookup,
  CallContext,
  SupplierAdapter,
  SupplierBookingResult,
  SupplierBookRequest,
  SupplierCancelResult,
  SupplierCapabilities,
  SupplierOffer,
  SupplierQuote,
  SupplierSearchRequest,
} from '../../core/supplier.js';
import type { Environment, RateOffer } from '../../core/types.js';
import type { HttpTransport } from '../../http/transport.js';
import type { CardDetails, CardVault } from '../../security/card-vault.js';
import type { SecretProvider } from '../../security/secrets.js';
import { XmlProtocolError, buildXml, parseOtaResponse, path, wrapEnvelope, type XmlNode } from './codec.js';
import {
  buildAvailRQ,
  buildCancelRQ,
  buildReadRQ,
  buildResRQ,
  isSuccess,
  otaErrors,
  parseAvailRS,
  parseCancelRS,
  parseHotelReservation,
  type MessageHeader,
  type PosCredentials,
} from './messages.js';
import type { OtaOperation, OtaVendorProfile } from './profile.js';

export interface OtaAdapterConfig {
  id: string;
  profile: OtaVendorProfile;
  /** e.g. https://test-api.vendor.com — test or production, from config. */
  baseUrl: string;
  environment: 'test' | 'production';
  /** NAMES of the secrets (env vars / vault keys), never the values. */
  secretNames: { username: string; password: string };
  transport: HttpTransport;
  secrets: SecretProvider;
  vault: CardVault;
}

/**
 * Generic OpenTravel adapter. Omnibees, Dingus and other OTA-speaking
 * suppliers are this class + their own profile.
 */
export class OtaAdapter implements SupplierAdapter {
  readonly id: string;
  readonly environment: Environment;
  readonly capabilities: SupplierCapabilities;
  private readonly profile: OtaVendorProfile;

  constructor(private readonly cfg: OtaAdapterConfig) {
    if (cfg.environment === 'production' && !cfg.profile.verified) {
      throw new Error(
        `${cfg.id}: profile "${cfg.profile.name}" is not verified against the vendor's documentation. ` +
          'Finish certification on the test environment before enabling production.',
      );
    }
    this.id = cfg.id;
    this.environment = cfg.environment;
    this.profile = cfg.profile;
    this.capabilities = {
      multiRoom: cfg.profile.capabilities.multiRoom,
      maxHotelsPerSearch: cfg.profile.capabilities.maxHotelsPerSearch,
      nativeCheckRate: false,
      lookupByClientReference: cfg.profile.capabilities.lookupByClientReference,
      cancel: cfg.profile.capabilities.cancel,
    };
  }

  async search(req: SupplierSearchRequest, ctx: CallContext): Promise<SupplierOffer[]> {
    const body = buildAvailRQ(this.profile, this.header(ctx), req, this.posCreds());
    const rs = await this.call('avail', 'search', 'OTA_HotelAvailRQ', body, ['OTA_HotelAvailRS'], ctx, true);
    const errors = otaErrors(rs);
    if (errors.length) {
      if (errors.every((e) => e.code && this.profile.noAvailabilityErrorCodes.includes(e.code))) return [];
      throw this.errorFrom(errors, 'search');
    }
    return parseAvailRS(this.profile, rs, req);
  }

  /** OTA has no universal re-check message: re-run availability for this one hotel + rate plan. */
  async checkRate(offer: RateOffer, ctx: CallContext): Promise<SupplierQuote> {
    const req: SupplierSearchRequest = {
      checkIn: offer.checkIn,
      checkOut: offer.checkOut,
      rooms: offer.occupancy,
      supplierHotelCodes: [offer.supplierHotelCode],
      currency: offer.total.currency,
    };
    const body = buildAvailRQ(this.profile, this.header(ctx), req, this.posCreds(), offer.ratePlanCode);
    const rs = await this.call('avail', 'checkRate', 'OTA_HotelAvailRQ', body, ['OTA_HotelAvailRS'], ctx, true);
    const errors = otaErrors(rs);
    if (errors.length) {
      if (errors.every((e) => e.code && this.profile.noAvailabilityErrorCodes.includes(e.code))) return { available: false };
      throw this.errorFrom(errors, 'checkRate');
    }
    const roomCodes = offer.rooms.map((r) => r.supplierRoomCode).join(',');
    const match = parseAvailRS(this.profile, rs, req).find(
      (o) =>
        o.supplierHotelCode === offer.supplierHotelCode &&
        o.ratePlanCode === offer.ratePlanCode &&
        o.rooms.map((r) => r.supplierRoomCode).join(',') === roomCodes,
    );
    return match ? { available: true, offer: match } : { available: false };
  }

  async book(req: SupplierBookRequest, ctx: CallContext): Promise<SupplierBookingResult> {
    const send = async (card?: CardDetails) => {
      const body = buildResRQ(
        this.profile,
        this.header(ctx),
        {
          clientReference: req.clientReference,
          supplierHotelCode: req.offer.supplierHotelCode,
          ratePlanCode: req.offer.ratePlanCode,
          roomTypeCodes: req.offer.rooms.map((r) => r.supplierRoomCode),
          checkIn: req.offer.checkIn,
          checkOut: req.offer.checkOut,
          occupancy: req.offer.occupancy,
          total: req.offer.total,
          totalDecimal: moneyToDecimal(req.offer.total),
          holder: req.holder,
          guests: req.guests,
          specialRequests: req.specialRequests,
          card,
          bookingCode: req.offer.supplierData['bookingCode'],
        },
        this.posCreds(),
      );
      return this.call('res', 'book', 'OTA_HotelResRQ', body, ['OTA_HotelResRS'], ctx, false);
    };

    const p = req.payment;
    const cardToken = p.type === 'VIRTUAL_CARD' ? p.cardToken : p.type === 'PAY_AT_HOTEL' ? p.guaranteeCardToken : undefined;
    const rs = cardToken ? await this.cfg.vault.withCard(cardToken, (card) => send(card)) : await send();

    const errors = otaErrors(rs);
    if (errors.length) throw this.errorFrom(errors, 'book');
    const res = path(rs, 'HotelReservations', 'HotelReservation')[0];
    if (!res) {
      // Answer without a reservation and without errors: we cannot be sure.
      throw new SupplierError(this.id, 'OUTCOME_UNKNOWN', 'book: response has no HotelReservation');
    }
    const out = parseHotelReservation(this.profile, res, req.clientReference);
    if (!out.supplierBookingRef && out.status !== 'FAILED') {
      throw new SupplierError(this.id, 'OUTCOME_UNKNOWN', 'book: response has no booking number');
    }
    return out;
  }

  async getBooking(ref: BookingLookup, ctx: CallContext): Promise<SupplierBookingResult | null> {
    const body = buildReadRQ(this.profile, this.header(ctx), ref, this.posCreds());
    const rs = await this.call('read', 'getBooking', 'OTA_ReadRQ', body, ['OTA_ResRetrieveRS', 'OTA_HotelResRS', 'OTA_HotelResNotifRQ'], ctx, true);
    const errors = otaErrors(rs);
    if (errors.length) {
      if (errors.some((e) => e.code && this.profile.notFoundErrorCodes.includes(e.code))) return null;
      throw this.errorFrom(errors, 'getBooking');
    }
    const res =
      path(rs, 'ReservationsList', 'HotelReservation')[0] ?? path(rs, 'HotelReservations', 'HotelReservation')[0];
    if (!res) {
      if (isSuccess(rs)) return null;
      throw new SupplierError(this.id, 'PROTOCOL', 'getBooking: unexpected response');
    }
    return parseHotelReservation(this.profile, res, ref.clientReference);
  }

  async cancel(ref: BookingLookup, ctx: CallContext): Promise<SupplierCancelResult> {
    const body = buildCancelRQ(this.profile, this.header(ctx), ref, this.posCreds());
    const rs = await this.call('cancel', 'cancel', 'OTA_CancelRQ', body, ['OTA_CancelRS'], ctx, false);
    const errors = otaErrors(rs);
    if (errors.length) throw this.errorFrom(errors, 'cancel');
    return parseCancelRS(rs);
  }

  // ---------------------------------------------------------------- plumbing

  private async call(
    op: OtaOperation,
    operation: string,
    root: string,
    body: XmlNode,
    expectedRoots: string[],
    ctx: CallContext,
    idempotent: boolean,
  ): Promise<XmlNode> {
    const xml = wrapEnvelope(buildXml(root, body), this.profile.envelope, this.wsseCreds());
    const headers: Record<string, string> = {
      'content-type': this.profile.envelope === 'soap12' ? 'application/soap+xml; charset=utf-8' : 'text/xml; charset=utf-8',
      accept: 'text/xml, application/xml, application/soap+xml',
    };
    const action = this.profile.soapActions?.[op];
    if (action && this.profile.envelope === 'soap11') headers['SOAPAction'] = action;
    if (this.profile.auth.kind === 'http-basic') {
      const u = this.cfg.secrets.get(this.cfg.secretNames.username);
      const p = this.cfg.secrets.get(this.cfg.secretNames.password);
      headers['authorization'] = `Basic ${Buffer.from(`${u}:${p}`).toString('base64')}`;
    }
    const res = await this.cfg.transport.send(
      {
        operation,
        method: 'POST',
        url: joinUrl(this.cfg.baseUrl, this.profile.paths[op]),
        headers,
        body: xml,
        timeoutMs: this.profile.timeoutsMs[op],
        idempotent,
      },
      ctx,
    );
    try {
      return parseOtaResponse(res.body, expectedRoots).node;
    } catch (err) {
      if (err instanceof XmlProtocolError) {
        // For write calls an unreadable answer means we don't know what happened.
        const code: SupplierErrorCode = idempotent ? 'PROTOCOL' : 'OUTCOME_UNKNOWN';
        throw new SupplierError(this.id, code, `${operation}: ${err.message} (HTTP ${res.status})`, { cause: err });
      }
      throw err;
    }
  }

  private errorFrom(errors: { code?: string; message: string }[], operation: string): SupplierError {
    const first = errors[0]!;
    const kinds = errors.map((e) => (e.code ? this.profile.errorMap[e.code] : undefined));
    let code: SupplierErrorCode;
    if (operation === 'book' || operation === 'cancel') {
      // On a write an error answer is a definite "no" only when the profile
      // lists EVERY error code as a rejection. Anything else may hide a
      // booking that was made: the service looks it up instead of guessing.
      const definite = kinds.every((k) => k !== undefined && DEFINITE_REJECTIONS.has(k));
      code = definite ? kinds[0]! : 'OUTCOME_UNKNOWN';
    } else {
      code = kinds[0] ?? 'PROTOCOL';
    }
    return new SupplierError(this.id, code, `${operation}: ${errors.map((e) => `${e.code ?? '?'} ${e.message}`).join('; ')}`, {
      supplierCode: first.code,
    });
  }

  private header(ctx: CallContext): MessageHeader {
    return { echoToken: ctx.requestId, timeStamp: new Date().toISOString() };
  }

  private posCreds(): PosCredentials | undefined {
    if (this.profile.auth.kind !== 'pos-requestor') return undefined;
    return {
      username: this.cfg.secrets.get(this.cfg.secretNames.username),
      password: this.cfg.secrets.get(this.cfg.secretNames.password),
    };
  }

  private wsseCreds(): PosCredentials | undefined {
    if (this.profile.auth.kind !== 'wsse') return undefined;
    return {
      username: this.cfg.secrets.get(this.cfg.secretNames.username),
      password: this.cfg.secrets.get(this.cfg.secretNames.password),
    };
  }
}

/** Error kinds that mean "the supplier refused it, nothing was booked or cancelled". */
const DEFINITE_REJECTIONS: ReadonlySet<SupplierErrorCode> = new Set(['VALIDATION', 'SOLD_OUT', 'RATE_CHANGED', 'AUTH', 'NOT_FOUND']);

function joinUrl(base: string, p: string): string {
  if (!p) return base;
  return `${base.replace(/\/+$/, '')}/${p.replace(/^\/+/, '')}`;
}
