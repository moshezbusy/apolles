import type { OtaVendorProfile } from './ota/profile.js';
import { omnibeesProfile } from './omnibees/profile.js';
import { dingusProfile } from './dingus/profile.js';

/** Every known OTA profile, by the name used in config/suppliers.json. */
export const OTA_PROFILES: Record<string, OtaVendorProfile> = {
  omnibees: omnibeesProfile,
  dingus: dingusProfile,
};
