import { readFile } from 'node:fs/promises';
import { MockSupplierAdapter, type MockHotel } from './adapters/mock/mock-adapter.js';
import { OtaAdapter } from './adapters/ota/ota-adapter.js';
import { TboAdapter } from './adapters/tbo/tbo-adapter.js';
import { HotelbedsAdapter } from './adapters/hotelbeds/hotelbeds-adapter.js';
import type { OtaVendorProfile } from './adapters/ota/profile.js';
import { OTA_PROFILES } from './adapters/profiles.js';
import { NullAlertSink, type AlertSink } from './alerts/alerts.js';
import { DEFAULT_AUDIT_BODY_BYTES, DEFAULT_AUDIT_RETENTION_DAYS, JsonlFileAuditSink, MonitoredAuditSink, type AuditSink } from './audit/audit.js';
import { checkEnvironmentHost, requiredSecretNames, validateConfig } from './config/validate-config.js';
import { HttpTransport } from './http/transport.js';
import { loadMappingDir } from './mapping/mapping.js';
import { NoCardVault, type CardVault } from './security/card-vault.js';
import { EnvSecretProvider, type SecretProvider } from './security/secrets.js';
import { SupplierRegistry } from './service/registry.js';
import { SupplierService, type ServiceOptions } from './service/supplier-service.js';
import { InMemoryBookingStore, type BookingStore } from './store/booking-store.js';
import { InMemoryOfferCache } from './store/offer-cache.js';

export interface SuppliersConfigFile {
  service?: Partial<Pick<ServiceOptions, 'maxPriceIncreasePercent' | 'offerTtlMs' | 'quoteTtlMs' | 'maxReconcileAttempts' | 'onRequestPollIntervalMs' | 'maxOnRequestChecks'>>;
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
    }
  | {
      id: string;
      type: 'tbo';
      enabled: boolean;
      environment: 'test' | 'production';
      /** Not secret: test https://api.tbotechnology.in/TBOHolidays_HotelAPI */
      baseUrl: string;
      /** Set true only after TBO signs off certification. */
      certified: boolean;
      /** Env var NAMES for Basic auth. Omit when a network proxy injects the credential. */
      secrets?: { username: string; password: string };
      agencyEmail: string;
      agencyPhone: string;
      searchTimeoutMs?: number;
    }
  | {
      id: string;
      type: 'hotelbeds';
      enabled: boolean;
      environment: 'test' | 'production';
      /** Not secret: test https://api.test.hotelbeds.com/hotel-api/1.0 */
      baseUrl: string;
      /** Set true only after Hotelbeds signs off certification. */
      certified: boolean;
      /** Env var NAMES of the API key and secret. */
      secrets: { apiKey: string; secret: string };
      /** Evaluation keys allow very few requests per day; keep this low. */
      rateLimitPerSecond?: number;
      searchTimeoutMs?: number;
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
  /** Where "a person must look at this" goes (ALERT_WEBHOOK_URL). */
  alerts?: AlertSink;
  /** For AUDIT_RETENTION_DAYS, AUDIT_MAX_BODY_KB and NODE_ENV. Default: process.env. */
  env?: NodeJS.ProcessEnv;
  log?: (msg: string) => void;
}

export interface Runtime {
  service: SupplierService;
  /** False while the audit log cannot be written (shown in GET /health). */
  auditOk: () => boolean;
  /** Stop background timers (audit retention, offer cache sweep). */
  stop: () => void;
}

export async function createSupplierService(opts: BootstrapOptions): Promise<SupplierService> {
  return (await createRuntime(opts)).service;
}

/**
 * Reads and checks the configuration, then builds the service. Anything
 * wrong (a value of the wrong type, a missing secret, a test host declared
 * as production, an audit directory that cannot be written) stops the start
 * here with a clear message, instead of failing on the first booking.
 */
export async function createRuntime(opts: BootstrapOptions): Promise<Runtime> {
  const env = opts.env ?? process.env;
  const log = opts.log ?? ((m: string) => console.warn(m));
  const config = await readConfig(opts.configPath);
  const secrets = opts.secrets ?? new EnvSecretProvider();
  const vault = opts.vault ?? new NoCardVault();
  const alerts = opts.alerts ?? new NullAlertSink();

  // Every enabled supplier must be complete before we accept a single request.
  for (const s of config.suppliers) {
    if (!s.enabled || s.type === 'mock') continue;
    for (const name of requiredSecretNames(s)) {
      if (!secrets.has(name) || secrets.get(name) === '') {
        throw new Error(`Supplier ${s.id}: missing secret ${name}. Set it in the environment, or set "enabled": false for this supplier.`);
      }
    }
    checkEnvironmentHost(s.id, s.environment, s.type === 'ota' ? secrets.get(s.baseUrlEnv) : s.baseUrl);
  }

  const stops: (() => void)[] = [];
  let fileSink: JsonlFileAuditSink | undefined;
  if (!opts.audit) {
    fileSink = new JsonlFileAuditSink(opts.auditDir, { retentionDays: positiveNumber(env, 'AUDIT_RETENTION_DAYS', DEFAULT_AUDIT_RETENTION_DAYS) });
    await fileSink.init(); // throws a clear error when the directory cannot be created
    stops.push(fileSink.startRetention());
  }
  const audit = new MonitoredAuditSink(opts.audit ?? fileSink!, {
    onFailure: () => alerts.send({ event: 'AUDIT_WRITE_FAILED', reason: 'the audit log cannot be written; supplier calls are not being recorded' }),
  });
  const auditMaxBodyBytes = Math.round(positiveNumber(env, 'AUDIT_MAX_BODY_KB', DEFAULT_AUDIT_BODY_BYTES / 1024) * 1024);
  const registry = new SupplierRegistry();

  for (const s of config.suppliers) {
    if (s.type === 'mock') {
      if (s.enabled && env['NODE_ENV'] === 'production') {
        throw new Error(`Supplier ${s.id}: the mock supplier cannot be enabled in production`);
      }
      registry.register(new MockSupplierAdapter(s.id, s.hotels), { enabled: s.enabled, searchTimeoutMs: s.searchTimeoutMs });
      continue;
    }
    if (!s.enabled) continue; // don't require credentials for suppliers that are off
    if (s.type === 'tbo') {
      const transport = new HttpTransport({ supplierId: s.id, audit, auditMaxBodyBytes, rateLimitPerSecond: 5, maxAttempts: 2 });
      registry.register(
        new TboAdapter({
          id: s.id, baseUrl: s.baseUrl, environment: s.environment, certified: s.certified, transport,
          secretNames: s.secrets, secrets, agencyEmail: s.agencyEmail, agencyPhone: s.agencyPhone,
        }),
        { enabled: true, searchTimeoutMs: s.searchTimeoutMs ?? 25_000 },
      );
      continue;
    }
    if (s.type === 'hotelbeds') {
      const transport = new HttpTransport({ supplierId: s.id, audit, auditMaxBodyBytes, rateLimitPerSecond: s.rateLimitPerSecond ?? 4, maxAttempts: 2 });
      registry.register(
        new HotelbedsAdapter({
          id: s.id, baseUrl: s.baseUrl, environment: s.environment, certified: s.certified, transport,
          secretNames: s.secrets, secrets,
        }),
        { enabled: true, searchTimeoutMs: s.searchTimeoutMs ?? 22_000 },
      );
      continue;
    }
    const base = OTA_PROFILES[s.profile];
    if (!base) throw new Error(`Supplier ${s.id}: unknown profile "${s.profile}"`);
    const profile = mergeProfile(base, s.profileOverrides);
    const baseUrl = secrets.get(s.baseUrlEnv);
    const transport = new HttpTransport({ supplierId: s.id, audit, auditMaxBodyBytes, rateLimitPerSecond: profile.rateLimitPerSecond });
    registry.register(
      new OtaAdapter({ id: s.id, profile, baseUrl, environment: s.environment, secretNames: s.secrets, transport, secrets, vault }),
      { enabled: true, searchTimeoutMs: s.searchTimeoutMs },
    );
  }

  const mapping = await loadMappingDir(opts.mappingDir);
  for (const s of registry.all()) {
    if (s.settings.enabled && mapping.hotelCount(s.adapter.id) === 0) {
      log(`Supplier ${s.adapter.id} is enabled but has no mapped hotels in ${opts.mappingDir}: its searches will return nothing`);
    }
  }
  const cache = new InMemoryOfferCache();
  stops.push(() => cache.dispose());
  const service = new SupplierService(registry, mapping, opts.bookings ?? new InMemoryBookingStore(), cache, { ...(config.service ?? {}), alerts, log });
  return { service, auditOk: () => audit.ok, stop: () => stops.forEach((stop) => stop()) };
}

async function readConfig(path: string): Promise<SuppliersConfigFile> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (err) {
    throw new Error(`Config ${path} cannot be read: ${err instanceof Error ? err.message : String(err)}`);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    throw new Error(`Config ${path} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`);
  }
  return validateConfig(raw, path);
}

/** An env var that must be a number above 0 when set. "abc" stops the start instead of becoming NaN. */
function positiveNumber(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`${name} must be a number above 0, got "${raw}"`);
  return n;
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
