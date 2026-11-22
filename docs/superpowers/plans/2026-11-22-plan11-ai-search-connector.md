# Plan 11: search-only AI connector (MCP) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** approved agents search Apolles hotels and rates from Claude or ChatGPT through a separate remote MCP server with two read tools, each agent with their own revocable `search:read` OAuth token, and book only inside Apolles.

**Architecture:** the Apolles app becomes an OAuth 2.1 authorization server (PKCE S256, DCR + allowlisted CIMD, RFC 9207 `iss`) and gets an internal AI search API that accepts only the MCP service key plus a valid `search:read` token, and calls the existing search service. A new MCP server (`src/mcp/`, own container, no DB, no Expedia keys) speaks stateless JSON-RPC over Streamable HTTP, publishes RFC 9728 metadata, and forwards each call with the agent's token to that API. Agency settings get an "AI assistants" tab; result links open an interstitial `/search/open` page.

**Tech Stack:** Next.js 16 route handlers and server actions, Prisma 7 (Postgres), Zod 4, Vitest (real local test DB, `renderToStaticMarkup` page tests), `node:http` for the MCP server. **No new dependency.**

**Spec:** `docs/superpowers/specs/2026-11-22-mcp-search-connector-design.md` (read it first; section numbers below refer to it). Owner decision in chat, 22.11.2026.

## Global Constraints
- **Gate:** no task starts before the owner approves this plan and the design in chat. Task 1 records the decision the way the owner chooses.
- Two tools only: `search_hotels`, `get_hotel_rates`. No other tool name exists anywhere in `src/mcp/` (a test lists them).
- Scope is exactly `search:read` (plus `offline_access`, which only means "refresh token"). Any other scope → `invalid_scope`.
- Token lifetimes: authorization code 60 s single use; access token 1 hour; refresh token 30 days, rotated on every use; a reused refresh token revokes the connection.
- Redirect URI allowlist (exact strings / one pattern): `https://claude.ai/api/mcp/auth_callback`, `https://chatgpt.com/connector_platform_oauth_redirect`, `^https://chatgpt\.com/connector/oauth/[A-Za-z0-9_-]{1,128}$`. Nothing else, no localhost.
- CIMD client ids fetched only from the allowlist (`https://chatgpt.com/oauth/client.json` and Claude's URL from task 1), 5 s timeout, 64 KB cap, `https:` only, no redirects followed.
- Connect window: 10 minutes, one use, created only by the AI assistants tab of the same agent.
- Rate limits: per agent 20 tool calls/min and 500/day (`ai:user:{userId}`, windows 60_000 and 86_400_000); assistant searches per agency 10/min (`ai-search:agency:{agencyId}`); `/oauth/token` 60 per 15 min per client and per connection + 2,000 per 15 min per IP; `/oauth/register` 100/hour per IP; AI API 600/min per IP before the key check.
- Snapshots: `source` `WEB` | `AI`; newest 50 WEB and newest 20 AI kept per agency, each cleaned only within its own source.
- Raw tokens, codes and the service key are never stored or logged (`hashToken` from `src/server/auth/token.ts`; service key compared with `timingSafeEqual` on SHA-256 digests).
- Tool answers never contain guest names, client data, emails, phones, balance, booking data, price-check tokens or the word "Expedia" (GR1).
- `sales_channel=agent_tool`, `sales_environment=hotel_only`, package rates dropped: already in the adapter; unchanged, and task 6 adds a test that the AI path goes through the same adapter call.
- No `Customer-Ip` on assistant searches (`supplierContext: {}` plus `userAgent: "Apolles AI search"`) — never the assistant's or our own IP.
- `AI_SEARCH_ENABLED !== "true"` → every new route answers 404 and the tab is hidden.
- UI copy in English; mobile rules of plan 9 hold. Every server action/route checks session, role and agency; every query scoped by `agencyId`.

## Review Focus
1. Token sent to a booking/cancel/voucher/balance/clients endpoint as `Authorization: Bearer`, as the `apl_session` cookie, or as a form field → refused like an anonymous request (task 7).
2. Agency suspended mid-conversation → the very next tool call answers 401, no cached acceptance (task 3, task 6).
3. Phishing link: attacker's connector, agent clicks Allow without having pressed "Connect assistant" → no code issued (task 5).
4. Assistant hammering searches → agent's own search page still works and the snapshot behind an open booking survives (task 2).
5. Destination text matching several places ("San Jose") → no search, candidates returned (task 6).

---

### Task 1: Record the decision and re-check the vendor docs

**Files:**
- Create: `docs/decisions/2026-11-22-ai-search-connector.md` (Hebrew, plain words; or whatever the owner chose instead)
- Modify: `docs/superpowers/specs/2026-11-22-mcp-search-connector-design.md` (status line; facts corrected by the re-check)

- [ ] **Step 1:** write the decision file: date, "אושר על ידי משה בצ'אט", what is built, what is not, link to the design and this plan, Expedia open items.
- [ ] **Step 2:** read (WebFetch, or ask the owner to allow the hosts) `developers.openai.com/apps-sdk/build/auth`, `help.openai.com/en/articles/12584461`, `claude.com/docs/connectors/building/authentication.md`. Write down Claude's CIMD client-id URL, ChatGPT's redirect patterns and required metadata fields. If anything differs from the Global Constraints, update the design and this plan before task 4, and tell the owner.
- [ ] **Step 3:** commit `docs: record AI search connector decision`.

### Task 2: Data model, snapshot source and separate assistant limits

**Files:**
- Modify: `prisma/schema.prisma`; Create: `prisma/migrations/<ts>_ai_search_connector/migration.sql`
- Modify: `src/server/search/search.ts` (`startSearch`, `createSnapshot`, `rateLimit`)
- Test: `src/server/search/search.test.ts`

**Interfaces:**
- Produces: models `AiClient {id, clientIdUrl String? @unique, name String, redirectUris String[], createdAt}`, `AiConnection {id, userId, agencyId, clientId, scope, resource, createdAt, lastUsedAt DateTime?, revokedAt DateTime?, revokedReason String?; @@index([agencyId, revokedAt]), @@index([userId])}`, `AiAuthCode {id, codeHash @unique, userId, clientId, redirectUri, codeChallenge, resource, expiresAt, usedAt?}`, `AiToken {id, connectionId, accessHash @unique, refreshHash @unique, accessExpiresAt, refreshExpiresAt, usedAt?; @@index([connectionId])}`, `AiConnectWindow {id, userId, sessionId, expiresAt, usedAt?; @@index([userId])}`; enum `SearchSource { WEB AI }`, `SearchSnapshot.source SearchSource @default(WEB)` with `@@index([agencyId, source, createdAt])`.
- Produces: `startSearch(ctx, rawInput, deps & { source?: "WEB" | "AI" })` — `AI` uses the `ai-search:agency:{id}` bucket (10/min) instead of `search:agency:{id}` (30/min) and the AI cap (20).

- [ ] **Step 1: failing tests** in `search.test.ts`:
  - `"an assistant search keeps its own cap and never deletes the agent's searches"`: seed 50 WEB snapshots, run 25 AI `startSearch` → all 50 WEB rows still exist; AI rows = 20.
  - `"assistant searches use their own rate bucket"`: 30 WEB searches in a minute succeed after 10 AI searches; the 11th AI search throws `SearchRateLimited`.
- [ ] **Step 2:** run `pnpm test src/server/search/search.test.ts` → FAIL.
- [ ] **Step 3:** schema + migration (`pnpm db:migrate --name ai_search_connector`), then the source-aware cap and bucket.
- [ ] **Step 4:** tests PASS, whole `search.test.ts` PASS.
- [ ] **Step 5:** commit `feat(ai): data model and separate assistant search limits`.

### Task 3: Token service and automatic revocation

**Files:**
- Create: `src/server/ai/tokens.ts`, `src/server/ai/config.ts`
- Modify: `src/server/admin/agencies.ts:setAgencyStatus`, `src/server/auth/password-tokens.ts` (where `destroyUserSessions` runs), `src/server/auth/lockout.ts` (both `destroyUserSessions` calls)
- Test: `src/server/ai/tokens.test.ts`, additions in `src/server/admin/agencies.test.ts`, `src/server/auth/password-tokens.test.ts`

**Interfaces:**
- Produces (`config.ts`): `aiSearchEnabled(): boolean`, `mcpResource(): string` (= `MCP_PUBLIC_URL` + `/mcp`, no trailing slash), `appIssuer(): string` (= `APP_PUBLIC_URL`), `serviceKeyMatches(raw: string | null): boolean`.
- Produces (`tokens.ts`):
  - `openConnectWindow(userId: string, sessionId: string): Promise<void>`; `useConnectWindow(userId, sessionId): Promise<boolean>` (atomic `updateMany ... where usedAt null and expiresAt > now`).
  - `issueAuthCode(i: {userId, clientId, redirectUri, codeChallenge, resource}): Promise<string>` (raw code).
  - `exchangeCode(i: {code, clientId, redirectUri, codeVerifier, resource}): Promise<TokenPair | OAuthError>`; `refresh(i: {refreshToken, clientId, resource}): Promise<TokenPair | OAuthError>`.
  - `type TokenPair = { accessToken: string; refreshToken: string; expiresIn: 3600; scope: "search:read" }`; `type OAuthError = { error: "invalid_grant" | "invalid_request" | "invalid_scope" | "invalid_client" }`.
  - `verifyAiToken(raw: string, resource: string): Promise<{ connectionId: string; userId: string; agencyId: string } | null>` — the checks of design §4.1, updates `lastUsedAt`.
  - `revokeConnection(agencyId, connectionId, actorUserId): Promise<boolean>`; `revokeUserConnections(userId, reason, tx)`; `revokeAgencyConnections(agencyId, reason, tx)`; `listConnections(agencyId): Promise<{id, assistant: "Claude" | "ChatGPT", createdAt, lastUsedAt}[]>`.
- [ ] **Step 1: failing tests** (`tokens.test.ts`):
  - code is single use; a second exchange → `invalid_grant` and revokes tokens of that code's connection.
  - wrong `code_verifier`, wrong `redirect_uri`, wrong `resource`, code after 61 s → `invalid_grant`.
  - refresh rotates: old refresh token then → `invalid_grant` **and** the connection is revoked (`revokedReason: "refresh_reuse"`).
  - `verifyAiToken` → null for: unknown, expired, revoked connection, other resource, user SUSPENDED, agency SUSPENDED, role ADMIN.
  - `"a search token is not a session"`: `getSession(rawAccessToken)` returns null.
  - agencies.test: `"suspending an agency revokes its assistant connections in the same transaction"` (and writes `ai.revoke_all`); reactivating does not restore them.
  - password-tokens.test: setting a new password revokes the user's connections.
- [ ] **Step 2:** run → FAIL. **Step 3:** implement. **Step 4:** PASS (`pnpm test src/server/ai src/server/admin src/server/auth`).
- [ ] **Step 5:** commit `feat(ai): search tokens with rotation and automatic revocation`.

### Task 4: Client registration (DCR + allowlisted CIMD)

**Files:**
- Create: `src/server/ai/clients.ts`, `src/app/oauth/register/route.ts`
- Test: `src/server/ai/clients.test.ts`

**Interfaces:**
- Produces: `registerClient(body: unknown, ip: string): Promise<{ status: 201; json: object } | { status: 400 | 429; json: { error: string } }>`; `resolveClient(clientId: string, fetchFn = fetch): Promise<AiClient | null>` (a CIMD URL on the allowlist is fetched and cached in `AiClient`; any other URL → null without fetching); `assistantName(redirectUri): "Claude" | "ChatGPT" | null`.
- [ ] **Step 1: failing tests:** redirect URI off the allowlist → 400 `invalid_redirect_uri`; `token_endpoint_auth_method` other than `none` → 400; unknown fields refused; `resolveClient("https://evil.example/client.json", fetchSpy)` → null and `fetchSpy` not called; allowlisted CIMD document whose `redirect_uris` leave the allowlist → null; 101st registration in an hour from one IP → 429; with `AI_SEARCH_ENABLED` unset the route answers 404.
- [ ] **Steps 2-4:** FAIL → implement → PASS. **Step 5:** commit `feat(ai): OAuth client registration`.

### Task 5: Authorization server endpoints, consent page, sign-in return

**Files:**
- Create: `src/app/.well-known/oauth-authorization-server/route.ts`, `src/app/oauth/authorize/page.tsx`, `src/app/oauth/authorize/actions.ts`, `src/app/oauth/token/route.ts`, `src/app/oauth/revoke/route.ts`
- Modify: `src/server/auth/guards.ts` (`requireAgent(opts?: { returnTo?: string })`), `src/app/login/actions.ts:77`, `src/app/login/verify/actions.ts:20`, `src/app/login/page.tsx` (hidden `next`), `next.config.ts` (`/oauth/:path*`: `Cache-Control: no-store`, `Referrer-Policy: no-referrer`, `X-Robots-Tag: noindex`)
- Create: `src/server/auth/return-to.ts`; Test: `src/server/auth/return-to.test.ts`, `src/app/oauth-pages.test.tsx`, `src/server/ai/oauth-routes.test.ts`

**Interfaces:**
- Consumes: task 3 `issueAuthCode`, `exchangeCode`, `refresh`, `useConnectWindow`; task 4 `resolveClient`, `assistantName`.
- Produces: `safeReturnTo(raw: unknown): string | null` — only a path starting `/oauth/authorize?` or `/search/open?`, no `//`, no `\`, ≤ 2,000 chars.
- Metadata JSON: `issuer`, `authorization_endpoint`, `token_endpoint`, `registration_endpoint`, `revocation_endpoint`, `scopes_supported: ["search:read","offline_access"]`, `response_types_supported: ["code"]`, `grant_types_supported: ["authorization_code","refresh_token"]`, `code_challenge_methods_supported: ["S256"]`, `token_endpoint_auth_methods_supported: ["none"]`, `client_id_metadata_document_supported: true`, `authorization_response_iss_parameter_supported: true`.
- [ ] **Step 1: failing tests:**
  - return-to: `safeReturnTo("https://evil.com")`, `"//evil.com"`, `"/search"`, `"/\\evil.com"` → null; `"/oauth/authorize?client_id=x"` and `"/search/open?hotel=1"` → themselves.
  - authorize page: no `code_challenge` or `code_challenge_method=plain` → error page, no code; unknown client / redirect not registered for that client → error page **without** redirecting; no open connect window → text "To connect an assistant, start from Agency settings → AI assistants." and no Allow button; with a window → shows assistant name, the can/can't lists of mockup 20 and "Continue only if you started this yourself in Claude or ChatGPT a moment ago."
  - Allow action: consumes the window (second Allow → refused), redirects to `redirect_uri?code=…&state=…&iss=<issuer>`; Deny → `error=access_denied&iss=…`; an ADMIN session cannot reach it.
  - token route: form-encoded only; `grant_type` other than the two → `unsupported_grant_type`; `scope=search:write` → `invalid_scope`; answers carry `Cache-Control: no-store`; rate limits of Global Constraints (61st per client → 429).
  - signed-out agent opening `/oauth/authorize?...` → `/login?next=...`; after sign-in and email code lands back on it.
- [ ] **Steps 2-4:** FAIL → implement → PASS. **Step 5:** commit `feat(ai): OAuth authorize, token and revoke endpoints`.

### Task 6: Internal AI search API

**Files:**
- Create: `src/server/ai/search-api.ts`, `src/app/api/ai/v1/search/route.ts`, `src/app/api/ai/v1/rates/route.ts`, `src/server/ai/links.ts`
- Test: `src/server/ai/search-api.test.ts`, `src/server/ai/links.test.ts`

**Interfaces:**
- Consumes: `verifyAiToken`, `serviceKeyMatches`, `startSearch(..., {source:"AI"})`, `listResults`, `getHotelOffers`, `suggestDestinations`, `audit`.
- Produces: `aiSearch(auth: AiAuth, body: unknown): Promise<ApiResult>`, `aiRates(auth: AiAuth, body: unknown): Promise<ApiResult>`; `type ApiResult = { status: 200 | 400 | 401 | 403 | 404 | 429 | 503; json: unknown }`; JSON shapes exactly as design §5 (snake_case).
- Produces (`links.ts`): `hotelLink(i: {hotelName, propertyId, destinationId, checkin, checkout, rooms: Occupancy[], nationality: string}): string` — `${APP_PUBLIC_URL}/search/open?dest=…&type=hotel&in=…&out=…&rooms=…&nat=<country name>&hotel=…&destId=…`; `parseRoomsParam("2-5-9,2")` → `[{adults:2,childAges:[5,9]},{adults:2,childAges:[]}]`, null on anything invalid.
- [ ] **Step 1: failing tests:**
  - no / wrong service key → 401 before any token lookup (spy); valid key, bad token → 401; 601st call per IP in a minute → 429.
  - `"answers carry no personal data"`: seed the agency with a client, a booking with guest names, a wallet balance; run both calls; `JSON.stringify(json)` contains none of the guest names, client email/phone, the balance amount, `priceCheckToken`, or `/expedia/i`.
  - ambiguous destination text → 200 with `candidates` (≤ 5) and no snapshot created.
  - unknown body field → 400; nationality not an ISO code → 400; dates/rooms out of range → 400 with the search service's message.
  - every call writes one `AuditLog` row with action `ai.search_hotels` / `ai.get_hotel_rates`, `targetType: "AiConnection"`, and the row's JSON contains no token.
  - 21st tool call by one agent in a minute → 429 `rate_limited`.
  - expired `search_id` → 404 with "This search expired. Run search_hotels again."; another agency's `search_id` → same 404.
  - supplier adapter spy: the call receives no `customerIp`; adapter test already pins `agent_tool` / `hotel_only`.
  - links: `hotelLink` round-trips through `parseRoomsParam`; `"2-5-9,2"` → as above; `"9"`, `"2-18"`, `"2,,2"`, 9 rooms → null.
- [ ] **Steps 2-4:** FAIL → implement → PASS. **Step 5:** commit `feat(ai): internal search API for the MCP server`.

### Task 7: Deny by default — booking and money endpoints refuse a search token

**Files:**
- Test: `src/server/ai/deny-by-default.test.ts`

- [ ] **Step 1: write the tests** (they should pass at once if tasks 3-6 are right; a failure is a bug to fix, never a test to relax):
  - `"only the AI API accepts a search token"`: scan `src/app/**/{route.ts,actions.ts,page.tsx}`; the only files importing `@/server/ai/search-api` or `verifyAiToken` are under `src/app/api/ai/`; no file under `src/app/api/ai/` imports `@/server/booking`, `@/server/wallet`, `@/server/clients`, `@/server/quotes`.
  - for every GET route handler among `bookings/[id]/voucher`, `bookings/[id]/statement`, `bookings/export`, `reporting/export`, `settings/logo`, `search/destinations`: call it with `Authorization: Bearer <valid search token>` and with cookie `apl_session=<that token>` (mocked `next/headers`) → redirect to `/login` (no data).
  - for every exported server action in `book/actions.ts`, `bookings/[id]/actions.ts`, `clients/actions.ts`, `quotes/actions.ts`, `settings/actions.ts`, `search/actions.ts`: same two requests → redirect to `/login`, and no `Booking`, `LedgerEntry`, `Client`, `Quote` row changes (count before = after).
  - `/api/ai/v1/*` with a valid *session cookie* and no token → 401.
- [ ] **Step 2:** run → PASS (fix code if not). **Step 3:** commit `test(ai): booking and money endpoints refuse search tokens`.

### Task 8: The MCP server

**Files:**
- Create: `src/mcp/server.ts` (http entry), `src/mcp/protocol.ts` (JSON-RPC), `src/mcp/tools.ts` (the two tools), `src/mcp/config.ts`, `src/mcp/apolles-client.ts`
- Modify: `eslint.config.mjs` (block for `src/mcp/**`: no import of `@/server/*`, `@/generated/*`, `@/app/*`, `pg`, `@prisma/*`, and `process.env` only through `src/mcp/config.ts`), `src/server/lint-guard.test.ts`
- Test: `src/mcp/protocol.test.ts`, `src/mcp/tools.test.ts`, `src/mcp/server.test.ts`

**Interfaces:**
- Consumes: the AI API of task 6 over HTTP (`POST ${APOLLES_INTERNAL_URL}/api/ai/v1/search|rates`, headers `Authorization: Bearer <agent token>`, `X-Apolles-Service-Key`), 10 s timeout.
- Produces: `createMcpServer(cfg: McpConfig, fetchFn = fetch): http.Server`; `McpConfig = { publicUrl: string; internalUrl: string; serviceKey: string; authServer: string; port: number }` read only from `MCP_PUBLIC_URL`, `APOLLES_INTERNAL_URL`, `AI_MCP_SERVICE_KEY`, `APP_PUBLIC_URL`, `PORT`.
- Behaviour: `POST /mcp` JSON-RPC (single or batch), methods `initialize` (answers the client's `protocolVersion` if in `["2025-03-26","2025-06-18","2025-11-25"]`, else `"2025-11-25"`; capabilities `{ tools: { listChanged: false } }`; no `Mcp-Session-Id`), `notifications/initialized` (202), `ping`, `tools/list`, `tools/call`; anything else → `-32601`. `GET /mcp` → 405. `GET /.well-known/oauth-protected-resource` and `/.well-known/oauth-protected-resource/mcp` → `{ resource: <publicUrl>/mcp, authorization_servers: [<APP_PUBLIC_URL>], scopes_supported: ["search:read"], bearer_methods_supported: ["header"] }`. No/invalid token (API 401) → HTTP 401 `WWW-Authenticate: Bearer resource_metadata="<publicUrl>/.well-known/oauth-protected-resource", scope="search:read"`. `Origin` header present and not `https://claude.ai` / `https://chatgpt.com` → 403. Body cap 64 KB.
- [ ] **Step 1: failing tests:**
  - `tools/list` returns exactly `["get_hotel_rates","search_hotels"]` (sorted), each with `annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }` and an `inputSchema` with `additionalProperties: false`.
  - `"no booking tool exists"`: no string matching `/book|cancel|voucher|balance|wallet|client|guest/i` among tool names; `tools/call` with `name: "book_hotel"` → JSON-RPC error `-32602`.
  - 401 + exact `WWW-Authenticate` when the API answers 401; the token is forwarded unchanged and the service key header is set (fetch spy); the token never appears in captured `console` output.
  - protocol: unknown version → `2025-11-25`; batch; malformed JSON → `-32700`.
  - lint-guard: `import { db } from "@/server/db"` and `process.env.DATABASE_URL` in `src/mcp/x.ts` fail lint.
  - `config.ts` throws at start if any of the five variables is missing, and reads no other variable (test sets `DATABASE_URL`, `EXPEDIA_API_KEY` and checks they are not in the returned config).
- [ ] **Steps 2-4:** FAIL → implement → PASS. **Step 5:** commit `feat(mcp): search-only MCP server`.

### Task 9: Result link page `/search/open`

**Files:**
- Create: `src/app/(agent)/search/open/page.tsx`, `src/app/(agent)/search/open/actions.ts`
- Test: additions in `src/app/search-pages.test.tsx`

**Interfaces:**
- Consumes: `parseRoomsParam`, `searchOneHotel` (source `WEB`), `requireAgent({ returnTo })`.
- [ ] **Step 1: failing tests:** rendering the page runs no search (adapter spy not called, no snapshot row); shows hotel name, dates, rooms text, nationality and a "Show rates" button; bad `rooms`/dates → the search page message "Check the destination, dates and guests."; the action redirects to `/search/<id>/hotels/<propertyId>`; an inactive hotel → "This hotel can no longer be booked. Choose another hotel."; signed out → `/login?next=/search/open?…` and back on the same page after sign-in.
- [ ] **Steps 2-4:** FAIL → implement → PASS. **Step 5:** commit `feat(ai): open an assistant result in Apolles`.

### Task 10: AI assistants tab

**Files:**
- Modify: `src/app/(agent)/settings/page.tsx` (tab `{ id: "ai", label: "AI assistants" }` only when `aiSearchEnabled()`), `src/app/(agent)/settings/actions.ts` (`connectAssistantAction`, `revokeAssistantAction`)
- Create: `src/app/(agent)/settings/ai-tab.tsx`
- Test: additions in `src/app/agency-settings.test.tsx`

- [ ] **Step 1: failing tests:** tab hidden when the switch is off; list shows "Claude" / "ChatGPT", "Connected <date> · last used <date|never>", Revoke; empty → "No assistants connected."; can/can't lists and notice copy exactly as mockup 20; Connect shows the MCP URL (`MCP_PUBLIC_URL/mcp`) with 3 steps for Claude and 3 for ChatGPT and opens a connect window (row exists for this session); Revoke of another agency's connection id changes nothing; Revoke writes `ai.revoke` and the next `verifyAiToken` → null.
- [ ] **Steps 2-4:** FAIL → implement → PASS. **Step 5:** commit `feat(ai): AI assistants tab in agency settings`.

### Task 11: Deployment files and documentation

**Files:**
- Modify: `deploy/staging/docker-compose.yml` (service `apolles-staging-mcp`: same image, entrypoint `node … src/mcp/server.ts`, `environment:` with only the five variables, **no `env_file`**, network `apolles_staging_net` + `n8n_default`, `mem_limit: 128m`), `deploy/staging/README.md` (Caddy: new subdomain → `apolles-staging-mcp:8080`; on the app site `respond /api/ai/* 404`; how to set `AI_SEARCH_ENABLED`, `AI_MCP_SERVICE_KEY`; how to add the connector in Claude and ChatGPT for a test), `.env.example` (new variables, no values) — the owner edits `.env.example` if the hook keeps it closed
- Test: `src/server/ai/compose.test.ts` — parses the compose file: the mcp service has no `env_file` and no variable named `DATABASE_URL`, `POSTGRES_*`, `EXPEDIA_*`.
- [ ] **Steps 1-4:** test FAIL → edit → PASS. **Step 5:** commit `chore(ai): staging service for the MCP server`.

### Task 12: Verify, review, PR

- [ ] `pnpm typecheck && pnpm lint && pnpm test && pnpm build` — all green, output read.
- [ ] `requesting-code-review`, `differential-review`, `/security-review` (auth, tokens, PII, supplier) on the branch; fix what is found.
- [ ] Manual check on staging after merge (owner's Caddy step first): add the connector in Claude, run both tools, open a link, revoke, confirm the next call fails. Not possible before the owner adds the subdomain.
- [ ] PR from the `claude/` branch per `CLAUDE.md`; tell the owner in Hebrew what changed and what was not verified (ChatGPT end-to-end, Expedia's answer).
