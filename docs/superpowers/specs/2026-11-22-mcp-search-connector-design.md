# Design: search-only AI connector (MCP) for Apolles agents

**Date:** 22.11.2026 · **Status:** approved by the owner in chat, 22.11.2026 ("מאשר"); see `docs/decisions/2026-11-22-ai-search-connector.md` · **Owner decision:** in chat, 22.11.2026
("Build a search-only MCP connector for Apolles agents"), with the security requirements quoted below.

Tags: **[owner]** = decided by Moshe. **[Claude]** = my call, the owner can change it. **[open]** = not decided.

## 1. Intent

Approved travel agents want to ask Claude or ChatGPT "find me a 4-star hotel in Cancun, 2 adults and a
child of 5, Oct 28 to Nov 4" and get real Apolles prices back, without opening Apolles first. When they pick
a hotel, they click a link and book **inside Apolles as usual**. The assistant is a search window, nothing
more.

## 2. Goals, non-goals, anti-goals

**Goals [owner]**
- A remote MCP server with exactly two read tools: `search_hotels` and `get_hotel_rates`.
- Each agent connects their own Claude or ChatGPT account with their own OAuth token, scope `search:read`.
- Every result carries a link to the hotel page in Apolles with the search in the URL.
- "AI assistants" tab in Agency settings (mockup 20, branch `claude/brave-goldberg-v7adee`): Connect
  assistant, list of connected assistants with Revoke, "can / can't do" lists.

**Non-goals [owner]**
- No booking, cancellation, voucher, balance, wallet, client or guest tool. **Not even a disabled one.**
- No other AI vendor, no API for third parties, no admin tools in the assistant.
- Building the full "search in URL" for screens 07/08/09 (mockups on the other branch). Only one entry
  route that reads the URL contract is built here (section 6).

**Anti-goals (failure even if it "works")**
- A token from the assistant opens anything other than search (booking, cancel, voucher, balance, clients,
  quotes, settings).
- A guest name, client detail, email, phone or wallet balance appears in any tool answer or log.
- The MCP server can reach Expedia or the database directly, or holds any Expedia key.
- A suspended agent's assistant keeps working, even for one call.
- The connector goes live for real agents before Expedia says yes.

## 3. Constraints

- `CLAUDE.md` in full: Zod at every boundary (unknown fields rejected), deny by default, every query scoped by
  `agencyId`, no secrets in logs, pnpm, exact versions, guardrails untouched.
- One supplier, Expedia Rapid, behind the adapter. The adapter already sends `sales_channel=agent_tool` and
  `sales_environment=hotel_only` on every shopping call and drops rates with `sale_scenario.package=true`
  (`src/server/supplier/expedia/adapter.ts` l. 280, 347; tested in `adapter.test.ts`). **[owner]** keep both;
  change only if Expedia says otherwise.
- Searches go through the existing search service (`src/server/search/search.ts`): same input rules
  (1-8 rooms, 1-8 adults, 0-6 children aged 0-17 per room, 1-28 nights, check-in up to 365 days ahead), same
  point of sale (the agency's country, TR2), same per-agency rate limits, same prices (exact Expedia totals,
  BP5). Nothing new talks to Expedia.
- GR1: no Expedia name or logo in tool answers.
- Facts from the official docs (checked 22.11.2026; the ChatGPT pages could only be read through search
  results, so they are re-checked in task 1 of the plan):
  - Claude: Streamable HTTP; OAuth with DCR or CIMD; PKCE S256 on every request; 401 with
    `WWW-Authenticate: Bearer resource_metadata=...`; the metadata's `resource` must equal the MCP URL
    exactly; redirect `https://claude.ai/api/mcp/auth_callback`; refresh tokens rotated, an expired one
    answers `invalid_grant`; token endpoint must answer within 10 s; Claude calls from Anthropic's cloud
    (`160.79.104.0/21`, `153.61.208.0/20`), so the MCP server and the sign-in pages must be public on 443.
    Claude supports the authorization specs 2025-03-26, 2025-06-18 and 2025-11-25.
  - ChatGPT: custom MCP servers added from the app's connector/plugin settings (full MCP on Business and
    Enterprise/Edu; Pro limited to read actions, which is all we have); CIMD preferred, DCR fallback; PKCE
    S256 required; sends `resource=<MCP URL>` on authorize and token requests; stable redirect
    `https://chatgpt.com/connector_platform_oauth_redirect` only with RFC 9207 (`iss` in every authorization
    response); tools without `readOnlyHint` are treated as write actions.
  - MCP spec: the server must publish RFC 9728 protected resource metadata, must check that a token was
    issued for it (audience, RFC 8707), must not pass a client's token on to a third party.
  - **Re-check 22.11.2026 (task 1).** Claude pages were read directly; ChatGPT pages (developers.openai.com,
    help.openai.com, learn.chatgpt.com) are blocked from the build network, so ChatGPT facts are
    **search-only** (summaries of the official pages) and must be confirmed once on the real ChatGPT connector
    screen before launch.
    - Claude's CIMD `client_id` is `https://claude.ai/oauth/mcp-oauth-client-metadata` (fetched: public client,
      `token_endpoint_auth_method: none`, redirect `https://claude.ai/api/mcp/auth_callback`). A second document
      `.../confidential_client` (`private_key_jwt`) exists; we do not advertise `private_key_jwt`, so Claude uses
      the first. Claude Code uses `https://claude.ai/oauth/claude-code-client-metadata` with loopback redirects;
      it is deliberately not allowed (no localhost), so Claude Code cannot connect.
    - Claude picks CIMD only if our authorization-server metadata has `client_id_metadata_document_supported: true`
      **and** `"none"` in `token_endpoint_auth_methods_supported`; otherwise it needs DCR. It also needs
      `code_challenge_methods_supported: ["S256"]`, a form-encoded token endpoint, `invalid_grant` for a bad
      refresh token, and adds `offline_access` only if `scopes_supported` lists it.
    - ChatGPT's CIMD `client_id` is `https://chatgpt.com/oauth/client.json` only when our server meets the
      RFC 9207 requirement (`authorization_response_iss_parameter_supported: true` in the metadata and `iss` in
      every authorization response, equal to the issuer). Otherwise ChatGPT uses
      `https://chatgpt.com/oauth/{callback_id}/client.json` and redirect `https://chatgpt.com/connector/oauth/{callback_id}`.
      With RFC 9207 it uses the stable redirect `https://chatgpt.com/connector_platform_oauth_redirect` (this exact
      string came from one translated OpenAI page, search-only). ChatGPT requires `code_challenge_methods_supported`
      with S256, echoes `resource`, and prefers CIMD (needs `client_id_metadata_document_supported: true`).
    - Result: no fact contradicts the plan's Global Constraints; task 4 must publish exactly the metadata fields above.

## 4. The pieces (how it fits together)

```
Claude / ChatGPT ──HTTPS──▶ MCP server (new, own container, own subdomain)
       │                      • no database, no Expedia keys, no access to booking code
       │                      • 2 tools, JSON-RPC over Streamable HTTP, stateless
       │                      • forwards the agent's token + its own service key
       │                                     │
       │ sign-in + consent                   ▼
       └──────────────────▶ Apolles app (existing)
                              • OAuth server: /.well-known/oauth-authorization-server, /oauth/authorize,
                                /oauth/token, /oauth/register, /oauth/revoke
                              • AI search API: /api/ai/v1/search, /api/ai/v1/rates
                                 (accepts ONLY: service key + search:read token)
                              • calls the existing search service → Expedia adapter
                              • "AI assistants" tab, /search/open (result links)
```

### 4.1 Tokens and connections [Claude, within the owner's rules]

New tables (Prisma migration):
- `AiClient`: a registered assistant client: id, `clientIdUrl` (CIMD) or generated id (DCR), display name
  ("Claude" / "ChatGPT", decided by its redirect URI, never by the name the client sends), redirect URIs,
  createdAt.
- `AiConnection`: one agent + one client: userId, agencyId, clientId, scope (always `search:read`),
  resource (the MCP URL), createdAt, lastUsedAt, revokedAt, revokedReason. This is what the AI assistants
  tab lists and what Revoke ends.
- `AiAuthCode`: hash of the code, connectionId-to-be (userId, clientId), redirectUri, PKCE challenge,
  resource, expiresAt (60 s), usedAt. Single use.
- `AiToken`: hash of the access token (1 hour) and of the refresh token (30 days, rotated on every use),
  connectionId, expiresAt, usedAt (refresh). Raw tokens are never stored or logged (same `hashToken` as
  sessions). Reusing an old refresh token revokes the whole connection (theft signal).

Rules:
- `scope` is always exactly `search:read`. A request for any other scope is refused (`invalid_scope`).
  The only extra accepted is `offline_access`, which only means "give a refresh token".
- Audience: `resource` must equal the configured MCP URL on authorize and token requests; the token is bound
  to it and the AI API checks it on every call.
- Redirect URIs: allowlist only — `https://claude.ai/api/mcp/auth_callback`,
  `https://chatgpt.com/connector_platform_oauth_redirect`, and `https://chatgpt.com/connector/oauth/<id>`.
  Any other redirect URI is refused at registration and at authorize. Claude Code's localhost callback is
  **not** allowed **[Claude]**: the owner named Claude and ChatGPT, and a localhost redirect cannot be tied
  to either.
- CIMD: only client-id URLs on the allowlist (`https://chatgpt.com/oauth/client.json` and Claude's, read in
  task 1) are fetched, with a 5 s timeout and a size cap; any other URL is refused without fetching (no
  SSRF). DCR: open registration, but only with allowlisted redirect URIs, `token_endpoint_auth_method=none`,
  per-IP rate limit.
- PKCE S256 required; `plain` refused. Authorization responses carry `iss` (RFC 9207).
- Consent page `/oauth/authorize`: needs a full agent session (`requireAgent`: password, email code on a new
  device). Shows "Claude wants to search hotels and rates for you. It can't book, cancel, issue vouchers or
  see guests or your balance." Allow / Deny. Admins cannot connect (no admin tokens exist).
- **Connect starts in Apolles (against consent phishing) [Claude].** Anyone can create a ChatGPT or Claude
  connector pointing at our MCP URL and send the sign-in link to an agent; the consent page cannot tell whose
  assistant account will get the token. So "Connect assistant" in the AI assistants tab opens a panel with
  the MCP URL, short steps for Claude and ChatGPT, and records a one-time "connect window" for that agent
  (10 minutes, one use, stored hashed against the session). `/oauth/authorize` allows Allow only inside an
  open window started from this agent's own session; otherwise it says "To connect an assistant, start from
  Agency settings → AI assistants" and issues nothing. The consent page also says "Continue only if you
  started this yourself in Claude or ChatGPT a moment ago."
- Signed-out agent on `/oauth/authorize`: after sign-in (and email code) they come back to the same
  authorize request. The login gets a `next` value that accepts **only** `/oauth/authorize?…` or `/search/open?…` on our own
  site (anything else is ignored: no open redirect).
- Every token check (each tool call) reads the database: token hash found, not expired, connection not
  revoked, scope `search:read`, resource = MCP URL, user ACTIVE, role AGENT, agency ACTIVE. No cache, so a
  revoke or suspension stops the next call.

### 4.2 Revoking
- Agent clicks Revoke in the AI assistants tab: the connection and all its tokens end at once (server action,
  `requireAgent`, scoped by agencyId, audit row `ai.revoke`).
- Agency suspended (`setAgencyStatus`): all connections of its users are revoked **in the same
  transaction** as the suspension (audit). Reactivation does not bring them back; the agent connects again.
- Password set/reset (`password-tokens.ts`) and lockout session-ending also revoke **[Claude]**: same rule as
  sessions ("password change ends everything").
- `/oauth/revoke` (RFC 7009) for the assistant itself.

### 4.3 Why the MCP server forwards the agent's token [Claude]
The token's audience is the MCP server. The MCP server has no database, so it cannot check the token itself.
It sends the token to Apolles, **the server that issued it**, together with its own service key; Apolles
checks it (as an introspection would) and answers the search in the same call. The token never goes to any
third party (not to Expedia, not anywhere else), which is what the MCP rule against "token passthrough"
protects. The AI API refuses any call without the service key, so a stolen agent token alone does nothing
outside the MCP server, and a stolen service key alone does nothing without an agent token.

## 5. The two tools [owner: names and purpose; Claude: fields]

Both tools: `readOnlyHint: true`, `destructiveHint: false`, `idempotentHint: true`, `openWorldHint: false`.
Inputs are strict Zod objects (unknown fields refused). Answers: a short text summary plus
`structuredContent` with the same data.

**`search_hotels`**
- Input: `destination` (text, 2-60 chars) **or** `destination_id`; `checkin`, `checkout` (YYYY-MM-DD);
  `rooms`: 1-8 × `{ adults: 1-8, child_ages: [0-17] × 0-6 }`; `nationality` (ISO 3166 country code, e.g.
  `IL`); optional `max_results` (default 10, max 20), `sort` (`recommended` | `price_asc` | `stars_desc`),
  `min_stars`, `free_cancellation_only`.
- Destination text is matched with the existing suggestions (`suggestDestinations`). One clear match (or an
  exact name match): search it. Several: no search; the answer lists up to 5 candidates (name, type, id)
  and asks to call again with `destination_id`.
- Output per hotel: `hotel_id`, name, city, stars, cheapest total for the whole stay (all rooms) in USD to
  the cent, nights, "free cancellation available", "fees to pay at the hotel" flag, number of other rates,
  and the Apolles link. Plus `search_id`, the destination used, total hotels found, and a fixed line: "Prices
  are checked again before booking. Book in Apolles."
- Uses `startSearch` + `listResults` of the agent's agency (point of sale = agency country).

**`get_hotel_rates`**
- Input: `search_id`, `hotel_id` (both from `search_hotels`).
- Output: hotel name, city, stars, stay; per rate: room name, bed types (with "Bed type is a request and not
  guaranteed"), refundable or not, free cancellation until (date/time from the penalties), total for the
  stay, taxes and fees line, fees due at the hotel (USD and local currency, BP4), up to 10 amenities; the
  Apolles link. Up to 30 rates, cheapest first.
- Uses `getHotelOffers` of the agent's agency. Price-check tokens never leave the server.
- If the search expired (30 minutes): "This search expired. Run search_hotels again."

**Never in an answer:** guest names, client data, emails, phones, wallet balance, booking data, Expedia
names, price-check tokens, internal ids other than `search_id` / `hotel_id` / `destination_id`.

**Nationality:** Rapid shopping has no nationality field; Apolles sends the agency's country as point of sale
(TR2, `src/server/search/input.ts`). The tool asks for it because the owner wants it and the result link
carries it (`nat`), but it does not change the price. The answer says so in one line. (The app's own search
form on `main` has no nationality field yet; see section 9.)

## 6. Result links (`/search/open`) [Claude, on the mockup's URL contract]

The URL contract from mockup 07 (branch `claude/brave-goldberg-v7adee`): `dest` (text), `type`
(`city|area|region|airport|hotel`), `in`, `out` (YYYY-MM-DD), `rooms` (rooms joined by `,`, each room =
adults then child ages joined by `-`, e.g. `2-5-9,2`), `nat` (country name).

Text names are not unique, so the link adds two ids: `hotel` (property id) and `destId` (destination id).
Example: `https://<app>/search/open?dest=Hyatt+Ziva+Cancun&type=hotel&in=2026-10-28&out=2026-11-04&rooms=2-5,2&nat=Israel&hotel=12345&destId=6023`.

`GET /search/open`: `requireAgent` (normal sign-in, with return to this link after sign-in; the
assistant's token is not accepted), Zod-parses the query and shows a short page: hotel, dates, rooms,
nationality and a **"Show rates"** button. Opening the link changes nothing and calls no supplier (a hostile
page cannot make the agent's browser burn searches). The button is a server action (CSRF-safe) that runs
`searchOneHotel` (agency search limit) and redirects to the existing hotel page
`/search/{snapshotId}/hotels/{propertyId}`. Bad or expired input → the search page with the fields filled
where possible. The link holds no token and no personal data. Prices are fetched fresh, so
the agent may see a price different from the assistant's; the hotel page is the truth.

## 7. Limits and logging [owner: "rate limited per agent, every call audit-logged"; Claude: numbers]

- Per agent: 20 tool calls per minute and 500 per day (`ai:user:{id}` buckets in the existing Postgres
  rate limiter).
- **The assistant never crowds out the agent's own screens [Claude].** Assistant searches have their own
  per-agency bucket (`ai-search:agency:{id}`, 10 per minute) instead of sharing the screens' 30. Search
  snapshots get a `source` column (`WEB` / `AI`); the "keep the newest 50 per agency" cleanup counts and
  deletes each source separately (AI: newest 20), so an assistant can never delete the search behind a
  booking the agent is making. The hotel-page limit (120/min) is shared.
- OAuth: Claude and ChatGPT call from shared cloud addresses, so per-IP limits would lock out every agent
  at once. `/oauth/token`: per client and per connection (60 per 15 minutes), plus a loose per-IP ceiling
  (2,000 per 15 minutes). `/oauth/register`: per IP 100 per hour (only allowlisted redirect URIs register
  anyway). `/oauth/authorize` uses the agent session.
- Every tool call writes one `AuditLog` row: actor = the agent, action `ai.search_hotels` /
  `ai.get_hotel_rates`, target `AiConnection/<id>`, `after` = destination id, dates, room count, number of
  results, outcome (`ok` / `rate_limited` / `invalid` / `unavailable`). No token, no IP, no names. Also
  `ai.connect`, `ai.revoke`, `ai.revoke_all` (suspension).
- MCP server logs: method, tool name, status, duration. Never headers, tokens or arguments.

## 8. Switch and deployment

- `AI_SEARCH_ENABLED` (default off), one switch for every active agency **[Claude]** (a per-agency switch
  would be new admin scope; ask if wanted). Off: the AI tab is hidden, `/oauth/*`, `/api/ai/*` and the
  discovery documents answer 404.
- The AI API is internal only: the MCP container calls the app over the private Docker network
  (`http://apolles-staging:3000`); Caddy refuses `/api/ai/*` from the internet (owner adds the rule; steps in
  the README). The app also checks the service key in constant time and counts a per-IP limit **before** the
  key check, so guessing the key is slow and visible. **[owner]** "Do not go live before Expedia's answer": staging may turn it on (fake
  supplier); production only when the owner turns it on after Expedia says yes.
- New settings, documented in `.env.example`: `AI_SEARCH_ENABLED`, `MCP_PUBLIC_URL`,
  `AI_MCP_SERVICE_KEY` (app side: stored as a hash or compared in constant time), `APP_PUBLIC_URL`.
- MCP server: `src/mcp/` in this repository, run as its own container (`apolles-staging-mcp`) from the same
  image with its own entrypoint, and **only** these variables: `MCP_PUBLIC_URL`, `APOLLES_INTERNAL_URL`,
  `AI_MCP_SERVICE_KEY`, `PORT`. No `env_file`, so no database URL or Expedia key reaches it. A lint rule and
  a test forbid `src/mcp/**` from importing `src/server/**`, `src/generated/**` or the database.
- Staging: a new public subdomain for the MCP server behind the existing Caddy (owner adds the route;
  steps in `deploy/staging/README.md`). Production: owner's action, as always.

## 9. Open items (do not block the plan)

1. **Expedia [owner asks]:** may Rapid rates and content be shown inside Claude/ChatGPT (third-party servers)?
   Which `sales_channel`: `agent_tool` (current) or something else? (Rapid's list also has `meta`: "Rates will
   be passed to and displayed on a 3rd party comparison website".) And: Rapid wants the customer's IP
   (`Customer-Ip`); from an assistant we do not have the agent's IP, so these searches send none (never the
   assistant's or our own IP). Is that acceptable? Production stays off until the answer.
2. **ChatGPT details:** the OpenAI pages could not be opened directly from this session (network block);
   task 1 of the plan re-checks them (CIMD URL, redirect pattern, plans) and Claude's CIMD client id URL.
3. **MCP protocol version:** Claude lists support up to 2025-11-25; the newest spec is 2026-07-28 (which
   removed the initialize handshake). The server answers 2025-06-18 and 2025-11-25 clients (and 2025-03-26),
   which both Claude and ChatGPT speak today.
4. **New dependency: none planned [Claude].** The official TypeScript SDK v2 (`@modelcontextprotocol/server`)
   implements only 2026-07-28, which Claude does not list yet; v1 (`@modelcontextprotocol/sdk`) is in
   maintenance and pulls a web framework. Two read tools over stateless JSON-RPC are about 300 lines on
   `node:http` + Zod (already used). If the plan's review finds the hand-written protocol too risky, the
   fallback is SDK v1 after the `supply-chain-risk-auditor` skill and the owner's OK.
5. **How to record this feature [owner decides]:** the approved spec is guarded and does not mention it.
   Recommended: a decision file `docs/decisions/2026-11-22-ai-search-connector.md` (Hebrew, plain words)
   quoting the owner's chat decision and linking this design, as done for earlier owner decisions. The
   alternative is that the owner adds a section to the approved spec himself.
6. **Nationality in Apolles' own search form:** the spec (row 4) and mockup 07 have it, `main` does not. Not
   built here.

## 9a. Gate

Nothing is built until the owner (a) approves this design and its plan in chat and (b) says how the feature is
recorded (open item 5). The plan's first task writes that record.

## 10. Left to the builder

File names inside the folders above, table column details, exact copy of the consent page and tool texts
(within section 5), the order of tasks, and the test layout. All under `CLAUDE.md`.
