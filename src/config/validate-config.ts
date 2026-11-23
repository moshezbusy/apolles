import type { SupplierConfig, SuppliersConfigFile } from '../bootstrap.js';

/**
 * Checks config/suppliers.json at startup. A wrong value must stop the
 * start with a message that names it. The alternative is worse: a price
 * tolerance of "5%" (text) silently switched the price guard off.
 */

type Obj = Record<string, unknown>;

const SERVICE_KEYS = ['maxPriceIncreasePercent', 'offerTtlMs', 'quoteTtlMs', 'maxReconcileAttempts', 'onRequestPollIntervalMs', 'maxOnRequestChecks'];
const TYPES = ['mock', 'ota', 'tbo', 'hotelbeds'];

export function validateConfig(raw: unknown, where: string): SuppliersConfigFile {
  const fail = (msg: string): never => {
    throw new Error(`Config ${where}: ${msg}`);
  };
  if (!isObject(raw)) return fail('must be a JSON object');

  const service = raw['service'];
  if (service !== undefined) {
    if (!isObject(service)) return fail('"service" must be an object');
    for (const key of Object.keys(service)) {
      if (!SERVICE_KEYS.includes(key)) fail(`unknown setting service.${key} (known: ${SERVICE_KEYS.join(', ')})`);
    }
    const num = (key: string, ok: (n: number) => boolean, rule: string) => {
      const v = service[key];
      if (v === undefined) return;
      if (typeof v !== 'number' || !Number.isFinite(v) || !ok(v)) fail(`service.${key} must be ${rule}, got ${JSON.stringify(v)}`);
    };
    num('maxPriceIncreasePercent', (n) => n >= 0 && n <= 100, 'a number from 0 to 100');
    num('offerTtlMs', (n) => n > 0, 'a number of milliseconds above 0');
    num('quoteTtlMs', (n) => n > 0, 'a number of milliseconds above 0');
    num('maxReconcileAttempts', (n) => Number.isInteger(n) && n >= 1, 'a whole number, 1 or more');
    num('onRequestPollIntervalMs', (n) => n >= 0, 'a number of milliseconds, 0 or more');
    num('maxOnRequestChecks', (n) => Number.isInteger(n) && n >= 1, 'a whole number, 1 or more');
  }

  const suppliers = raw['suppliers'];
  if (!Array.isArray(suppliers)) return fail('"suppliers" must be a list');
  const seen = new Set<string>();
  suppliers.forEach((s: unknown, i) => {
    if (!isObject(s)) return fail(`suppliers[${i}] must be an object`);
    const id = s['id'];
    if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,50}$/.test(id)) return fail(`suppliers[${i}].id must be a short name (letters, digits, - or _)`);
    const at = `supplier ${id}`;
    if (seen.has(id)) fail(`${at} is listed twice`);
    seen.add(id);
    if (typeof s['type'] !== 'string' || !TYPES.includes(s['type'])) fail(`${at}: type must be one of ${TYPES.join(', ')}`);
    if (typeof s['enabled'] !== 'boolean') fail(`${at}: enabled must be true or false`);
    optionalPositive(s, 'searchTimeoutMs', at, fail);
    optionalPositive(s, 'rateLimitPerSecond', at, fail);

    if (s['type'] === 'mock') {
      const hotels = s['hotels'];
      const ok = Array.isArray(hotels) && hotels.every((h: unknown) => isObject(h) && ['code', 'name', 'nightly', 'currency'].every((k) => typeof h[k] === 'string'));
      if (!ok) fail(`${at}: hotels must be a list of {code, name, nightly, currency}`);
      return;
    }
    if (s['environment'] !== 'test' && s['environment'] !== 'production') fail(`${at}: environment must be "test" or "production"`);
    if (s['type'] === 'ota') {
      if (typeof s['profile'] !== 'string') fail(`${at}: profile is required`);
      if (typeof s['baseUrlEnv'] !== 'string' || !s['baseUrlEnv']) fail(`${at}: baseUrlEnv (name of the env var with the base URL) is required`);
      secretNames(s['secrets'], ['username', 'password'], at, fail, true);
      return;
    }
    if (typeof s['baseUrl'] !== 'string') fail(`${at}: baseUrl is required`);
    if (typeof s['certified'] !== 'boolean') fail(`${at}: certified must be true or false`);
    if (s['type'] === 'hotelbeds') secretNames(s['secrets'], ['apiKey', 'secret'], at, fail, true);
    if (s['type'] === 'tbo') {
      secretNames(s['secrets'], ['username', 'password'], at, fail, false);
      if (typeof s['agencyEmail'] !== 'string' || typeof s['agencyPhone'] !== 'string') fail(`${at}: agencyEmail and agencyPhone are required`);
    }
  });
  return raw as unknown as SuppliersConfigFile;
}

/** Names of the env vars an enabled supplier cannot work without. */
export function requiredSecretNames(s: SupplierConfig): string[] {
  if (s.type === 'hotelbeds') return [s.secrets.apiKey, s.secrets.secret];
  if (s.type === 'ota') return [s.baseUrlEnv, s.secrets.username, s.secrets.password];
  // TBO: optional, because a network proxy may add the credential. If named, they must exist.
  if (s.type === 'tbo' && s.secrets) return [s.secrets.username, s.secrets.password];
  return [];
}

/** Host-name parts that mark a supplier's test system. */
const TEST_MARKERS = new Set(['test', 'testing', 'tst', 'staging', 'stage', 'stg', 'sandbox', 'uat', 'dev', 'qa', 'cert', 'preprod', 'demo', 'localhost']);
/** Production hosts we know. A "test" supplier pointing at one of these would make real bookings. */
const KNOWN_PRODUCTION_HOSTS = new Set(['api.hotelbeds.com', 'api-secure.hotelbeds.com']);

/**
 * The declared environment must agree with the host: "production" on a test
 * host would show test bookings as real; "test" on a production host would
 * make real bookings that everyone believes are fake.
 *
 * Limits: a production host is recognised only if it is in the list above,
 * and a test host only by a marker in its name (test, staging, sandbox...).
 */
export function checkEnvironmentHost(supplierId: string, environment: 'test' | 'production', baseUrl: string): void {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new Error(`Supplier ${supplierId}: base URL is not a valid URL`);
  }
  const host = url.hostname.toLowerCase();
  const local = host === 'localhost' || host === '127.0.0.1';
  if (url.protocol !== 'https:' && !local) throw new Error(`Supplier ${supplierId}: base URL must be https`);
  const looksTest = local || host.split(/[.\-_]/).some((part) => TEST_MARKERS.has(part));
  if (environment === 'production' && looksTest) {
    throw new Error(`Supplier ${supplierId}: environment is "production" but ${host} is a test host. Fix the base URL or the environment.`);
  }
  if (environment === 'test' && KNOWN_PRODUCTION_HOSTS.has(host)) {
    throw new Error(`Supplier ${supplierId}: environment is "test" but ${host} is a production host: bookings there are real. Fix the base URL or the environment.`);
  }
}

function secretNames(v: unknown, keys: string[], at: string, fail: (m: string) => never, required: boolean): void {
  if (v === undefined && !required) return;
  if (!isObject(v) || !keys.every((k) => typeof v[k] === 'string' && v[k] !== '')) {
    fail(`${at}: secrets must name the env vars: {${keys.join(', ')}}`);
  }
}

function optionalPositive(s: Obj, key: string, at: string, fail: (m: string) => never): void {
  const v = s[key];
  if (v !== undefined && (typeof v !== 'number' || !Number.isFinite(v) || v <= 0)) fail(`${at}: ${key} must be a number above 0`);
}

function isObject(v: unknown): v is Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
