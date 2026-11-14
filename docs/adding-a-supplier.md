# Adding a supplier

## A. Supplier speaks OpenTravel (OTA) XML: Omnibees, Dingus, SynXis, DerbySoft, most CRSs

No new code in most cases.

1. Create `src/adapters/<name>/profile.ts` from `OTA_DEFAULTS`
   (copy `src/adapters/omnibees/profile.ts`). Register it in
   `src/adapters/profiles.ts`.
2. Add the supplier to `config/suppliers.json` with `"type": "ota"`,
   `"environment": "test"`, `"enabled": true`, and env var names for the
   base URL and credentials.
3. Add `config/mappings/<name>.json`: our hotel id -> their hotel code.
4. Fill in the profile from their documentation. Typical differences:
   `envelope` (plain/SOAP), `paths`, `soapActions`, `auth`,
   `supplierRefResIdType`, `hotelConfirmationResIdType`,
   `noAvailabilityErrorCodes`, `notFoundErrorCodes`, `errorMap`,
   `capabilities.lookupByClientReference`, `cardPlacement`.
   Facts can also go in `profileOverrides` in the config.
5. Add a test with a real (anonymised) response from their test system to
   `test/fixtures/ota/`: see `test/ota-adapter.test.ts`.
6. Run the certification script the supplier gives you on the test
   environment. The redacted audit log (`audit-logs/*.jsonl`) is what you
   send them as evidence.
7. Only after they approve: set `verified: true`, switch to
   `"environment": "production"` and production credentials.

If they extend OTA with custom fields (TPA_Extensions), subclass
`OtaAdapter` in the supplier's folder and override the method that needs it.

## B. Supplier has its own JSON/REST API (hotel chain API, bed banks)

1. Create `src/adapters/<name>/<name>-adapter.ts` implementing
   `SupplierAdapter` (`src/core/supplier.ts`). Use `HttpTransport` for every
   call so timeouts, retries, rate limits and the audit log come for free.
   Pass `idempotent: false` for book and cancel.
2. Map their errors to `SupplierError` codes. Anything on **book** that does
   not definitely mean "not booked" must be `OUTCOME_UNKNOWN`.
3. Send our `clientReference` to them on book if their API has a field for
   it, and implement `getBooking` by that reference
   (`lookupByClientReference: true`). This is what makes timeouts safe.
4. Register it in `src/bootstrap.ts`, add config + mapping, tests, certify.

## Rules every adapter follows

- Never log, store or return card data. Get it only via `CardVault.withCard`.
- Never retry book/cancel yourself.
- Return prices as `Money` built with `moneyFromDecimal` / `otaAmount`
  (no floats).
- Unknown board codes: leave `board` undefined, put the raw code in
  `boardRaw`; the mapping file decides.
