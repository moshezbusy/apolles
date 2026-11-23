import type { SupplierErrorCode } from '../../core/errors.js';

/**
 * Omnibees, Dingus, SynXis, DerbySoft, TravelClick and many hotel CRSs all
 * speak dialects of the OpenTravel (OTA) hotel messages. The differences
 * live in a profile, not in code. A new OTA-based supplier = a new profile
 * filled in from that supplier's documentation during certification.
 */
export interface OtaVendorProfile {
  name: string;
  /**
   * false until every field below was checked against the vendor's own
   * documentation and their test environment. The server refuses to send
   * live (production) traffic through an unverified profile.
   */
  verified: boolean;
  /** Value of the OTA Version attribute the vendor expects. */
  otaVersion: string;
  envelope: 'plain' | 'soap11' | 'soap12';
  /** Path per operation, appended to the base URL from config. */
  paths: { avail: string; res: string; read: string; cancel: string };
  /** SOAPAction header per operation (SOAP 1.1 only). */
  soapActions?: Partial<Record<OtaOperation, string>>;
  auth: OtaAuthMode;
  /** OTA UniqueID Type used to send OUR booking reference. 14 = Reservation in OTA code list UIT. */
  clientRefUniqueIdType: string;
  /** ID_Context sent with our reference. */
  clientRefIdContext: string;
  /** HotelReservationID ResID_Type that carries the supplier's booking number. */
  supplierRefResIdType: string;
  /** HotelReservationID ResID_Type that carries the hotel's confirmation number. */
  hotelConfirmationResIdType: string;
  /** ResStatus sent when booking. */
  bookResStatus: string;
  /** Where card data goes in the reservation message. */
  cardPlacement: 'guarantee' | 'deposit';
  /** How agency credit is expressed. 'none' sends no payment element. */
  agencyCreditPayment: 'none';
  /** Default when a rate plan does not say. */
  defaultPaymentModel: 'PREPAID' | 'PAY_AT_HOTEL';
  capabilities: {
    multiRoom: boolean;
    maxHotelsPerSearch: number;
    /** Supplier can read a booking by our UniqueID (needed for safe timeout handling). */
    lookupByClientReference: boolean;
    cancel: boolean;
  };
  timeoutsMs: Record<OtaOperation, number>;
  /** Max requests per second allowed by the supplier. */
  rateLimitPerSecond: number;
  /** OTA error codes that mean "no rooms" on availability (return empty, not an error). */
  noAvailabilityErrorCodes: string[];
  /** OTA error codes that mean "booking not found" on read. */
  notFoundErrorCodes: string[];
  /**
   * Vendor error codes -> our error kinds. On book and cancel this is also
   * the list of definite rejections: only an answer whose codes are all
   * mapped here to VALIDATION, SOLD_OUT, RATE_CHANGED, AUTH or NOT_FOUND is
   * a definite "no". Every other error answer is OUTCOME_UNKNOWN.
   */
  errorMap: Record<string, SupplierErrorCode>;
}

export type OtaOperation = 'avail' | 'res' | 'read' | 'cancel';

export type OtaAuthMode =
  /** OTA standard: <POS><Source><RequestorID ID=user MessagePassword=pass/></Source></POS> */
  | { kind: 'pos-requestor'; requestorType?: string; companyCode?: string }
  /** HTTP Basic header. */
  | { kind: 'http-basic' }
  /** WS-Security UsernameToken in the SOAP header. */
  | { kind: 'wsse' };

export const OTA_DEFAULTS: Omit<OtaVendorProfile, 'name' | 'paths' | 'auth'> = {
  verified: false,
  otaVersion: '1.0',
  envelope: 'plain',
  clientRefUniqueIdType: '14',
  clientRefIdContext: 'APOLLES',
  supplierRefResIdType: '14',
  hotelConfirmationResIdType: '10',
  bookResStatus: 'Commit',
  cardPlacement: 'guarantee',
  agencyCreditPayment: 'none',
  defaultPaymentModel: 'PREPAID',
  capabilities: { multiRoom: false, maxHotelsPerSearch: 20, lookupByClientReference: false, cancel: true },
  timeoutsMs: { avail: 8_000, res: 60_000, read: 15_000, cancel: 30_000 },
  rateLimitPerSecond: 5,
  noAvailabilityErrorCodes: [],
  notFoundErrorCodes: [],
  errorMap: {},
};
