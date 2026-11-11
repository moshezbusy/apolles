# Decision: PDF library for the voucher (pdfkit 0.20.2)

Spec section 7: the server creates the PDFs. Section 3, row 10: a voucher in English with
the agency's branding.

## Candidates and the audit (supply-chain-risk-auditor, 2026-11-11)

The collector ran over both trees: pdfkit with every package it depends on, and pdf-lib
with its own.

| | pdfkit 0.20.2 | pdf-lib 1.17.1 |
|---|---|---|
| Last registry change | 2026-09-07 | 2022-05-12 |
| npm maintainers | 4 | 1 (single publisher flagged) |
| Install-time scripts | none, in the whole tree | none |
| Known advisories (npm bulk advisory endpoint) | none at the resolved versions | none |
| Packages pulled in | about 20 (fontkit, linebreak, png-js, fflate, @noble/*, …) | 5 |

- **Single-publisher packages in pdfkit's tree:** `fflate`, `clone` and `fast-deep-equal`.
- **Not assessable from this environment:** OSV advisories (the OSV API did not answer), and
  repository archived, activity and CI hygiene (GitHub was not authenticated). CI's
  dependency audit (`pnpm audit`) runs on every PR from now on.

## Decision

**pdfkit 0.20.2**, exact version, plus `@types/pdfkit` 0.17.7 (development only).

- It is maintained by several people.
- No package in its tree runs a script at install time.
- It embeds PNG and JPEG agency logos.

pdf-lib was not chosen: it has had no release since 2022 and has a single publisher.

## What the voucher holds

- **Agency branding:** the agency logo, name, email and phone (ER2: the voucher carries the
  agency's support details).
- **The booking:**
  - Apolles reference and hotel confirmation number;
  - hotel name and address;
  - dates;
  - room, and bed type with "Bed type is a request and not guaranteed";
  - guests, with children's ages.
- **Policies (AP3, BP4, ER4):**
  - check-in and check-out;
  - instructions and special instructions;
  - fees, with fees paid at the property in the local currency and USD;
  - know before you go;
  - the cancellation policy.
- **No price paid:** the voucher goes from the agent to the traveller.

## Not built: invoice and credit note

Spec section 9, question 4א is still open:
- which company issues the invoices;
- which invoicing system it uses;
- Israeli allocation numbers.

Building invoice numbering ourselves is against the recommendation there. The invoice waits
for the owner's answer.
