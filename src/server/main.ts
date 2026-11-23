import { resolve } from 'node:path';
import { alertSinkFromEnv } from '../alerts/alerts.js';
import { createRuntime } from '../bootstrap.js';
import { createHttpServer } from './http-server.js';
import { openBookingStore, shutdownGracefully } from './startup.js';

/** Requests in flight get this long to finish on SIGTERM (docker-compose gives the container 90 s). */
const SHUTDOWN_GRACE_MS = 75_000;
const RECONCILE_EVERY_MS = 60_000;

try {
  const root = process.env['APOLLES_ROOT'] ?? process.cwd();
  const alerts = alertSinkFromEnv(process.env);
  // Bookings must survive a restart: loaded from (and written to) BOOKINGS_FILE.
  const bookings = await openBookingStore(process.env, root);
  const runtime = await createRuntime({
    bookings: bookings.store,
    alerts,
    configPath: resolve(root, process.env['SUPPLIERS_CONFIG'] ?? 'config/suppliers.json'),
    mappingDir: resolve(root, process.env['MAPPINGS_DIR'] ?? 'config/mappings'),
    auditDir: resolve(root, process.env['AUDIT_DIR'] ?? 'audit-logs'),
  });
  const { service } = runtime;

  const port = Number(process.env['PORT'] ?? '8080');
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`PORT must be a port number, got "${process.env['PORT']}"`);
  const host = process.env['HOST'] ?? '127.0.0.1';
  const server = createHttpServer(service, process.env['APOLLES_API_KEY'] ?? '', {
    health: () => ({ auditOk: runtime.auditOk(), storeOk: bookings.ok() }),
  });
  server.listen(port, host, () => {
    console.log(`apolles-suppliers listening on http://${host}:${port}`);
  });

  // Settle bookings that wait for a supplier answer: once now (a restart may
  // have left some) and then every minute. reconcilePending is single
  // flight, so a slow run is never overlapped by the next tick.
  const reconcile = () => {
    service.reconcilePending().catch((err) => console.error('reconcile failed', err));
  };
  reconcile();
  const timer = setInterval(reconcile, RECONCILE_EVERY_MS);
  timer.unref();

  let stopping = false;
  const shutdown = (signal: string) => {
    if (stopping) return;
    stopping = true;
    console.log(`${signal} received: shutting down`);
    shutdownGracefully({
      server,
      flush: bookings.flush,
      stop: () => {
        clearInterval(timer);
        runtime.stop();
      },
      timeoutMs: SHUTDOWN_GRACE_MS,
    })
      .catch((err) => console.error('shutdown failed', err))
      .finally(() => process.exit(0));
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
} catch (err) {
  // One clear line instead of a stack trace: this is read by the person who deploys.
  console.error(`Cannot start: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
