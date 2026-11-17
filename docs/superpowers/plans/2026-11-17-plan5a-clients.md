# Plan 5a: Clients (screen 18)

Owner decision 2026-11-17 (`docs/decisions/2026-11-17-build-all-mockup-screens.md`): build every mockup
screen. Mockup: `docs/design/mockups/pages/18-clients.html`. This is the first part of phase 2
(quotes and clients); quotes come in plan 5b and the client page in 5c.

## Decisions (Claude)

- **A client belongs to one agency.** Every query is scoped by `agencyId` from the session; an id from
  another agency finds nothing (no IDOR).
- **Fields, as in the mockup's "Add client" form:** first name, last name, WhatsApp phone (required),
  email (optional), nationality (country, default the agency's country) and notes (up to 1,000 characters).
- **Travel companions** are kept on the client: first and last name, relation (free text, e.g. "Spouse")
  and, for a child, the age. The client is always the first traveler ("Lead · Adult").
- **Phone search** ignores spaces, dashes, brackets and a leading `+`, `00` or `0`: the digits are kept
  in their own column.
- **The audit log never holds the client's personal data:** it records which fields changed, not their values.
- **Left for later plans, so the screen never shows a number that is not real yet:** the Quotes and
  Bookings columns and the "New quote" / "New booking" buttons (plans 5b and 5c link them).
- **Header:** "Clients" becomes a link now. It moves under the Quotes menu with plan 5b.

## Tasks (each: failing test → code → green)

1. Schema: `Client`, `ClientCompanion` (migration, indexes `[agencyId, updatedAt]`, `[clientId, position]`).
2. `src/server/clients.ts`: input schemas (Zod, strict), `listClients` (search, paginated 50), `getClient`,
   `createClient`, `updateClient`, `addCompanion`, `removeCompanion`. All scoped and audited.
3. `/clients` page: list, search, count, detail panel, add and edit forms, companions.
4. Header link, e2e check, verify (typecheck, lint, tests, build), review, PR.
