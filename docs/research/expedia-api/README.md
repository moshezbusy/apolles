# Expedia Rapid v3 OpenAPI spec

`rapid-3-specs.yaml` is Expedia's official OpenAPI 3.0.1 spec, "EPS Rapid V3". It was downloaded on 2026-11-10 from the Lodging API Explorer, at `https://a.travel-assets.com/documentation-hubs/prod/rapid/latest/en-US/assets/rapid-3-specs.yaml`.

**One change from the original:** Expedia's example responses contain sample `token=` values and sample signed S3 download links (`AWSAccessKeyId=…&Signature=…`, which expired in 2017). These are example data, not credentials. The secret scan (gitleaks) flags them, so they were replaced with `EXAMPLE_TOKEN`, `EXAMPLE_KEY` and `EXAMPLE_SIGNATURE`. Nothing else was changed.

To refresh the file: download it again from the link above and apply the same three replacements before committing.
