Test data for the Expedia adapter.

- `availability.availability.json`, `availability.availability-and-unavailable-reason.json`,
  `availability.no-availability.json`, `price-check.*-example.json`: Expedia's official example
  responses, copied from the OpenAPI spec, with example tokens replaced by short placeholders (`tok-a1`, `tok-b2`, `tok-ex`) so the secret scans (gitleaks, and semgrep's gitleaks rules) stay clean (`docs/research/expedia-api/rapid-3-specs.yaml`).
  Some examples are billed in CAD, and one price-check example breaks the spec's own schema
  (`nightly` as an object). The adapter follows the schema, not the examples.
- `availability.usd.json`: the official availability example with every amount in USD, totals
  made consistent with the nightly lines, and property fees with a local (EUR) amount.
- `price-check.usd-available.json`: a USD price check following the schema.
- `book.*`, `retrieve*.json` (plan 3): Expedia's official examples for create, retrieve and
  retrieve-by-affiliate-reference, plus every documented error of create, copied from the
  spec. Each token is replaced by its own short placeholder. `book.request-example.json` is
  the spec's first create example, changed to our payment type: `affiliate_collect`, with
  the billing contact only. The card number, CVV, 3-D Secure data, loyalty id and other
  optional fields were removed, because Apolles never sends card data.
- `*.multi-room.json` (plan 10): two rooms in one request. `availability.multi-room.json` has a
  rate priced for both occupancies (`2-9,4` and `2`) and one priced for `2-9,4` only;
  `price-check.multi-room.json` prices both; `retrieve.multi-room.json` is the retrieve example
  with two rooms, each with its own main guest and cancel link. Made by hand from the spec's
  examples and schema (amounts in USD, consistent with the nightly lines).
