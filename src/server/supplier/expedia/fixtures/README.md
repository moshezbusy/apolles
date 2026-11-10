Test data for the Expedia adapter.

- `availability.availability.json`, `availability.availability-and-unavailable-reason.json`,
  `availability.no-availability.json`, `price-check.*-example.json`: Expedia's official example
  responses, copied unchanged from the OpenAPI spec (`docs/research/expedia-api/rapid-3-specs.yaml`).
  Some examples are billed in CAD, and one price-check example breaks the spec's own schema
  (`nightly` as an object). The adapter follows the schema, not the examples.
- `availability.usd.json`: the official availability example with every amount in USD, totals
  made consistent with the nightly lines, and property fees with a local (EUR) amount.
- `price-check.usd-available.json`: a USD price check following the schema.
