import { OTA_DEFAULTS, type OtaVendorProfile } from '../ota/profile.js';

/**
 * Omnibees (Brazil/LatAm/Caribbean CRS + channel manager).
 *
 * What is known publicly: Omnibees exposes OpenTravel 2014B messages over
 * SOAP web services (.asmx). Everything else here is a starting point and
 * MUST be checked against the documentation Omnibees sends after the
 * commercial agreement, then `verified` set to true.
 *
 * To confirm with Omnibees during certification:
 *  - base URLs (test / production) and the path of each operation
 *  - SOAP 1.1 vs 1.2 and SOAPAction values
 *  - how credentials are sent (POS RequestorID vs WS-Security)
 *  - whether OTA_ReadRQ can find a booking by OUR UniqueID
 *  - ResID_Type codes for their booking number and the hotel confirmation
 *  - error codes for "no availability" and "booking not found"
 *  - card placement (Guarantee vs DepositPayments) and agency-credit flow
 *  - rate limit and maximum hotels per availability call
 */
export const omnibeesProfile: OtaVendorProfile = {
  ...OTA_DEFAULTS,
  name: 'omnibees-ota2014b',
  verified: false,
  otaVersion: '1.0',
  envelope: 'soap11',
  paths: { avail: '', res: '', read: '', cancel: '' },
  soapActions: {
    avail: 'http://www.opentravel.org/OTA/2003/05/OTA_HotelAvailRQ',
    res: 'http://www.opentravel.org/OTA/2003/05/OTA_HotelResRQ',
    read: 'http://www.opentravel.org/OTA/2003/05/OTA_ReadRQ',
    cancel: 'http://www.opentravel.org/OTA/2003/05/OTA_CancelRQ',
  },
  auth: { kind: 'pos-requestor' },
  capabilities: { multiRoom: false, maxHotelsPerSearch: 20, lookupByClientReference: false, cancel: true },
};
