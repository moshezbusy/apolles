import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { InMemoryAlertSink } from '../src/alerts/alerts.js';
import { createRuntime } from '../src/bootstrap.js';
import { checkEnvironmentHost } from '../src/config/validate-config.js';
import { StaticSecretProvider } from '../src/security/secrets.js';
import { search } from './helpers.js';

const MOCK = { id: 'mock', type: 'mock', enabled: true, hotels: [{ code: 'M1', name: 'Mock', nightly: '100.00', currency: 'USD' }] };
const HOTELBEDS = {
  id: 'hotelbeds', type: 'hotelbeds', enabled: true, environment: 'test', baseUrl: 'https://api.test.hotelbeds.com/hotel-api/1.0',
  certified: false, secrets: { apiKey: 'HB_KEY', secret: 'HB_SECRET' },
};

async function boot(config: unknown, extra: { secrets?: Record<string, string>; mappings?: Record<string, unknown> | 'none'; auditDir?: string } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'apolles-boot-'));
  const configPath = join(dir, 'suppliers.json');
  await writeFile(configPath, typeof config === 'string' ? config : JSON.stringify(config));
  const mappingDir = join(dir, 'mappings');
  if (extra.mappings !== 'none') {
    await mkdir(mappingDir);
    const files = extra.mappings ?? { 'mock.json': { supplierId: 'mock', hotels: { 'APL-1': 'M1' } } };
    for (const [name, body] of Object.entries(files)) await writeFile(join(mappingDir, name), typeof body === 'string' ? body : JSON.stringify(body));
  }
  const alerts = new InMemoryAlertSink();
  const runtime = await createRuntime({
    configPath, mappingDir, auditDir: extra.auditDir ?? join(dir, 'audit-logs'), alerts, env: {},
    secrets: new StaticSecretProvider(extra.secrets ?? {}), log: () => undefined,
  });
  runtime.stop();
  return { runtime, alerts, dir };
}

describe('startup: the config file is checked', () => {
  it('a good config starts and searches', async () => {
    const { runtime } = await boot({ service: { maxPriceIncreasePercent: 0 }, suppliers: [MOCK] });
    const r = await runtime.service.search({ ...search, hotelIds: ['APL-1'] });
    expect(r.offers.length).toBeGreaterThan(0);
    expect(runtime.auditOk()).toBe(true);
  });

  it('a price tolerance that is not a number stops startup (it would switch the price guard off)', async () => {
    await expect(boot({ service: { maxPriceIncreasePercent: '5%' }, suppliers: [MOCK] })).rejects.toThrow(/maxPriceIncreasePercent/);
    await expect(boot({ service: { maxPriceIncreasePercent: 'abc' }, suppliers: [MOCK] })).rejects.toThrow(/maxPriceIncreasePercent/);
    await expect(boot({ service: { maxPriceIncreasePercent: null }, suppliers: [MOCK] })).rejects.toThrow(/maxPriceIncreasePercent/);
    await expect(boot({ service: { maxPriceIncreasePercent: -1 }, suppliers: [MOCK] })).rejects.toThrow(/maxPriceIncreasePercent/);
    await expect(boot({ service: { quoteTtlMs: '600000' }, suppliers: [MOCK] })).rejects.toThrow(/quoteTtlMs/);
  });

  it('typos and wrong shapes are named, not ignored', async () => {
    await expect(boot({ service: { maxPriceIncreasePercentage: 5 }, suppliers: [MOCK] })).rejects.toThrow(/maxPriceIncreasePercentage/);
    await expect(boot({ suppliers: 'none' })).rejects.toThrow(/suppliers/);
    await expect(boot('{ not json')).rejects.toThrow(/not valid JSON/i);
    await expect(boot({ suppliers: [{ ...MOCK, enabled: 'yes' }] })).rejects.toThrow(/enabled/);
    await expect(boot({ suppliers: [{ ...HOTELBEDS, environment: 'live' }] }, { secrets: { HB_KEY: 'k', HB_SECRET: 's' } })).rejects.toThrow(/environment/);
    await expect(boot({ suppliers: [MOCK, MOCK] })).rejects.toThrow(/twice/);
    await expect(boot({ suppliers: [{ ...MOCK, type: 'expedia' }] })).rejects.toThrow(/type/);
  });

  it('every enabled supplier must have its secrets at startup; a disabled one needs none', async () => {
    await expect(boot({ suppliers: [HOTELBEDS] }, { secrets: { HB_KEY: 'k' } })).rejects.toThrow(/hotelbeds.*HB_SECRET/);
    await expect(boot({ suppliers: [HOTELBEDS] }, { secrets: { HB_KEY: 'k', HB_SECRET: '' } })).rejects.toThrow(/HB_SECRET/);
    await boot({ suppliers: [HOTELBEDS] }, { secrets: { HB_KEY: 'k', HB_SECRET: 's' } });
    await boot({ suppliers: [{ ...HOTELBEDS, enabled: false }] });
    const ota = { id: 'omnibees', type: 'ota', profile: 'omnibees', enabled: true, environment: 'test', baseUrlEnv: 'OB_URL', secrets: { username: 'OB_USER', password: 'OB_PASS' } };
    await expect(boot({ suppliers: [ota] }, { secrets: { OB_URL: 'https://test.omnibees.example/ota', OB_USER: 'u' } })).rejects.toThrow(/omnibees.*OB_PASS/);
    await expect(boot({ suppliers: [ota] }, { secrets: { OB_USER: 'u', OB_PASS: 'p' } })).rejects.toThrow(/omnibees.*OB_URL/);
  });

  it('the declared environment must match the host', async () => {
    const secrets = { HB_KEY: 'k', HB_SECRET: 's' };
    await expect(boot({ suppliers: [{ ...HOTELBEDS, environment: 'production', certified: true }] }, { secrets })).rejects.toThrow(/test host.*production|production.*test host/i);
    await expect(boot({ suppliers: [{ ...HOTELBEDS, baseUrl: 'https://api.hotelbeds.com/hotel-api/1.0' }] }, { secrets })).rejects.toThrow(/production host/i);
    await expect(boot({ suppliers: [{ ...HOTELBEDS, baseUrl: 'http://api.test.hotelbeds.com/hotel-api/1.0' }] }, { secrets })).rejects.toThrow(/https/);

    expect(() => checkEnvironmentHost('x', 'production', 'https://api.hotelbeds.com/hotel-api/1.0')).not.toThrow();
    expect(() => checkEnvironmentHost('x', 'test', 'https://api.test.hotelbeds.com/hotel-api/1.0')).not.toThrow();
    expect(() => checkEnvironmentHost('x', 'test', 'https://api.tbotechnology.in/TBOHolidays_HotelAPI')).not.toThrow();
    expect(() => checkEnvironmentHost('x', 'production', 'https://sandbox.vendor.example/ota')).toThrow();
    expect(() => checkEnvironmentHost('x', 'production', 'https://ota-staging.vendor.example/')).toThrow();
    expect(() => checkEnvironmentHost('x', 'production', 'https://contest.vendor.example/')).not.toThrow(); // "test" inside a word is not a marker
  });
});

describe('startup: mappings and audit directory', () => {
  it('a broken mapping file stops startup and is named', async () => {
    await expect(boot({ suppliers: [MOCK] }, { mappings: { 'mock.json': '{ broken' } })).rejects.toThrow(/mock\.json/);
    await expect(boot({ suppliers: [MOCK] }, { mappings: { 'mock.json': { supplierId: 'mock', hotels: { 'APL-1': 7 } } } })).rejects.toThrow(/mock\.json/);
    await expect(boot({ suppliers: [MOCK] }, { mappings: { 'mock.json': { supplierId: 'mock', hotels: {}, boards: { X: 'LUNCH' } } } })).rejects.toThrow(/mock\.json/);
    await expect(boot({ suppliers: [MOCK] }, { mappings: 'none' })).rejects.toThrow(/mappings/i);
  });

  it('an audit directory that cannot be created stops startup', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'apolles-boot-'));
    await writeFile(join(dir, 'file'), 'x');
    await expect(boot({ suppliers: [MOCK] }, { auditDir: join(dir, 'file', 'audit') })).rejects.toThrow(/Audit log directory/);
  });
});

describe('the config files in the repository', () => {
  it('pass the startup checks (dev config and the server config)', async () => {
    const root = new URL('..', import.meta.url).pathname;
    for (const config of ['config/suppliers.json', 'deploy/suppliers.server.json']) {
      const dir = await mkdtemp(join(tmpdir(), 'apolles-boot-'));
      const runtime = await createRuntime({
        configPath: join(root, config), mappingDir: join(root, 'config/mappings'), auditDir: join(dir, 'audit'), env: {}, log: () => undefined,
        secrets: new StaticSecretProvider({ HOTELBEDS_API_KEY: 'dummy-key', HOTELBEDS_SECRET: 'dummy-secret' }),
      });
      runtime.stop();
    }
  });
});
