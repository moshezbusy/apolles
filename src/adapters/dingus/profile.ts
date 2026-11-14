import { OTA_DEFAULTS, type OtaVendorProfile } from '../ota/profile.js';

/**
 * Dingus (Spain/Balearics/Caribbean hotel CRS, channel manager, BookinCenter).
 *
 * Dingus does not publish its distribution API. This profile assumes the
 * common OTA-over-XML pattern and MUST be filled in from the spec Dingus
 * sends after the agreement. If their API turns out not to be OTA, write a
 * dedicated adapter in this folder implementing SupplierAdapter instead;
 * the rest of Apolles does not change.
 *
 * To confirm with Dingus during certification: same list as Omnibees
 * (see ../omnibees/profile.ts).
 */
export const dingusProfile: OtaVendorProfile = {
  ...OTA_DEFAULTS,
  name: 'dingus-ota',
  verified: false,
  envelope: 'plain',
  paths: { avail: '', res: '', read: '', cancel: '' },
  auth: { kind: 'pos-requestor' },
  capabilities: { multiRoom: false, maxHotelsPerSearch: 20, lookupByClientReference: false, cancel: true },
};
