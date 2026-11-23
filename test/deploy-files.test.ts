import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
/** Lines that are actually in effect (not comments). */
const active = (text: string) => text.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));

describe('deployment files', () => {
  it('.env.example does not bind the server to 127.0.0.1 inside the container', () => {
    const lines = active(read('.env.example'));
    expect(lines.some((l) => l.startsWith('HOST='))).toBe(false);
    expect(read('.env.example')).toMatch(/ALERT_WEBHOOK_URL/);
  });

  it('.dockerignore keeps secrets and data out of the build context', () => {
    const lines = active(read('.dockerignore'));
    expect(lines).toContain('deploy/.env');
    expect(lines).toContain('deploy/data');
  });

  it('docker-compose has a healthcheck, a memory limit, time to shut down, and the bookings file', () => {
    const compose = read('deploy/docker-compose.yml');
    const lines = active(compose);
    expect(compose).toMatch(/healthcheck:/);
    expect(compose).toMatch(/\/health/);
    expect(lines.some((l) => /^mem_limit:/.test(l))).toBe(true);
    expect(lines).toContain('stop_grace_period: 90s');
    expect(lines).toContain('- BOOKINGS_FILE=/data/bookings/bookings.json');
    expect(lines).toContain('- HOST=0.0.0.0');
    expect(compose).toMatch(/ALERT_WEBHOOK_URL/);
  });
});
