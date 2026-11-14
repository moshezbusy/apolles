import { moneyFromDecimal, type Money } from '../../core/money.js';
import type { SupplierBookingResult, SupplierCancelResult, SupplierOffer, SupplierSearchRequest } from '../../core/supplier.js';
import type { BoardCode, CancellationPenalty, CancellationPolicy, Guest, Holder, Occupancy } from '../../core/types.js';
import type { CardDetails } from '../../security/card-vault.js';
import { OTA_NS, attr, child, children, path, text, type XmlNode } from './codec.js';
import type { OtaVendorProfile } from './profile.js';

/** OTA AgeQualifyingCode: 10 = adult, 8 = child. */
const AQC_ADULT = '10';
const AQC_CHILD = '8';

export interface PosCredentials {
  username: string;
  password: string;
}

export interface MessageHeader {
  echoToken: string;
  timeStamp: string;
}

function rootAttrs(profile: OtaVendorProfile, h: MessageHeader): XmlNode {
  return {
    '@_xmlns': OTA_NS,
    '@_Version': profile.otaVersion,
    '@_EchoToken': h.echoToken.slice(0, 128),
    '@_TimeStamp': h.timeStamp,
    '@_PrimaryLangID': 'en',
  };
}

function pos(profile: OtaVendorProfile, creds?: PosCredentials): XmlNode | undefined {
  if (profile.auth.kind !== 'pos-requestor' || !creds) return undefined;
  const requestor: XmlNode = {
    '@_ID': creds.username,
    '@_MessagePassword': creds.password,
  };
  if (profile.auth.requestorType) requestor['@_Type'] = profile.auth.requestorType;
  if (profile.auth.companyCode) requestor['CompanyName'] = { '@_Code': profile.auth.companyCode };
  return { Source: { RequestorID: requestor } };
}

function guestCounts(o: Occupancy): XmlNode {
  const counts: XmlNode[] = [{ '@_AgeQualifyingCode': AQC_ADULT, '@_Count': String(o.adults) }];
  for (const age of o.childrenAges) counts.push({ '@_AgeQualifyingCode': AQC_CHILD, '@_Age': String(age), '@_Count': '1' });
  return { GuestCount: counts };
}

// ------------------------------------------------------------ availability

export function buildAvailRQ(
  profile: OtaVendorProfile,
  h: MessageHeader,
  req: SupplierSearchRequest,
  creds?: PosCredentials,
  ratePlanCode?: string,
): XmlNode {
  const segment: XmlNode = {
    StayDateRange: { '@_Start': req.checkIn, '@_End': req.checkOut },
    RoomStayCandidates: {
      RoomStayCandidate: req.rooms.map((o, i) => ({ '@_RPH': String(i + 1), '@_Quantity': '1', GuestCounts: guestCounts(o) })),
    },
    HotelSearchCriteria: {
      Criterion: req.supplierHotelCodes.map((code) => ({ HotelRef: { '@_HotelCode': code } })),
    },
  };
  if (ratePlanCode) segment['RatePlanCandidates'] = { RatePlanCandidate: [{ '@_RatePlanCode': ratePlanCode }] };
  return {
    ...rootAttrs(profile, h),
    '@_RequestedCurrency': req.currency,
    POS: pos(profile, creds),
    AvailRequestSegments: { AvailRequestSegment: segment },
  };
}

export function parseAvailRS(
  profile: OtaVendorProfile,
  rs: XmlNode,
  req: { checkIn: string; checkOut: string; rooms: Occupancy[] },
): SupplierOffer[] {
  const offers: SupplierOffer[] = [];
  const nights = Math.round((Date.parse(req.checkOut) - Date.parse(req.checkIn)) / 86_400_000);

  for (const stay of path(rs, 'RoomStays', 'RoomStay')) {
    const hotelCode = attr(child(stay, 'BasicPropertyInfo'), 'HotelCode');
    if (!hotelCode) continue;

    const roomNames = new Map<string, string>();
    for (const rt of path(stay, 'RoomTypes', 'RoomType')) {
      const code = attr(rt, 'RoomTypeCode');
      if (!code) continue;
      const desc = child(rt, 'RoomDescription');
      roomNames.set(code, attr(desc, 'Name') ?? text(child(desc, 'Text')) ?? attr(rt, 'RoomType') ?? code);
    }

    const plans = new Map<string, XmlNode>();
    for (const rp of path(stay, 'RatePlans', 'RatePlan')) {
      const code = attr(rp, 'RatePlanCode');
      if (code) plans.set(code, rp);
    }

    const rates = path(stay, 'RoomRates', 'RoomRate');
    const groups = new Map<string, XmlNode[]>();
    for (const rr of rates) {
      const key = `${attr(rr, 'RatePlanCode') ?? ''}|${attr(rr, 'RoomTypeCode') ?? ''}`;
      groups.set(key, [...(groups.get(key) ?? []), rr]);
    }

    for (const [key, group] of groups) {
      const [ratePlanCode = '', roomTypeCode = ''] = key.split('|');
      if (!ratePlanCode || !roomTypeCode) continue;
      const perRoom = assignRooms(group, req.rooms.length);
      if (!perRoom) continue;

      const totals = perRoom.map((rr) => rateTotal(rr));
      if (totals.some((t) => !t)) continue;
      const currency = totals[0]!.money.currency;
      if (totals.some((t) => t!.money.currency !== currency)) continue;
      const total: Money = { minor: totals.reduce((s, t) => s + t!.money.minor, 0), currency };
      const taxesIncluded = totals.every((t) => t!.afterTax);

      const plan = plans.get(ratePlanCode);
      const meals = child(plan, 'MealsIncluded');
      const boardRaw = attr(meals, 'MealPlanCodes') ?? attr(meals, 'MealPlanIndicator');
      offers.push({
        supplierHotelCode: hotelCode,
        ratePlanCode,
        ratePlanName: attr(plan, 'RatePlanName'),
        rooms: perRoom.map((_, i) => ({
          occupancyIndex: i,
          supplierRoomCode: roomTypeCode,
          roomName: roomNames.get(roomTypeCode) ?? roomTypeCode,
        })),
        board: boardFromMeals(meals),
        boardRaw,
        total,
        taxesIncluded,
        paymentModel: paymentModel(plan, profile),
        cancellation: parseCancelPenalties(path(plan, 'CancelPenalties', 'CancelPenalty'), total, nights, req.checkIn),
        remarks: path(plan, 'RatePlanDescription', 'Text').map((t) => text(t)).filter((t): t is string => !!t),
        supplierData: {
          roomTypeCode,
          ratePlanCode,
          ...(attr(stay, 'RPH') ? { roomStayRPH: attr(stay, 'RPH')! } : {}),
          ...(attr(group[0], 'BookingCode') ? { bookingCode: attr(group[0], 'BookingCode')! } : {}),
        },
      });
    }
  }
  return offers;
}

/**
 * Pick one RoomRate per requested room. Single room: any one rate. Multi
 * room: rates must say which RoomStayCandidate (RPH) they belong to.
 */
function assignRooms(group: XmlNode[], roomCount: number): XmlNode[] | undefined {
  if (roomCount === 1) return [group[0]!];
  const byRph = new Map<string, XmlNode>();
  for (const rr of group) {
    const rph = attr(rr, 'RoomStayCandidateRPH');
    if (rph && !byRph.has(rph)) byRph.set(rph, rr);
  }
  const out: XmlNode[] = [];
  for (let i = 1; i <= roomCount; i++) {
    const rr = byRph.get(String(i));
    if (!rr) return undefined;
    out.push(rr);
  }
  return out;
}

function rateTotal(rr: XmlNode): { money: Money; afterTax: boolean } | undefined {
  const total = child(rr, 'Total') ?? child(child(child(rr, 'Rates'), 'Rate'), 'Total');
  if (!total) return undefined;
  const after = attr(total, 'AmountAfterTax');
  const before = attr(total, 'AmountBeforeTax');
  const currency = attr(total, 'CurrencyCode');
  const amount = after ?? before;
  if (!amount || !currency) return undefined;
  return { money: otaAmount(amount, attr(total, 'DecimalPlaces'), currency), afterTax: after !== undefined };
}

/**
 * OTA amounts may be sent as "500.00" or as "50000" with DecimalPlaces="2".
 */
export function otaAmount(value: string, decimalPlaces: string | undefined, currency: string): Money {
  if (decimalPlaces !== undefined && !value.includes('.')) {
    const dp = Number(decimalPlaces);
    if (Number.isInteger(dp) && dp > 0) {
      const neg = value.startsWith('-');
      const digits = (neg ? value.slice(1) : value).padStart(dp + 1, '0');
      return moneyFromDecimal(`${neg ? '-' : ''}${digits.slice(0, -dp)}.${digits.slice(-dp)}`, currency);
    }
  }
  return moneyFromDecimal(value, currency);
}

/** OTA Meal Plan Type (MPT) code list -> our board. */
const MPT: Record<string, BoardCode> = {
  '1': 'AI', '3': 'BB', '4': 'BB', '5': 'BB', '6': 'BB', '7': 'BB', '11': 'BB', '19': 'BB',
  '10': 'FB', '12': 'HB', '17': 'HB', '14': 'RO', '8': 'RO', '15': 'RO',
};

export function boardFromMeals(meals: XmlNode | undefined): BoardCode | undefined {
  if (!meals) return undefined;
  if (attr(meals, 'AllInclusive') === 'true' || attr(meals, 'AllInclusive') === '1') return 'AI';
  const codes = (attr(meals, 'MealPlanCodes') ?? '').split(/\s+/).filter(Boolean);
  for (const c of codes) {
    const b = MPT[c];
    if (b) return b;
  }
  const flag = (n: string) => attr(meals, n) === 'true' || attr(meals, n) === '1';
  const b = flag('Breakfast');
  const l = flag('Lunch');
  const d = flag('Dinner');
  if (b && l && d) return 'FB';
  if (b && (l || d)) return 'HB';
  if (b) return 'BB';
  if (attr(meals, 'Breakfast') === 'false' && !l && !d) return 'RO';
  return undefined; // let the mapping file decide from the raw code
}

function paymentModel(plan: XmlNode | undefined, profile: OtaVendorProfile): 'PREPAID' | 'PAY_AT_HOTEL' {
  const g = attr(child(plan, 'Guarantee'), 'GuaranteeType')?.toLowerCase();
  if (g === 'prepay' || g === 'deposit' || g === 'payment') return 'PREPAID';
  if (g === 'guaranteerequired' || g === 'none' || g === 'cc/dc/voucher') return 'PAY_AT_HOTEL';
  return profile.defaultPaymentModel;
}

export function parseCancelPenalties(
  nodes: XmlNode[],
  total: Money,
  nights: number,
  checkIn: string,
): CancellationPolicy {
  const penalties: CancellationPenalty[] = [];
  const texts: string[] = [];
  let refundable = true;

  for (const p of nodes) {
    if (attr(p, 'NonRefundable') === 'true' || attr(p, 'NonRefundable') === '1') refundable = false;
    for (const d of children(p, 'PenaltyDescription')) {
      const t = path(d, 'Text').map(text).filter(Boolean).join(' ') || text(d);
      if (t) texts.push(t);
    }
    const from = deadline(child(p, 'Deadline'), checkIn);
    const ap = child(p, 'AmountPercent');
    let amount: Money | undefined;
    if (ap) {
      const a = attr(ap, 'Amount');
      const pct = attr(ap, 'Percent');
      const n = attr(ap, 'NmbrOfNights');
      if (a) amount = otaAmount(a, attr(ap, 'DecimalPlaces'), attr(ap, 'CurrencyCode') ?? total.currency);
      else if (pct) amount = { minor: Math.round((total.minor * Number(pct)) / 100), currency: total.currency };
      else if (n && nights > 0) amount = { minor: Math.round((total.minor / nights) * Math.min(Number(n), nights)), currency: total.currency };
    }
    if (!refundable && !from) {
      penalties.push({ from: new Date(0).toISOString(), amount: amount ?? total });
    } else if (from && amount) {
      penalties.push({ from, amount });
    }
  }
  penalties.sort((a, b) => a.from.localeCompare(b.from));
  return { refundable, penalties, text: texts.join(' ') || undefined };
}

/** Absolute deadline, or an offset like "3 days before arrival". */
function deadline(d: XmlNode | undefined, checkIn: string): string | undefined {
  if (!d) return undefined;
  const abs = attr(d, 'AbsoluteDeadline');
  if (abs) {
    const t = Date.parse(/[zZ]|[+-]\d\d:\d\d$/.test(abs) ? abs : `${abs}Z`);
    return Number.isNaN(t) ? undefined : new Date(t).toISOString();
  }
  const unit = attr(d, 'OffsetTimeUnit');
  const mult = Number(attr(d, 'OffsetUnitMultiplier') ?? '0');
  if (!unit || !Number.isFinite(mult)) return undefined;
  const ms = unit.toLowerCase().startsWith('hour') ? mult * 3_600_000 : unit.toLowerCase().startsWith('day') ? mult * 86_400_000 : NaN;
  if (Number.isNaN(ms)) return undefined;
  // Hotel local time is unknown here; arrival is taken as 00:00 UTC (conservative for most destinations).
  return new Date(Date.parse(`${checkIn}T00:00:00Z`) - ms).toISOString();
}

// -------------------------------------------------------------- reservation

export interface ResInput {
  clientReference: string;
  supplierHotelCode: string;
  ratePlanCode: string;
  roomTypeCodes: string[];
  checkIn: string;
  checkOut: string;
  occupancy: Occupancy[];
  total: Money;
  totalDecimal: string;
  holder: Holder;
  guests: Guest[][];
  specialRequests?: string;
  card?: CardDetails;
  bookingCode?: string;
}

export function buildResRQ(profile: OtaVendorProfile, h: MessageHeader, input: ResInput, creds?: PosCredentials): XmlNode {
  let rph = 0;
  const resGuests: XmlNode[] = [];
  const roomStays: XmlNode[] = input.occupancy.map((o, i) => {
    const guestRphs: XmlNode[] = [];
    for (const g of input.guests[i] ?? []) {
      rph += 1;
      guestRphs.push({ '@_RPH': String(rph) });
      const customer: XmlNode = { PersonName: { GivenName: g.firstName, Surname: g.lastName } };
      resGuests.push({
        '@_ResGuestRPH': String(rph),
        '@_AgeQualifyingCode': g.type === 'CHILD' ? AQC_CHILD : AQC_ADULT,
        ...(g.type === 'CHILD' && g.age !== undefined ? { '@_Age': String(g.age) } : {}),
        Profiles: { ProfileInfo: { Profile: { Customer: customer } } },
      });
    }
    const roomRate: XmlNode = { '@_RoomTypeCode': input.roomTypeCodes[i], '@_RatePlanCode': input.ratePlanCode, '@_NumberOfUnits': '1' };
    if (input.bookingCode) roomRate['@_BookingCode'] = input.bookingCode;
    return {
      RoomTypes: { RoomType: [{ '@_RoomTypeCode': input.roomTypeCodes[i] }] },
      RatePlans: { RatePlan: [{ '@_RatePlanCode': input.ratePlanCode }] },
      RoomRates: { RoomRate: [roomRate] },
      GuestCounts: guestCounts(o),
      TimeSpan: { '@_Start': input.checkIn, '@_End': input.checkOut },
      BasicPropertyInfo: { '@_HotelCode': input.supplierHotelCode },
      ResGuestRPHs: { ResGuestRPH: guestRphs },
    };
  });

  const holderCustomer: XmlNode = {
    PersonName: { GivenName: input.holder.firstName, Surname: input.holder.lastName },
    ...(input.holder.phone ? { Telephone: { '@_PhoneNumber': input.holder.phone } } : {}),
    ...(input.holder.email ? { Email: input.holder.email } : {}),
  };

  const globalInfo: XmlNode = {
    Total: { '@_AmountAfterTax': input.totalDecimal, '@_CurrencyCode': input.total.currency },
    Profiles: { ProfileInfo: { Profile: { '@_ProfileType': '1', Customer: holderCustomer } } },
  };
  if (input.specialRequests) {
    globalInfo['Comments'] = { Comment: [{ Text: input.specialRequests }] };
  }
  if (input.card) {
    const card: XmlNode = {
      '@_CardCode': input.card.brandCode,
      '@_CardNumber': input.card.number,
      '@_ExpireDate': input.card.expiry,
      ...(input.card.cvc ? { '@_SeriesCode': input.card.cvc } : {}),
      CardHolderName: input.card.holderName,
    };
    if (profile.cardPlacement === 'deposit') {
      globalInfo['DepositPayments'] = {
        GuaranteePayment: { AcceptedPayments: { AcceptedPayment: { PaymentCard: card } } },
      };
    } else {
      globalInfo['Guarantee'] = { GuaranteesAccepted: { GuaranteeAccepted: { PaymentCard: card } } };
    }
  }

  return {
    ...rootAttrs(profile, h),
    '@_ResStatus': profile.bookResStatus,
    POS: pos(profile, creds),
    HotelReservations: {
      HotelReservation: [
        {
          UniqueID: [{ '@_Type': profile.clientRefUniqueIdType, '@_ID': input.clientReference, '@_ID_Context': profile.clientRefIdContext }],
          RoomStays: { RoomStay: roomStays },
          ResGuests: { ResGuest: resGuests },
          ResGlobalInfo: globalInfo,
        },
      ],
    },
  };
}

const CONFIRMED = new Set(['commit', 'book', 'booked', 'confirmed', 'reserved', 'modify']);
const ON_REQUEST = new Set(['pending', 'requested', 'onrequest', 'on request', 'waitlisted', 'initiate']);
const CANCELLED = new Set(['cancel', 'cancelled', 'canceled']);

/** Reads a HotelReservation node (from OTA_HotelResRS or a read response). */
export function parseHotelReservation(profile: OtaVendorProfile, res: XmlNode, clientReference: string): SupplierBookingResult {
  const ids = path(res, 'ResGlobalInfo', 'HotelReservationIDs', 'HotelReservationID');
  const byType = (t: string) => ids.find((i) => attr(i, 'ResID_Type') === t);
  const uniqueIds = children(res, 'UniqueID');
  const supplierUnique = uniqueIds.find((u) => attr(u, 'ID') && attr(u, 'ID') !== clientReference);

  const supplierBookingRef = attr(byType(profile.supplierRefResIdType), 'ResID_Value') ?? attr(supplierUnique, 'ID');
  const hotelConfirmationNumber = attr(byType(profile.hotelConfirmationResIdType), 'ResID_Value');

  const statusRaw = (attr(res, 'ResStatus') ?? '').toLowerCase();
  let status: SupplierBookingResult['status'] = 'CONFIRMED';
  if (CANCELLED.has(statusRaw)) status = 'CANCELLED';
  else if (ON_REQUEST.has(statusRaw)) status = 'ON_REQUEST';
  else if (statusRaw && !CONFIRMED.has(statusRaw)) status = 'PENDING';

  const totalNode = child(child(res, 'ResGlobalInfo'), 'Total');
  const amount = attr(totalNode, 'AmountAfterTax') ?? attr(totalNode, 'AmountBeforeTax');
  const currency = attr(totalNode, 'CurrencyCode');
  const total = amount && currency ? otaAmount(amount, attr(totalNode, 'DecimalPlaces'), currency) : undefined;

  return { status, supplierBookingRef, hotelConfirmationNumber, total, message: statusRaw || undefined };
}

// ---------------------------------------------------------- read / cancel

export interface RefInput {
  clientReference: string;
  supplierBookingRef?: string;
  holderLastName?: string;
}

function uniqueIdsFor(profile: OtaVendorProfile, r: RefInput): XmlNode[] {
  const ids: XmlNode[] = [];
  if (r.supplierBookingRef) ids.push({ '@_Type': profile.supplierRefResIdType, '@_ID': r.supplierBookingRef });
  ids.push({ '@_Type': profile.clientRefUniqueIdType, '@_ID': r.clientReference, '@_ID_Context': profile.clientRefIdContext });
  return ids;
}

export function buildReadRQ(profile: OtaVendorProfile, h: MessageHeader, r: RefInput, creds?: PosCredentials): XmlNode {
  return {
    ...rootAttrs(profile, h),
    POS: pos(profile, creds),
    ReadRequests: {
      ReadRequest: {
        UniqueID: uniqueIdsFor(profile, r).slice(0, 1),
        ...(r.holderLastName ? { Verification: { PersonName: { Surname: r.holderLastName } } } : {}),
      },
    },
  };
}

export function buildCancelRQ(profile: OtaVendorProfile, h: MessageHeader, r: RefInput, creds?: PosCredentials): XmlNode {
  return {
    ...rootAttrs(profile, h),
    '@_CancelType': 'Commit',
    POS: pos(profile, creds),
    UniqueID: uniqueIdsFor(profile, r),
    ...(r.holderLastName ? { Verification: { PersonName: { Surname: r.holderLastName } } } : {}),
  };
}

export function parseCancelRS(rs: XmlNode, fallbackCurrency?: string): SupplierCancelResult {
  const status = (attr(rs, 'Status') ?? '').toLowerCase();
  const info = child(rs, 'CancelInfoRS');
  const ref = attr(children(info, 'UniqueID')[0], 'ID');
  const rule = path(info, 'CancelRules', 'CancelRule')[0];
  const amt = attr(rule, 'Amount');
  const feeCurrency = attr(rule, 'CurrencyCode') ?? fallbackCurrency;
  const fee = amt && feeCurrency ? otaAmount(amt, attr(rule, 'DecimalPlaces'), feeCurrency) : undefined;
  const cancelled = CANCELLED.has(status) || (status === '' && child(rs, 'Success') !== undefined);
  return { cancelled, cancellationRef: ref, fee, message: status || undefined };
}

export interface OtaErrorInfo {
  code?: string;
  type?: string;
  message: string;
}

export function otaErrors(rs: XmlNode): OtaErrorInfo[] {
  return path(rs, 'Errors', 'Error').map((e) => ({
    code: attr(e, 'Code'),
    type: attr(e, 'Type'),
    message: attr(e, 'ShortText') ?? text(e) ?? 'error',
  }));
}

export function isSuccess(rs: XmlNode): boolean {
  return child(rs, 'Success') !== undefined && otaErrors(rs).length === 0;
}
