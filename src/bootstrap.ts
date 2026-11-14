import { readFile } from 'node:fs/promises';
import { MockSupplierAdapter, type MockHotel } from './adapters/mock/mock-adapter.js';
import { OtaAdapter } from './adapters/ota/ota-adapter.js';
import type { OtaVendorProfile } from './adapters/ota/profile.js';
import { OTA_PROFILES } from './adapters/profiles.js';
import { JsonlFileAuditSink, type AuditSink } from './audit/audit.js';
import { HttpTransport } from './http/transport.js';
import { loadMappingDir } from './mapping/mapping.js';
import { NoCardVault, type CardVault } from './security/card-vault.js';
import { EnvSecretProvider, type SecretProvider } from './security/secrets.js';
import { SupplierRegistry } from './service/registry.js';
import { SupplierService, type ServiceOptions } from './service/supplier-service.js';
import { InMemoryBookingStore, type BookingStore } from './store/booking-store.js';
import { InMemoryOfferCache } from './store/offer-cache.js';

export interface SuppliersConfigFile {
  service?: Partial<Pick<ServiceOptions, 'maxPriceIncreasePercent' | 'offerTtlMs' | 'quoteTtlMs' | 'maxReconcileAttempts'>>;
  suppliers: SupplierConfig[];
}

export type SupplierConfig =
  | { id: string; type: 'mock'; enabled: boolean; searchTimeoutMs?: number; hotels: MockHotel[] }
  | {
      id: string;
      type: 'ota';
      /** Key in OTA_PROFILES (omnibees, dingus, ...). */
      profile: string;
      enabled: boolean;
      environment: 'test' | 'production';
      /** Env var holding the base URL (kept out of the repo). */
      baseUrlEnv: string;
      /** Env var NAMES holding the credentials. */
      secrets: { username: string; password: string };
      searchTimeoutMs?: number;
      /** Facts learned in certification, applied on top of the profile. */
      profileOverrides?: DeepPartial<OtaVendorProfile>;
    };

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

export interface BootstrapOptions {
  configPath: string;
  mappingDir: string;
  auditDir: string;
  secrets?: SecretProvider;
  vault?: CardVault;
  bookings?: BookingStore;
  audit?: AuditSink;
}

export async function createSupplierService(opts: BootstrapOptions): Promise<SupplierService> {
  const config = JSON.parse(await readFile(opts.configPath, 'utf8')) as SuppliersConfigFile;
  const secrets = opts.secrets ?? new EnvSecretProvider();
  const vault = opts.vault ?? new NoCardVault();
  const audit = opts.audit ?? new JsonlFileAuditSink(opts.auditDir);
  const registry = new SupplierRegistry();

  for (const s of config.suppliers) {
    if (s.type === 'mock') {
      if (s.enabled && process.env['NODE_ENV'] === 'production') {
        throw new Error(`Supplier ${s.id}: the mock supplier cannot be enabled in production`);
      }
      registry.register(new MockSupplierAdapter(s.id, s.hotels), { enabled: s.enabled, searchTimeoutMs: s.searchTimeoutMs });
      continue;
    }
    if (!s.enabled) continue; // don't require credentials for suppliers that are off
    const base = OTA_PROFILES[s.profile];
    if (!base) throw new Error(`Supplier ${s.id}: unknown profile "${s.profile}"`);
    const profile = mergeProfile(base, s.profileOverrides);
    const baseUrl = secrets.get(s.baseUrlEnv);
    const transport = new HttpTransport({ supplierId: s.id, audit, rateLimitPerSecond: profile.rateLimitPerSecond });
    registry.register(
      new OtaAdapter({ id: s.id, profile, baseUrl, environment: s.environment, secretNames: s.secrets, transport, secrets, vault }),
      { enabled: true, searchTimeoutMs: s.searchTimeoutMs },
    );
  }

  const mapping = await loadMappingDir(opts.mappingDir);
  return new SupplierService(registry, mapping, opts.bookings ?? new InMemoryBookingStore(), new InMemoryOfferCache(), config.service ?? {});
}

export function mergeProfile(base: OtaVendorProfile, o?: DeepPartial<OtaVendorProfile>): OtaVendorProfile {
  if (!o) return base;
  return {
    ...base,
    ...(o as Partial<OtaVendorProfile>),
    paths: { ...base.paths, ...(o.paths ?? {}) },
    soapActions: { ...(base.soapActions ?? {}), ...(o.soapActions ?? {}) },
    capabilities: { ...base.capabilities, ...(o.capabilities ?? {}) },
    timeoutsMs: { ...base.timeoutsMs, ...(o.timeoutsMs ?? {}) },
    errorMap: { ...base.errorMap, ...((o.errorMap ?? {}) as OtaVendorProfile['errorMap']) },
    auth: (o.auth as OtaVendorProfile['auth']) ?? base.auth,
    noAvailabilityErrorCodes: (o.noAvailabilityErrorCodes as string[]) ?? base.noAvailabilityErrorCodes,
    notFoundErrorCodes: (o.notFoundErrorCodes as string[]) ?? base.notFoundErrorCodes,
  };
}
