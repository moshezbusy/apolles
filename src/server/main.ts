import { resolve } from 'node:path';
import { createSupplierService } from '../bootstrap.js';
import { createHttpServer } from './http-server.js';

const root = process.env['APOLLES_ROOT'] ?? process.cwd();
const service = await createSupplierService({
  configPath: resolve(root, process.env['SUPPLIERS_CONFIG'] ?? 'config/suppliers.json'),
  mappingDir: resolve(root, process.env['MAPPINGS_DIR'] ?? 'config/mappings'),
  auditDir: resolve(root, process.env['AUDIT_DIR'] ?? 'audit-logs'),
});

const apiKey = process.env['APOLLES_API_KEY'] ?? '';
const port = Number(process.env['PORT'] ?? '8080');
const host = process.env['HOST'] ?? '127.0.0.1';

createHttpServer(service, apiKey).listen(port, host, () => {
  console.log(`apolles-suppliers listening on http://${host}:${port}`);
});

// Settle bookings whose outcome is unknown, every minute.
setInterval(() => {
  service.reconcilePending().catch((err) => console.error('reconcile failed', err));
}, 60_000).unref();
