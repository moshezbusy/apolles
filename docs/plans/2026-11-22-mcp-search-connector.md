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

## As built (2026-11-24)

Owner approved the plan above in chat. What was built, and where it differs:

- **Docs checked first (2026-11-24)**: Claude (claude.com/docs/connectors/building/authentication),
  ChatGPT (developers.openai.com/apps-sdk/build/auth) and the MCP authorization spec 2025-11-25.
  Both need: Streamable HTTP, OAuth 2.1 authorization code + PKCE S256, protected resource
  metadata (RFC 9728) and a 401 with `WWW-Authenticate: Bearer resource_metadata=...`, authorization
  server metadata (RFC 8414), the `resource` parameter bound into the token. Client registration:
  dynamic registration (RFC 7591) or Client ID Metadata Documents; both fall back to dynamic
  registration. ChatGPT uses its stable redirect address only if every authorization response
  carries `iss` (RFC 9207): it does here.
- **No MCP SDK.** `supply-chain-risk-auditor` was run on `@modelcontextprotocol/sdk@1.32.2`: 17
  direct runtime packages (express, hono, cors, cross-spawn, eventsource, ajv, ...), 2 with a single
  publisher, 5 without publish provenance; advisories could not be checked from this session
  (OSV and GitHub unreachable). The connector needs four JSON-RPC methods, so it is written with
  Node and zod only (`src/mcp/server.ts`). No new dependency.
- **Separate process** `src/mcp-server.ts` (container `apolles-staging-mcp`, compose profile
  `assistants`, no env file). Refuses to start with `DATABASE_URL`, supplier, email, 2FA or bank
  settings in its environment. Imports nothing from the app (tested).
- **App side** `src/server/assistant/*`: tables `AssistantClient`, `AssistantAuthRequest`,
  `AssistantConnection` (hashes only). Endpoints `/.well-known/oauth-authorization-server`,
  `/oauth/register`, `/oauth/authorize`, `/oauth/consent/<id>` (agent signs in as usual, then
  "Allow search only"), `/oauth/token`, and `/api/assistant/{search_hotels,get_hotel_rates,check}`
  (Authorization header only, closed to the internet at Caddy).
- Only Claude's and ChatGPT's redirect addresses can register. The name on the consent page comes
  from that address. Access token 1 hour, refresh token 30 days with rotation; a reused refresh
  token or code revokes the connection.
- **Destination by name**: `search_hotels` takes a destination name (or an id from
  `otherDestinations`), since an assistant does not know Apolles destination ids.
- **Revocation**: agency suspension, password change, lockout (agent's email code or admin TOTP),
  and Revoke in Agency settings, AI assistants. Each token check also refuses a suspended agent or
  agency and a locked-out agent.
- **Limits and audit**: per connection 60 calls a minute, per agency 300, on top of the search
  service's own per-user limits. One audit row per call (`assistant.search_hotels`,
  `assistant.get_hotel_rates`), plus `assistant.authorize`, `assistant.connect`, `assistant.revoke`.
- **Off by default**: everything answers 404 until `MCP_PUBLIC_URL` is set
  (deploy/staging/README.md, section 7).
- **Token passthrough note**: the connector forwards the assistant's token to the app's assistant
  API. The app is the authorization server that issued it and checks that it was issued for the
  connector's address; that API is reachable only inside the server. The connector itself sends
  the token nowhere else.
