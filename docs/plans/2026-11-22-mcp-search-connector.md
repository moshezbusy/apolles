# Plan: search-only MCP connector for agents (Claude, ChatGPT)

Owner decisions (chat, 2026-11-22): build it; search only, booking must not exist in the connector;
"the safest there is"; do not wait for Expedia's answer.

Build this in a session started on `main`, so the project guardrails (`.claude/settings.json` hooks) are
active. Follow `CLAUDE.md`: owner approves this plan, then test first, verify, review, PR.

## Facts from `main` (checked 2026-11-22)
- Search runs only through server actions: `startSearchAction` -> `startSearch` / `listResults`
  (`src/server/search/search.ts`), hotel rates via `getHotelOffers`. Input: `searchInputSchema`
  (`src/server/search/input.ts`): destinationId, checkin, checkout, rooms (adults, childAges). No nationality.
- Expedia call already sends `sales_channel=agent_tool`, `sales_environment=hotel_only`
  (`src/server/supplier/expedia/adapter.ts`).
- Auth is cookie sessions only (`src/server/auth/session.ts`, `guards.ts`). No API tokens, no OAuth.
  Every booking, cancel, voucher, statement, balance and wallet entry point calls `requireAgent()` /
  `requireAdmin()`, which read only the cookie, so a new token type is rejected by default.
- Helpers to reuse: `hitRateLimit` (`src/server/rate-limit.ts`), `audit` (`src/server/audit.ts`),
  `setAgencyStatus` (deletes sessions on suspension), `destroyUserSessions`.
- The approved spec does not mention this feature. Recording it there is the owner's action
  (`docs/specs/approved/` is guarded).

## Design (safest option)
1. **Separate MCP process** (`src/mcp-server.ts`, own container, like `src/worker.ts`). It has no Expedia
   keys and no database URL. It exposes exactly two tools: `search_hotels` and `get_hotel_rates`.
   It forwards the agent's token to the app's search API. Nothing else.
2. **Assistant tokens** in the app: new table `AssistantConnection` (agencyId, userId, client name,
   tokenHash SHA-256, scope fixed `search:read`, createdAt, lastUsedAt, expiresAt, revokedAt).
   Raw token never stored or logged.
3. **OAuth sign-in** (needed by Claude and ChatGPT remote connectors; check their current docs first):
   authorize page in the app where the agent signs in with the normal login and 2FA and sees
   "Search only. Bookings, cancellations and your balance can't be reached." Token endpoint issues a
   `search:read` token. Dynamic client registration only if the clients require it.
4. **Search API in the app**: one route handler, accepts only an assistant token (never a cookie),
   `agencyId` from the token only, calls `startSearch`, `listResults`, `getHotelOffers`. Strict Zod input.
   Output: hotel name (as the supplier sends it), stars, area, room name, meal plan, total and per-night
   price, taxes and fees line, fees payable at property, free cancellation deadline, and a link to the hotel
   page in Apolles (search in the URL). No guest, client, booking or balance data. No supplier name (GR1).
   Package rates never returned.
5. **Limits and logs**: `hitRateLimit("assistant:agency:<id>")`, `audit()` row per call (no tokens),
   `lastUsedAt` updated.
6. **Revocation**: agent revokes in Agency settings ("AI assistants" section, mockup
   `docs/design/mockups/pages/20-agency-settings.html` on branch `claude/brave-goldberg-v7adee`).
   Tokens revoked automatically on agency suspension, user suspension, password change and lockout
   (same places that delete sessions).
7. **New dependency**: MCP SDK, exact version, justified, `supply-chain-risk-auditor` run first.

## Tests (written first)
- An assistant token is rejected by every booking, cancel, voucher, statement, balance and wallet
  entry point, and by `requireAgent()`.
- The MCP server lists exactly two tools; any other tool name fails.
- Search API: no cookie accepted; wrong/expired/revoked token rejected; other agency's snapshot not
  readable (no IDOR); output contains no PII fields; package rates absent.
- Revocation on suspension / password change / lockout / manual revoke.
- Rate limit and audit row per call.

## Not verified
- Exact OAuth requirements of Claude custom connectors and ChatGPT for a remote MCP server.
- Expedia's view on showing rates inside AI assistants (owner chose not to wait).
