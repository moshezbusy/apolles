---
stepsCompleted: [1, 2, 3, 4, 5, 6, 7, 8]
inputDocuments:
  - _bmad-output/planning-artifacts/prd.md
  - _bmad-output/planning-artifacts/prd-validation-report.md
  - _bmad-output/planning-artifacts/product-brief-Apolles-2026-03-09.md
  - _bmad-output/planning-artifacts/ux-design-specification.md
workflowType: 'architecture'
lastStep: 8
status: 'complete'
completedAt: '2026-03-11'
project_name: 'Apolles'
user_name: 'Moshe'
date: '2026-03-10'
---

# Architecture Decision Document

_This document builds collaboratively through step-by-step discovery. Sections are appended as we work through each architectural decision together._

## Project Context Analysis

### Requirements Overview

**Functional Requirements:**

73 FRs across 8 domains, each with distinct architectural implications:

| Domain | FRs | Architectural Weight |
|--------|-----|---------------------|
| Hotel Search & Discovery (FR1-FR10) | 10 | Heavy — multi-supplier orchestration, parallel API calls, hotel mapping integration, progressive loading, supplier abstraction |
| Quote & Itinerary Management (FR11-FR16) | 6 | Medium — multi-city data aggregation, PDF generation engine, role-based price visibility on output documents |
| Booking Flow (FR17-FR26) | 10 | Heavy — price check validation, wallet-gated logic, PCI/SCA payment flows, Expedia compliance display, supplier-specific booking APIs |
| Booking Management (FR27-FR37) | 11 | Heavy — auto-cancellation scheduling (highest reliability requirement), voucher lifecycle, batch operations, audit trail, modification routing |
| HCN Verification (FR38-FR44) | 7 | Medium — automated email dispatch, status state machine, template management, dashboard aggregation |
| Wallet & Finance (FR45-FR54) | 10 | Heavy — atomic balance operations, race condition prevention, cascading multi-layer markup calculation, invoice generation, 7-year retention |
| User Management & Profile (FR55-FR64) | 10 | Medium — self-service registration, RBAC permission matrix (fast-follow), agency hierarchy, role-based data visibility enforcement |
| Platform Administration (FR65-FR72) | 8 | Medium — cross-tenant visibility, supplier health monitoring, mapping management, booking investigation, escalation tracking |

**Non-Functional Requirements:**

36 NFRs that directly shape architectural decisions:

- **Performance (NFR1-9):** 5s search p95, 2s progressive first results, 3s price check, 50 concurrent agents at launch, sub-500ms mapping lookups
- **Security (NFR10-18):** PCI DSS (SAQ-A/A-EP), encrypted credentials at rest, password hashing with breach-list checking, API-level RBAC enforcement, immutable financial audit trail, OWASP Top 10 protection, PSD2/SCA 3D Secure
- **Reliability (NFR19-24):** 99.5% uptime during business hours, RPO < 1 minute / RTO < 4 hours, 99.9% auto-cancellation success rate, full supplier-failure isolation, scheduled job monitoring with tiered alerting, fully atomic wallet operations
- **Scalability (NFR25-29):** Scale to 500 concurrent agents, new supplier in ≤2 dev-weeks, 2M+ hotel mapping records in sub-second lookups, 100K+ bookings/year without query degradation, 1000+ emails/day
- **Integration (NFR30-36):** Unified data model normalization across suppliers, 5s timeout with fail-fast and auto-recovery, full request/response logging, supplier health alerting, 24h Vervotech sync, email delivery tracking with bounce surfacing, tokenized card storage 99.9%+

**Scale & Complexity:**

- Primary domain: Full-stack B2B SaaS with heavy API integration backend
- Complexity level: High
- Estimated architectural components: 12-15 major subsystems

### Technical Constraints & Dependencies

| Constraint | Impact | Source |
|-----------|--------|--------|
| Expedia Rapid API v3 (SHA-512 signature auth) | Dictates booking flow: Shopping → Price Check → Booking → Management. Must pass B2B site review before production API key. | PRD FR21, Domain Requirements |
| TBO Holidays API v1.4 (Basic Auth) | Different flow: HotelSearch → PreBook → Book → BookingDetail → Cancel. Payment modes: Limit (wallet/credit) and credit card. | PRD Integration List |
| Vervotech Hotel Mapping API | External dependency for deduplication. <24h mapping for integrated suppliers. If down, search works but deduplication degrades. | PRD FR3-FR4, NFR9, NFR34 |
| PCI DSS SAQ-A/A-EP | No raw card storage. Tokenization mandatory. Payment gateway must be PCI-certified. Final SAQ type depends on integration model. | PRD Domain Requirements |
| Expedia B2B Site Review | Hard launch gate. All display requirements (taxes, cancellation, check-in, SCA, T&Cs) must be correct before production access. | PRD Domain Requirements |
| PSD2/SCA Exemption Logic | European card payments require 3D Secure determination: exempt vs. required vs. fallback. Affects payment flow branching. | PRD Domain Requirements |
| GDPR Data Retention | 5 data categories with different retention periods (90 days to 7 years). Right to erasure with anonymization. DPAs with all third parties. | PRD Data Privacy |
| UX Tech Stack: Next.js App Router + shadcn/ui | Frontend framework is decided. Server components by default, explicit client boundaries. Affects SSR/hydration architecture. | UX Spec Design System |
| Real-time Push (WebSocket/SSE) | Auto-cancel countdowns, HCN status, wallet balance require push updates. UX spec explicitly prohibits polling. | UX Spec AutoCancelCountdown, WalletWidget |
| Desktop-first Responsive | Full experience at ≥1280px. Degraded but functional at tablet/mobile. State must persist across breakpoint transitions. | UX Spec Responsive Strategy |

### Cross-Cutting Concerns Identified

| Concern | Affected Components | Architectural Implication |
|---------|-------------------|--------------------------|
| **Role-based data visibility** | Every API endpoint, every response payload, every UI component, PDF generation | Must be enforced at API/service layer — not UI-only. Each request must resolve the caller's role and filter data accordingly. Supplier names, cost prices, and markup layers invisible to unauthorized roles. |
| **Supplier abstraction** | Search, booking, management, cancellation, price check, data normalization | Unified interface over heterogeneous supplier APIs. New supplier addition must not touch core business logic. Different auth, different flows, different data formats all normalized behind a common contract. |
| **Cascading markup calculation** | Search results display, booking confirmation, quote PDF, voucher, invoice, wallet deduction | 4-layer multiplicative chain. Each layer applies percentage to its visible cost. Must be calculated consistently everywhere prices appear. Rounding to 2 decimals (half-up) at each layer. |
| **Audit trail / immutable logging** | All financial transactions, booking lifecycle events, admin actions, HCN status changes | Append-only event log. Every state change recorded with timestamp, actor, and details. 7-year retention for financial records. |
| **Multi-tenancy with data isolation** | All data access, all queries, all API responses | Agent data is tenant-isolated. Agency-level sharing per RBAC. Platform owner has cross-tenant access. Every query must be scoped. |
| **Timezone normalization** | Auto-cancellation deadlines, booking dates, supplier responses | All cancellation deadlines converted to UTC on ingestion. Safety buffer applied against normalized time. Display in agent's configured timezone. |
| **Graceful degradation** | Search, booking, mapping, email delivery, payment | Every external dependency can fail. System must degrade gracefully: partial search results, mapping bypass, manual HCN fallback, payment retry. Never a blank screen or unrecoverable error. |
| **Data format normalization** | Room types, cancellation policies, tax breakdowns, meal plans, amenities from each supplier | Unified Apolles data model. 100% of bookable fields mapped for Expedia and TBO at launch. Normalization happens at the supplier adapter layer. |

## Starter Template Evaluation

### Primary Technology Domain

Full-stack web application (Next.js + API/backend integrations) based on project requirements analysis.

### Starter Options Considered

1. **create-next-app (official Next.js starter)**
   - Strengths:
     - Official, stable, minimal baseline
     - App Router + TypeScript + Tailwind defaults
     - Strong Vercel alignment
   - Gaps for this project:
     - Prisma, NextAuth.js, and PostgreSQL wiring must be added manually
     - More architecture/setup decisions left to implementation phase
   - Best for:
     - Teams wanting maximum control and willing to assemble auth/db stack manually

2. **create-t3-app (modular full-stack starter)**
   - Strengths:
     - Supports Next.js App Router + TypeScript + Tailwind
     - Can scaffold Prisma + NextAuth.js + PostgreSQL in one command
     - Well-aligned with requested stack and beginner-friendly scaffolding
   - Gaps/considerations:
     - Opinionated structure; includes optional ecosystem choices (must select minimal set intentionally)
   - Best for:
     - Fast setup with sane defaults and reduced manual wiring

3. **Custom assembly from multiple templates/examples**
   - Strengths:
     - Full customization
   - Gaps:
     - Highest risk for configuration drift and integration errors
     - Not ideal for beginner profile and high-complexity regulated scope
   - Best for:
     - Experienced teams with strong architecture/platform engineering capacity

### Selected Starter: create-t3-app

**Rationale for Selection:**
For this project and user profile, create-t3-app provides the best balance of speed, safety, and maintainability. It scaffolds the exact preferred stack (TypeScript + App Router + Tailwind + Prisma + NextAuth + Postgres) while minimizing manual setup risk that commonly impacts beginner teams. This keeps early implementation focused on core business complexity (supplier integrations, wallet reliability, auto-cancel system, compliance) instead of framework wiring.

**Initialization Command:**

```bash
pnpm dlx create-t3-app@latest apolles --CI --appRouter --tailwind --prisma --nextAuth --dbProvider postgres --trpc false --drizzle false
```

**Architectural Decisions Provided by Starter:**

**Language & Runtime:**
TypeScript-first Node.js setup with Next.js App Router baseline.

**Styling Solution:**
Tailwind CSS configured from initialization.

**Build Tooling:**
Next.js production build/dev pipeline with Vercel-first deployment compatibility.

**Testing Framework:**
Baseline project quality tooling present; project-specific automated test strategy still to be defined in architecture decisions.

**Code Organization:**
Modern Next.js App Router structure with server/client boundary patterns aligned to UX requirements.

**Development Experience:**
Fast local startup, typed environment, generated auth/db scaffolding, and reduced manual integration complexity for beginners.

**Operational Foundation Note:**
Use managed PostgreSQL infrastructure compatible with Vercel deployment and enforce strict environment-variable handling from day one.

**Note:** Project initialization using this command should be the first implementation story.

## Core Architectural Decisions

### Decision Priority Analysis

**Critical Decisions (Block Implementation):**
- Data modeling with tenant scoping (affects every query)
- Session strategy and RBAC enforcement (affects every endpoint)
- PCI compliance approach (affects payment flow architecture)
- Supplier credential security (affects integration layer)
- Financial operation integrity (affects wallet and booking reliability)

**Important Decisions (Shape Architecture):**
- Caching strategy (affects performance targets)
- Data validation approach (affects data quality across all inputs)
- API security layers (affects operational safety)

**Deferred Decisions (Post-MVP):**
- SAQ A-EP upgrade (revisit only if hosted payment redirect UX proves insufficient)
- External secrets manager (revisit if moving to multi-cloud or stricter compliance requirements)
- Schema-per-tenant isolation (revisit only if tenant count exceeds thousands)

### Data Architecture

**Data Modeling Approach:**
Single PostgreSQL database with row-level tenant scoping. Every tenant-sensitive table includes `agentId` and/or `agencyId` columns. All queries scoped by tenant context resolved from the authenticated session. Platform owner queries bypass tenant scoping for cross-tenant operations. Standard approach for B2B SaaS at 50–500 tenant scale.

**Caching Strategy:**
Redis as dedicated cache layer alongside PostgreSQL. Primary uses: hotel mapping cache (2M+ records, sub-500ms lookups), session data, real-time pub/sub backbone for SSE (wallet balance updates, auto-cancel countdowns, HCN status changes), and supplier response caching where appropriate. In-memory caching reserved for application-level hot data (config, static lookups) only.

**Migration Strategy:**
Prisma Migrate for schema-first, auto-generated SQL migrations. Greenfield project with Prisma ORM — no reason to introduce a separate migration tool. Migration files committed to version control and applied sequentially per environment.

**Data Validation Strategy:**
Zod as the single validation library across the entire stack. Validates user input (forms, API requests), supplier API response data (Expedia, TBO, Vervotech), and internal data contracts. Integrates with Prisma via `zod-prisma-types` for schema-derived validators. Shared validation schemas between client and server for consistency.

**Audit Trail / Immutable Logging:**
Dedicated `audit_events` table in PostgreSQL. Append-only — no UPDATE or DELETE operations permitted at the database role level. Every state change (financial transactions, booking lifecycle events, admin actions, HCN status changes) recorded with timestamp, actor ID, action type, entity reference, and before/after payload. 7-year retention for financial records. Queryable for admin investigation and compliance.

**Financial Data Integrity:**
PostgreSQL row-level locking with Prisma interactive transactions for atomic wallet operations. `SELECT ... FOR UPDATE` on wallet balance row during booking confirmation to prevent race conditions from concurrent bookings. No external ledger service at launch scale.

### Authentication & Security

**Session Strategy:**
Database sessions via NextAuth.js + Prisma adapter stored in PostgreSQL. Sessions can be instantly revoked when permissions change, when a sub-agent is removed, or during security incidents. The extra database lookup per request is negligible at launch scale (50–500 agents) and provides a meaningful security advantage over stateless JWT sessions for a financial platform.

**RBAC Enforcement:**
Server-side authorization enforced at the API / server action boundary. The UI hides or shows actions for usability, but the real authorization gate is server-side. Authorization logic centralized in a dedicated service/helper layer that enforces both role-based permissions and tenant-scoped data access. Avoids scattered permission checks across the codebase — every protected operation calls through a single authorization module that resolves the caller's role and tenant context.

**PCI Compliance Approach:**
SAQ-A at launch using hosted payment page / redirect flow (e.g., Stripe Checkout). Zero card data touches Apolles servers. Simplest PCI scope, lowest frontend security burden, fastest implementation path. Agents are redirected to the payment gateway for wallet top-ups and any direct card payment flows. SAQ A-EP (embedded payment fields) deferred — revisit only if the redirect UX proves insufficient for agent workflow speed.

**API Security:**
Standard layered approach: HTTPS everywhere (enforced at infrastructure), CSRF protection via NextAuth.js built-in tokens, rate limiting at the API route level with Redis backend, Zod-based input validation on all endpoints, framework-safe defaults for OWASP Top 10 (Next.js XSS protection, HttpOnly/Secure/SameSite cookies via NextAuth, Prisma parameterized queries for SQL injection prevention). **Idempotency keys required for all sensitive financial actions** — wallet deductions, booking confirmations, payment processing, and retry flows. Implemented via unique idempotency tokens stored in the database to guarantee exactly-once semantics on critical operations.

**Supplier Credential Storage:**
Supplier API credentials (Expedia SHA-512 keys, TBO Basic Auth credentials) encrypted at rest in PostgreSQL using AES-256. Decrypted only at runtime inside the supplier adapter layer. Encryption keys stored in environment variables / deployment secrets — never in code or database. No dedicated external secrets manager at launch; revisit if infrastructure complexity increases.

### API & Communication Patterns

**Internal API Pattern:**
Hybrid approach — Next.js Server Actions for all frontend-to-backend operations (mutations and queries from UI components), Route Handlers reserved only for external-facing endpoints (payment gateway webhooks, supplier callbacks, future public API). Server Actions provide type-safe, zero-boilerplate communication between client and server with no manual API route definitions. This is the simplest path aligned with the App Router architecture.

**External Supplier Communication:**
Adapter pattern with a unified interface contract. Each supplier (Expedia, TBO, Vervotech) gets a dedicated adapter implementing a common interface: `search()`, `priceCheck()`, `book()`, `cancel()`, `getBookingDetail()`. Business logic calls the interface, never a specific supplier. New supplier integration = new adapter class, zero changes to core business logic. Directly supports the NFR requirement of new supplier onboarding in ≤2 dev-weeks.

- **Timeouts:** 5-second timeout per supplier API call (NFR requirement). Fail-fast on timeout — return partial results from responsive suppliers rather than blocking on a slow one.
- **Circuit breaker:** Track consecutive failure counts in Redis per supplier. Open circuit after threshold failures, automatically retry after cooldown period. Prevents cascading slowdowns when a supplier is degraded.
- **Request/response logging:** Every supplier API call logged to a dedicated `supplier_api_logs` table with request payload, response payload, latency, HTTP status, and supplier identifier. Essential for debugging, Expedia certification evidence, supplier dispute resolution, and health monitoring dashboards.

**Real-Time Implementation:**
Server-Sent Events (SSE) for all push updates: auto-cancel countdowns, HCN status changes, and wallet balance updates. SSE is unidirectional (server → client), simpler to implement and operate than WebSockets, works over standard HTTP, and has built-in browser reconnection. No bidirectional real-time messaging is required. Redis pub/sub feeds events into SSE connections — when a backend process updates a booking status, wallet balance, or HCN state, it publishes to Redis, and the SSE handler pushes to connected clients.

**Error Handling Standards:**
Structured error responses with a consistent shape across all operations: `{ code, message, details? }`. Typed error codes used throughout the stack (not just HTTP status codes) so the frontend can handle specific failure cases programmatically — e.g., `WALLET_INSUFFICIENT`, `PRICE_CHANGED`, `SUPPLIER_TIMEOUT`, `RATE_UNAVAILABLE`, `SESSION_EXPIRED`, `PERMISSION_DENIED`. Each supplier adapter translates supplier-specific error formats into Apolles error codes. Business logic and frontend never see raw supplier error structures.

### Frontend Architecture

**State Management:**
No global state library. Server Components fetch fresh data by default — no client-side cache to manage or synchronize. URL search params for search/filter state (shareable, bookmarkable, survives refresh). `useState`/`useReducer` for ephemeral UI state only (modals, dropdowns, in-progress form fields). The quote builder — the one workflow that spans multiple searches and sessions — persists its state server-side in the database and is accessed via Server Components, not a client-side store. SSE handles real-time updates (wallet balance, auto-cancel countdowns, HCN status) without requiring client-side data caching.

**Form Handling:**
React Hook Form + Zod. React Hook Form for performant form state management (no re-renders on every keystroke), Zod for validation (shared schemas between client and server — already chosen as the stack-wide validation library). shadcn/ui form components integrate natively with both. Used across all complex forms: search parameters, booking guest details, profile settings, quote customization, admin configuration.

**Server/Client Component Boundaries:**
Server Components by default. Client boundaries drawn at the interaction point — the leaf component that requires user interaction or browser APIs. Pages and layouts remain Server Components. Client Components only where required: search form inputs, real-time countdown displays (SSE subscription), wallet widget, quote builder interactions, modal dialogs, dropdown menus. Each client boundary is as narrow as possible to minimize the client bundle.

**PDF Generation:**
Server-side PDF generation using `@react-pdf/renderer`. Quote PDF and voucher templates defined as React components, rendered to PDF on the server. No headless browser required (lighter than Puppeteer/Playwright, simpler to deploy on serverless). Consistent output across all environments. Templates enforce role-based data visibility — PDFs render only the data the requesting agent's role is authorized to see (client price only, no internal pricing or supplier information).

### Infrastructure & Deployment

**Hosting Strategy:**
Vercel for the Next.js application (zero-config deployments, automatic preview environments per PR, edge network, serverless functions for API routes and Server Actions). Managed services for supporting infrastructure:

- **PostgreSQL:** Managed service (Neon, Supabase, or Railway Postgres) compatible with Vercel deployment and Prisma ORM. Specific provider selected during implementation based on pricing, connection pooling support, and regional availability.
- **Redis:** Upstash (serverless Redis with Vercel integration) for caching (hotel mapping, supplier responses), session data, real-time pub/sub (SSE event distribution), and circuit breaker state tracking.
- **Scheduled Jobs:** Vercel Cron Jobs for basic scheduling (Vervotech mapping sync, routine maintenance). **Inngest or Trigger.dev** (serverless job service, deployed alongside Vercel) for reliability-critical operations — specifically auto-cancellation, which requires built-in retry with exponential backoff, dead-letter tracking, failure observability, and guaranteed delivery to meet the 99.9% success rate NFR. Specific service selected during implementation.
- **SSE Connections:** Vercel Edge Functions for long-lived streaming responses (auto-cancel countdowns, wallet balance updates, HCN status push). Edge Functions support extended streaming durations beyond standard serverless function limits.

**CI/CD Pipeline:**
GitHub Actions + Vercel. Push to GitHub triggers Vercel auto-deploy. GitHub Actions runs tests, linting, type checks, and Prisma schema validation before deploy. Vercel handles build and deployment. Preview deployments generated automatically on every PR for visual review and testing. No custom pipeline infrastructure to maintain.

**Monitoring & Logging:**

- **Application monitoring:** Vercel Analytics (built-in) for web vitals and frontend performance. Sentry for server-side error tracking and alerting (free tier covers launch scale).
- **Supplier health monitoring:** Custom dashboard in admin panel built from `supplier_api_logs` table — response times, error rates, circuit breaker status per supplier. Threshold-based alerting on degradation.
- **Structured logging:** Consistent JSON log format across all server-side code. Logs routed to Vercel's built-in log drain at launch. Axiom (Vercel-integrated) available if log volume or query needs grow.
- **Job observability:** Inngest/Trigger.dev dashboard for auto-cancellation job monitoring — success/failure rates, retry counts, dead-letter queue visibility.
- **Alerting:** Sentry for application errors. Vercel Cron failure alerts for basic scheduled jobs. Job service alerts for auto-cancellation failures. Custom alerting (email or Slack webhook) for critical business events: auto-cancellation failures after retries, wallet operation errors, supplier circuit breaker trips.

**Environment Configuration:**
Vercel environment variables for all secrets and configuration, with separate values per environment (development, preview, production). `.env.local` for local development (gitignored). `@t3-oss/env-nextjs` (included in T3 starter) for type-safe environment variable validation at build time — prevents deploying with missing configuration. All supplier credentials, database URLs, Redis URLs, encryption keys, and third-party API keys managed through this system.

### Decision Impact Analysis

**Implementation Sequence:**
1. Project initialization (create-t3-app) + environment setup (Vercel, PostgreSQL, Redis)
2. Database schema + Prisma models + tenant scoping foundation
3. Authentication (NextAuth + database sessions) + RBAC authorization layer
4. Supplier adapter layer (Expedia + TBO) with logging, timeouts, circuit breaker
5. Core business logic (search, booking, wallet, markup calculation)
6. Frontend pages with Server Components + client boundaries
7. Real-time (SSE + Redis pub/sub)
8. Auto-cancellation system (Inngest/Trigger.dev)
9. PDF generation (quotes + vouchers)
10. HCN verification system
11. Admin dashboard + monitoring
12. Payment integration (Stripe SAQ-A)
13. Compliance review (Expedia site review, PCI attestation)

**Cross-Component Dependencies:**
- Supplier adapter layer must be built before search, booking, or any supplier-dependent feature
- RBAC authorization layer must be built before any data-visibility-sensitive endpoint
- Wallet with atomic locking must be built before booking flow (wallet-gated logic)
- Redis must be provisioned before caching, real-time, or circuit breaker features
- Zod validation schemas should be defined alongside Prisma models for consistency
- Audit trail inserts must be wired into every state-changing operation from the start — retrofitting is error-prone
- Markup calculation module must be centralized before any price-displaying feature (search results, quotes, vouchers, invoices)

## Implementation Patterns & Consistency Rules

### Pattern Categories Defined

**Critical Conflict Points Identified:** 25+ areas where AI agents could make different implementation choices. The patterns below eliminate ambiguity and ensure all code written by any agent is structurally compatible.

### Naming Patterns

**Database Naming Conventions:**
- Models: PascalCase singular — `User`, `Booking`, `WalletTransaction`, `HotelMapping`
- Table names: Prisma auto-maps to lowercase. Use `@@map()` only if explicit override is needed.
- Columns: camelCase in Prisma schema — `createdAt`, `agentId`, `supplierRefNumber`
- Relations: Named by the related model — `agent`, `booking`, `walletTransactions`
- Enums: PascalCase name, SCREAMING_SNAKE values — `enum BookingStatus { CONFIRMED, VOUCHERED, AUTO_CANCELLED, CANCELLED }`
- Indexes: Prisma's default naming. No manual index name overrides unless required for clarity.

**API & Data Naming Conventions:**
- JSON fields: camelCase everywhere — `agentId`, `checkInDate`, `cancellationPolicy`. No snake_case in API responses.
- Route Handlers: kebab-case paths — `/api/webhooks/stripe-callback`, `/api/webhooks/supplier-notification`
- URL search params: camelCase — `?checkIn=2026-04-01&roomCount=2`

**Code Naming Conventions:**
- Files: kebab-case for all files — `booking-service.ts`, `wallet-widget.tsx`, `use-search-params.ts`
- Components: PascalCase export — `export function WalletWidget()` in file `wallet-widget.tsx`
- Functions/variables: camelCase — `getBookingById`, `calculateMarkup`, `isWalletSufficient`
- Constants: SCREAMING_SNAKE for true constants — `MAX_SEARCH_TIMEOUT_MS`, `DEFAULT_MARKUP_PERCENTAGE`
- Types/interfaces: PascalCase with no prefix — `BookingDetails`, `SearchParams`, `SupplierAdapter` (no `I` or `T` prefix)
- Zod schemas: camelCase with `Schema` suffix — `bookingDetailsSchema`, `searchParamsSchema`

### Structure Patterns

**Project Organization:**
- Feature-based grouping — components, services, and types grouped by domain feature: `src/features/search/`, `src/features/booking/`, `src/features/wallet/`, not by type (`src/components/buttons/`).
- Shared UI components (shadcn/ui wrappers, generic layout primitives) in `src/components/ui/`.
- Domain contracts (Zod schemas + TypeScript types) co-located in `src/features/<feature>/contracts/` per feature.

**Test Location:**
- Co-located tests — `booking-service.ts` and `booking-service.test.ts` in the same directory. No separate `__tests__` folder hierarchy.

**Service Layer Organization:**
- One service file per domain — `booking-service.ts`, `wallet-service.ts`, `search-service.ts`. Contains business logic functions. Prefer plain exported functions over classes unless complexity demands it.
- Supplier adapters — one file per supplier: `expedia-adapter.ts`, `tbo-adapter.ts`. All implement the shared `SupplierAdapter` interface defined in `src/features/suppliers/contracts/`.

### Layer Boundary Rules

**Strict layer boundaries to prevent architectural drift:**

1. **Server Actions** may only call **service functions**. Server Actions never call adapters, repositories, or Prisma directly.
2. **Service functions** may call **adapters** (for supplier APIs) and **repositories/Prisma** (for database access). Services contain business logic.
3. **Adapters** handle external API communication only. Adapters never call services or access the database directly.
4. **No layer skipping** — a Server Action must not call an adapter directly, and a component must not call a service or Prisma directly.

```
Client Component → Server Action → Service → Adapter (external APIs)
                                           → Prisma (database)
```

### Format Patterns

**API Response Format:**
Server Actions return typed results directly (TypeScript enforces the contract). For Route Handlers (webhooks, external callbacks), standard HTTP status codes with the shared error shape:

```typescript
// Error shape (consistent across all operations):
{ code: "WALLET_INSUFFICIENT", message: "Insufficient wallet balance", details?: { required: 450, available: 200 } }
```

**Date/Time Format:**
- All dates stored in the database as UTC timestamps.
- All dates transmitted in JSON as ISO 8601 strings — `"2026-04-01T14:30:00Z"`.
- Display layer converts to agent's configured timezone.
- Cancellation deadlines: always stored and compared in UTC, safety buffer applied in UTC.

**Null Handling:**
- `null` for intentionally absent values, `undefined` for optional fields not provided.
- Database nullable fields map to `null` in TypeScript (Prisma default).
- Never use empty strings as a substitute for null.

### Communication Patterns

**SSE Event Naming:**
- Dot-notation, domain-scoped — `wallet.balance-updated`, `booking.auto-cancel-warning`, `hcn.status-changed`, `booking.status-changed`.
- Payload always includes `entityId` and `timestamp`.

**Audit Event Naming:**
- Past-tense dot-notation — `booking.confirmed`, `wallet.debited`, `voucher.generated`, `hcn.email-sent`, `agent.permission-changed`.
- Every audit event includes: `actorId`, `actorRole`, `action`, `entityType`, `entityId`, `timestamp`, `payload` (before/after state where applicable).

**Structured Logging:**
- JSON format: `{ level, message, timestamp, context: { requestId, agentId, action }, error? }`.
- Levels: `error` (requires attention), `warn` (unexpected but handled), `info` (business events), `debug` (development only, stripped in production).
- Every supplier API call logged at `info` level with request/response summary.

### Process Patterns

**Server Action Precondition Sequence:**
Every protected Server Action follows this exact sequence before executing business logic:

```typescript
// 1. Resolve session
const session = await getServerSession();
// 2. Authorize (role + tenant scope)
await authorize(session, "booking:create", { agentId: params.agentId });
// 3. Validate input
const validated = bookingInputSchema.parse(input);
// 4. Check idempotency (for financial/booking operations)
await checkIdempotency(idempotencyKey);
// 5. Execute business logic via service layer
const result = await bookingService.createBooking(validated, session);
```

Steps 1–2 are required for all protected actions. Step 3 is required for all actions with external input. Step 4 is required for financial and booking operations.

**State Change Observability Rule:**
Every state-changing financial or booking operation must produce audit trail entries and structured log entries. The requirement is consistency and completeness — every meaningful state change is recorded with full context. Some operations may legitimately emit multiple audit events (e.g., a booking confirmation that also triggers a wallet debit), and that is expected.

**Error Handling:**
- Server Actions: catch at the action boundary, return typed error or throw. Never let raw exceptions reach the client.
- Supplier adapters: catch all supplier-specific errors, translate to Apolles error codes, log the raw error at `error` level, return the normalized error.
- Client components: error boundaries per feature area (search, booking, wallet), not one global boundary. Each boundary renders a feature-appropriate fallback.

**Loading States:**
- Server Components: use Next.js `loading.tsx` files for route-level loading (Suspense boundaries).
- Client Components: local loading state via `useState` or React Hook Form's `isSubmitting`. No global loading state.
- Progressive search results: initial skeleton → first supplier results render → second supplier results append. Never block the full page waiting for all suppliers.

**Retry Patterns:**
- Supplier API calls: adapter handles retries internally (max 2 retries with exponential backoff for transient errors like 5xx or timeout). Business logic layer never retries — it receives a success or a normalized error.
- Financial operations: no automatic retry at the service level. Idempotency keys ensure safety if the agent manually retries or if the job service retries auto-cancellation.

### Testing Requirements

**Co-located Tests:**
- Required for all services, Server Actions, and supplier adapters. Every new module ships with its test file.

**Supplier Adapter Contract Tests:**
- Each adapter must have contract tests that validate the adapter's output conforms to the normalized `SupplierAdapter` interface shape. When a new adapter is added, it must pass the same contract test suite that existing adapters pass. This guarantees that any supplier can be swapped or added without breaking downstream business logic.

**Idempotency Test Matrix (Booking & Wallet Flows):**
- First call succeeds and returns expected result.
- Replay with same idempotency key returns the same result without side effects.
- Concurrent replay with same idempotency key is safe (no double-debit, no double-booking).
- These tests are mandatory for every financial and booking operation before it ships.

### Enforcement Guidelines

**All AI Agents MUST:**
1. Follow naming conventions exactly — any deviation creates inconsistency across the codebase.
2. Place new code in the correct feature directory — never create new top-level directories without architectural review.
3. Respect layer boundaries — Server Actions call services only, services call adapters/repositories only, no skipping.
4. Use the centralized auth service for every protected operation — never inline permission checks.
5. Follow the Server Action precondition sequence (auth → validate → idempotency → execute) for all protected actions.
6. Translate supplier errors through the adapter — never expose raw supplier errors to business logic or frontend.
7. Include audit trail entries and structured logs for every state-changing financial or booking operation.
8. Use Zod schemas for all external data validation (user input and supplier responses).
9. Write co-located tests for new business logic, including contract tests for adapters and idempotency tests for financial flows.
10. Define domain contracts (Zod schemas + TS types) in `src/features/<feature>/contracts/`.

**Anti-Patterns (Explicitly Forbidden):**
- Creating `utils/` or `helpers/` grab-bag files — place functions in the relevant feature or service module.
- Using `any` type — use `unknown` and narrow with Zod validation.
- Direct database queries outside the service layer — all DB access goes through service functions.
- Storing dates in local time — always UTC.
- Client-side authorization checks without server-side enforcement.
- `console.log` in production code — use the structured logger.
- Layer skipping — a Server Action calling an adapter directly, or a component calling Prisma directly.
- Inline permission checks — all authorization goes through the centralized auth service.

### Architecture Patterns Checklist

A lightweight `architecture-patterns-checklist.md` document will be maintained in the repository root as a living reference. It contains:
- Naming rules (database, API, code)
- Response/error format specifications
- Required preconditions for Server Actions
- Layer boundary rules
- Audit/logging requirements for state changes
- Anti-patterns list

Every PR can reference a specific checklist item to verify compliance. The checklist is updated when architectural patterns evolve.

## Project Structure & Boundaries

### Complete Project Directory Structure

```
apolles/
├── .env.local                          # Local dev environment (gitignored)
├── .env.example                        # Template for environment variables
├── .gitignore
├── .github/
│   └── workflows/
│       └── ci.yml                      # GitHub Actions: lint, type-check, test
├── architecture-patterns-checklist.md  # Living enforcement checklist
├── next.config.js
├── package.json
├── pnpm-lock.yaml
├── postcss.config.js
├── tailwind.config.ts
├── tsconfig.json
│
├── prisma/
│   ├── schema.prisma                   # Single schema, all models
│   ├── migrations/                     # Prisma Migrate auto-generated
│   └── seed.ts                         # Dev seed data
│
├── public/
│   └── assets/
│       ├── images/                     # Static images (logo placeholders, etc.)
│       └── fonts/                      # Custom fonts if needed
│
└── src/
    ├── app/                            # Next.js App Router
    │   ├── globals.css
    │   ├── layout.tsx                  # Root layout (auth provider, theme)
    │   ├── loading.tsx                 # Root loading state
    │   ├── error.tsx                   # Root error boundary
    │   ├── not-found.tsx
    │   │
    │   ├── (auth)/                     # Auth route group (no layout nesting)
    │   │   ├── login/
    │   │   │   └── page.tsx
    │   │   ├── register/
    │   │   │   └── page.tsx
    │   │   └── verify-email/
    │   │       └── page.tsx
    │   │
    │   ├── (dashboard)/                # Authenticated route group
    │   │   ├── layout.tsx              # Dashboard shell (sidebar, wallet widget, nav)
    │   │   ├── page.tsx                # Dashboard home / command center
    │   │   ├── loading.tsx
    │   │   │
    │   │   ├── search/
    │   │   │   ├── page.tsx            # Search form + results
    │   │   │   └── loading.tsx
    │   │   │
    │   │   ├── quotes/
    │   │   │   ├── page.tsx            # Quote list
    │   │   │   ├── [quoteId]/
    │   │   │   │   └── page.tsx        # Quote builder / detail
    │   │   │   └── loading.tsx
    │   │   │
    │   │   ├── bookings/
    │   │   │   ├── page.tsx            # Booking list + voucher queue
    │   │   │   ├── [bookingId]/
    │   │   │   │   └── page.tsx        # Booking detail + HCN status
    │   │   │   └── loading.tsx
    │   │   │
    │   │   ├── wallet/
    │   │   │   ├── page.tsx            # Wallet balance, transactions, top-up
    │   │   │   └── loading.tsx
    │   │   │
    │   │   ├── hcn/
    │   │   │   ├── page.tsx            # HCN dashboard
    │   │   │   └── loading.tsx
    │   │   │
    │   │   └── settings/
    │   │       ├── page.tsx            # Profile, branding, HCN email config
    │   │       └── loading.tsx
    │   │
    │   ├── (admin)/                    # Admin route group
    │   │   ├── layout.tsx              # Admin shell
    │   │   ├── page.tsx                # Admin dashboard overview
    │   │   ├── bookings/
    │   │   │   └── page.tsx            # Booking investigation
    │   │   ├── suppliers/
    │   │   │   └── page.tsx            # API health, circuit breaker status
    │   │   ├── mapping/
    │   │   │   └── page.tsx            # Hotel mapping management
    │   │   ├── agents/
    │   │   │   └── page.tsx            # Agent management, cross-tenant view
    │   │   └── loading.tsx
    │   │
    │   └── api/                        # Route Handlers (external-facing only)
    │       ├── webhooks/
    │       │   ├── stripe/
    │       │   │   └── route.ts        # Stripe payment webhook
    │       │   └── supplier/
    │       │       └── route.ts        # Supplier notification callback
    │       ├── sse/
    │       │   └── route.ts            # SSE endpoint (Edge Function)
    │       └── auth/
    │           └── [...nextauth]/
    │               └── route.ts        # NextAuth.js handler
    │
    ├── features/                       # Feature-based domain modules
    │   ├── auth/
    │   │   ├── contracts/
    │   │   │   └── auth-schemas.ts     # Zod schemas + TS types
    │   │   ├── auth-service.ts
    │   │   ├── auth-service.test.ts
    │   │   ├── authorize.ts            # Centralized RBAC authorization
    │   │   ├── authorize.test.ts
    │   │   └── actions/
    │   │       ├── login-action.ts
    │   │       └── register-action.ts
    │   │
    │   ├── search/
    │   │   ├── contracts/
    │   │   │   ├── search-schemas.ts
    │   │   │   └── search-result-types.ts
    │   │   ├── search-service.ts
    │   │   ├── search-service.test.ts
    │   │   ├── actions/
    │   │   │   └── search-action.ts
    │   │   └── components/
    │   │       ├── search-form.tsx
    │   │       ├── search-results.tsx
    │   │       ├── hotel-card.tsx
    │   │       └── supplier-badge.tsx  # Shows "best price" without supplier name
    │   │
    │   ├── booking/
    │   │   ├── contracts/
    │   │   │   ├── booking-schemas.ts
    │   │   │   └── booking-status.ts   # Status enum + lifecycle types
    │   │   ├── booking-service.ts
    │   │   ├── booking-service.test.ts
    │   │   ├── actions/
    │   │   │   ├── create-booking-action.ts
    │   │   │   ├── cancel-booking-action.ts
    │   │   │   └── price-check-action.ts
    │   │   └── components/
    │   │       ├── booking-form.tsx
    │   │       ├── booking-card.tsx
    │   │       ├── booking-detail.tsx
    │   │       ├── auto-cancel-countdown.tsx   # Client component, SSE
    │   │       └── voucher-queue.tsx
    │   │
    │   ├── quotes/
    │   │   ├── contracts/
    │   │   │   └── quote-schemas.ts
    │   │   ├── quote-service.ts
    │   │   ├── quote-service.test.ts
    │   │   ├── actions/
    │   │   │   ├── create-quote-action.ts
    │   │   │   ├── update-quote-action.ts
    │   │   │   └── generate-pdf-action.ts
    │   │   ├── components/
    │   │   │   ├── quote-builder.tsx
    │   │   │   ├── quote-city-section.tsx
    │   │   │   └── quote-hotel-row.tsx
    │   │   └── templates/
    │   │       └── quote-pdf-template.tsx   # @react-pdf/renderer component
    │   │
    │   ├── wallet/
    │   │   ├── contracts/
    │   │   │   └── wallet-schemas.ts
    │   │   ├── wallet-service.ts
    │   │   ├── wallet-service.test.ts
    │   │   ├── actions/
    │   │   │   ├── debit-wallet-action.ts
    │   │   │   └── initiate-topup-action.ts
    │   │   └── components/
    │   │       ├── wallet-widget.tsx        # Client component, SSE balance
    │   │       ├── transaction-list.tsx
    │   │       └── topup-form.tsx
    │   │
    │   ├── hcn/
    │   │   ├── contracts/
    │   │   │   └── hcn-schemas.ts
    │   │   ├── hcn-service.ts
    │   │   ├── hcn-service.test.ts
    │   │   ├── actions/
    │   │   │   ├── send-verification-action.ts
    │   │   │   └── update-hcn-status-action.ts
    │   │   └── components/
    │   │       ├── hcn-dashboard.tsx
    │   │       ├── hcn-status-badge.tsx
    │   │       └── hcn-template-editor.tsx
    │   │
    │   ├── voucher/
    │   │   ├── contracts/
    │   │   │   └── voucher-schemas.ts
    │   │   ├── voucher-service.ts
    │   │   ├── voucher-service.test.ts
    │   │   ├── actions/
    │   │   │   ├── generate-voucher-action.ts
    │   │   │   └── batch-voucher-action.ts
    │   │   └── templates/
    │   │       └── voucher-pdf-template.tsx
    │   │
    │   ├── markup/
    │   │   ├── contracts/
    │   │   │   └── markup-schemas.ts
    │   │   ├── markup-service.ts           # Centralized markup calculation
    │   │   └── markup-service.test.ts
    │   │
    │   ├── suppliers/
    │   │   ├── contracts/
    │   │   │   ├── supplier-adapter.ts     # Unified SupplierAdapter interface
    │   │   │   ├── supplier-schemas.ts     # Normalized response schemas
    │   │   │   └── supplier-errors.ts      # Apolles error code mappings
    │   │   ├── adapters/
    │   │   │   ├── expedia-adapter.ts
    │   │   │   ├── expedia-adapter.test.ts
    │   │   │   ├── tbo-adapter.ts
    │   │   │   ├── tbo-adapter.test.ts
    │   │   │   └── adapter-contract.test.ts  # Shared contract test suite
    │   │   ├── supplier-orchestrator.ts    # Parallel search, aggregation
    │   │   ├── supplier-orchestrator.test.ts
    │   │   ├── circuit-breaker.ts
    │   │   └── circuit-breaker.test.ts
    │   │
    │   ├── mapping/
    │   │   ├── contracts/
    │   │   │   └── mapping-schemas.ts
    │   │   ├── mapping-service.ts          # Vervotech integration + dedup
    │   │   ├── mapping-service.test.ts
    │   │   └── actions/
    │   │       └── manual-mapping-action.ts  # Admin manual override
    │   │
    │   ├── admin/
    │   │   ├── contracts/
    │   │   │   └── admin-schemas.ts
    │   │   ├── admin-service.ts
    │   │   └── components/
    │   │       ├── supplier-health-dashboard.tsx
    │   │       ├── mapping-management.tsx
    │   │       └── booking-investigation.tsx
    │   │
    │   └── profile/
    │       ├── contracts/
    │       │   └── profile-schemas.ts
    │       ├── profile-service.ts
    │       ├── actions/
    │       │   └── update-profile-action.ts
    │       └── components/
    │           ├── profile-form.tsx
    │           └── logo-upload.tsx
    │
    ├── components/                     # Shared UI components
    │   └── ui/                         # shadcn/ui + custom primitives
    │       ├── button.tsx
    │       ├── input.tsx
    │       ├── dialog.tsx
    │       ├── data-table.tsx
    │       ├── toast.tsx
    │       └── ...                     # Other shadcn/ui components
    │
    ├── lib/                            # Shared infrastructure
    │   ├── db.ts                       # Prisma client singleton
    │   ├── redis.ts                    # Redis client (Upstash)
    │   ├── auth-options.ts             # NextAuth configuration
    │   ├── logger.ts                   # Structured JSON logger
    │   ├── audit.ts                    # Audit trail insert helper
    │   ├── idempotency.ts              # Idempotency key check/store
    │   ├── encryption.ts               # AES-256 encrypt/decrypt for credentials
    │   ├── errors.ts                   # Typed error codes + error factory
    │   └── email.ts                    # Email sending service (HCN, notifications)
    │
    ├── jobs/                           # Scheduled job definitions
    │   ├── auto-cancel-job.ts          # Inngest/Trigger.dev: auto-cancellation
    │   ├── auto-cancel-job.test.ts
    │   ├── mapping-sync-job.ts         # Vercel Cron: Vervotech daily sync
    │   └── mapping-sync-job.test.ts
    │
    ├── middleware.ts                   # Next.js middleware (auth redirect, tenant)
    │
    └── env.ts                          # @t3-oss/env-nextjs type-safe env config
```

### Architectural Boundaries

**API Boundaries:**
- **External-facing Route Handlers:** Only `/api/webhooks/*` (Stripe, supplier callbacks), `/api/sse/*` (Edge Function for real-time), and `/api/auth/*` (NextAuth). Everything else is Server Actions.
- **Supplier boundary:** All external supplier communication passes through `src/features/suppliers/adapters/`. No other module makes direct HTTP calls to supplier APIs.
- **Payment boundary:** All payment interaction goes through Stripe hosted redirect. No card data enters the application.

**Layer Boundaries (enforced):**

```
┌─────────────────────────────────────────┐
│  App Router Pages (Server Components)    │
│  + Client Components (UI interaction)    │
├──────────────┬──────────────────────────┤
│  Server Actions  (src/features/*/actions)│
├──────────────┼──────────────────────────┤
│  Services        (src/features/*-service)│
├──────────┬───┴────┬─────────────────────┤
│ Adapters │ Prisma │ Redis  │ Jobs       │
│ (suppliers)│(db.ts)│(redis.ts)│(jobs/) │
├──────────┴────────┴────────┴────────────┤
│  External: Expedia │ TBO │ Vervotech    │
│  External: Stripe  │ Email Provider     │
│  Infra: PostgreSQL │ Upstash Redis      │
└─────────────────────────────────────────┘
```

**Data Boundaries:**
- All database access through Prisma client (`src/lib/db.ts`), called only from service layer functions.
- All cache access through Redis client (`src/lib/redis.ts`), called from services and the SSE handler.
- Tenant scoping enforced at the service layer — every query includes the agent/agency scope resolved from session.

### Requirements to Structure Mapping

**FR Domain → Feature Module:**

| FR Domain | Feature Module | Key Files |
|-----------|---------------|-----------|
| Hotel Search & Discovery (FR1-FR10) | `features/search/`, `features/suppliers/`, `features/mapping/` | search-service, supplier-orchestrator, mapping-service |
| Quote & Itinerary (FR11-FR16) | `features/quotes/` | quote-service, quote-pdf-template |
| Booking Flow (FR17-FR26) | `features/booking/` | booking-service, create-booking-action, price-check-action |
| Booking Management (FR27-FR37) | `features/booking/`, `features/voucher/`, `jobs/` | voucher-service, auto-cancel-job, batch-voucher-action |
| HCN Verification (FR38-FR44) | `features/hcn/` | hcn-service, send-verification-action |
| Wallet & Finance (FR45-FR54) | `features/wallet/`, `features/markup/` | wallet-service, markup-service |
| User Management (FR55-FR64) | `features/auth/`, `features/profile/` | auth-service, authorize, profile-service |
| Platform Admin (FR65-FR72) | `features/admin/`, `features/mapping/` | admin-service, supplier-health-dashboard |

**Cross-Cutting Concerns → Shared Location:**

| Concern | Location |
|---------|----------|
| RBAC Authorization | `features/auth/authorize.ts` |
| Markup Calculation | `features/markup/markup-service.ts` |
| Audit Trail | `lib/audit.ts` |
| Idempotency | `lib/idempotency.ts` |
| Structured Logging | `lib/logger.ts` |
| Error Codes | `lib/errors.ts` |
| Supplier Abstraction | `features/suppliers/contracts/supplier-adapter.ts` |
| Encryption | `lib/encryption.ts` |

### Integration Points

**Internal Communication:**
- Pages → Server Actions (type-safe function calls)
- Server Actions → Services (direct function calls)
- Services → Prisma / Redis / Adapters (direct calls within layer boundary)
- Jobs → Services (Inngest/Trigger.dev handler calls service functions)
- SSE handler → Redis pub/sub (subscribes to channels, streams to clients)

**External Integrations:**

| External Service | Integration Point | Protocol |
|-----------------|-------------------|----------|
| Expedia Rapid API v3 | `features/suppliers/adapters/expedia-adapter.ts` | HTTPS + SHA-512 signature auth |
| TBO Holidays API v1.4 | `features/suppliers/adapters/tbo-adapter.ts` | HTTPS + Basic Auth |
| Vervotech Hotel Mapping | `features/mapping/mapping-service.ts` | HTTPS REST API |
| Stripe (payments) | `/api/webhooks/stripe/route.ts` + hosted redirect | HTTPS + webhook signatures |
| Email provider (HCN) | `lib/email.ts` | SMTP/API |
| Inngest/Trigger.dev | `jobs/*.ts` | Serverless function triggers |

**Data Flow (Search → Quote → Book):**

```
Agent searches → Server Action → search-service
  → supplier-orchestrator (parallel calls)
    → expedia-adapter.search() + tbo-adapter.search()
  → mapping-service.deduplicate()
  → markup-service.applyMarkup()
  → return normalized, deduplicated, priced results

Agent adds to quote → Server Action → quote-service
  → persist quote state in DB

Agent books from quote → Server Action → booking-service
  → price-check via adapter
  → wallet-service.debit() (with idempotency + row lock)
  → adapter.book()
  → audit.log() + hcn-service.sendVerification()
  → publish booking.confirmed to Redis → SSE pushes to client
```

## Architecture Validation Results

### Coherence Validation

**Decision Compatibility:**
All technology choices are compatible and form a cohesive stack:
- Next.js App Router + TypeScript + Tailwind + Prisma + NextAuth + PostgreSQL — standard T3 stack, well-tested together
- Redis (Upstash) integrates cleanly with Vercel serverless + SSE via pub/sub
- Zod works natively with Prisma, React Hook Form, and Server Actions
- `@react-pdf/renderer` runs in Node.js serverless (Vercel compatible)
- Inngest/Trigger.dev deploy alongside Vercel with no infrastructure conflict
- Sentry + Vercel Analytics are complementary (error tracking vs. performance)
- No contradictory decisions found.

**Pattern Consistency:**
- Naming conventions internally consistent (camelCase in code/JSON, PascalCase for types/models, kebab-case for files, SCREAMING_SNAKE for constants/enums)
- Layer boundary rules align with the project structure (actions/ → services → adapters/Prisma)
- Server Action precondition sequence aligns with auth (NextAuth DB sessions) + validation (Zod) + idempotency decisions
- Error handling pattern (typed codes, adapter translation) aligns with the structured error shape defined in API patterns
- No inconsistencies found.

**Structure Alignment:**
- Feature-based directory structure matches the layer boundary rules
- `contracts/` directories align with the Zod validation strategy
- Co-located tests align with the testing requirements
- `lib/` infrastructure files align with cross-cutting concern decisions (audit, idempotency, logger, encryption)
- `jobs/` directory aligns with the Inngest/Trigger.dev + Vercel Cron decisions
- No structural misalignment found.

### Requirements Coverage Validation

**Functional Requirements Coverage (73 FRs):**

| FR Domain | Coverage | Notes |
|-----------|----------|-------|
| Hotel Search (FR1-FR10) | Covered | Supplier adapters, orchestrator, mapping service, progressive loading via SSE, wallet indicators, role-based supplier visibility |
| Quote & Itinerary (FR11-FR16) | Covered | Quote feature module, `@react-pdf/renderer`, role-based PDF visibility rules |
| Booking Flow (FR17-FR26) | Covered | Booking service, price-check action, wallet-gated logic, idempotency, Expedia compliance display, multi-room support |
| Booking Management (FR27-FR37) | Covered | Voucher service, auto-cancel job (Inngest/Trigger.dev), batch voucher, audit trail, modification routing |
| HCN Verification (FR38-FR44) | Covered | HCN feature module, email service, template editor, status state machine, dashboard |
| Wallet & Finance (FR45-FR54) | Covered | Wallet service with row-level locking, markup service (centralized), invoice PDF, 7-year audit retention |
| User Management (FR55-FR64) | Covered | Auth feature, profile feature, RBAC authorization (fast-follow features architecturally supported by tenant scoping + role system) |
| Platform Admin (FR65-FR72) | Covered | Admin feature module, supplier health dashboard, mapping management, booking investigation, escalation tracking |

**0 uncovered FRs.**

**Non-Functional Requirements Coverage (36 NFRs):**

| NFR Area | Coverage | Architectural Support |
|----------|----------|----------------------|
| Performance (NFR1-9) | Covered | Parallel supplier calls, progressive SSE loading, Redis caching (mapping sub-500ms), Vercel Edge, PDF generation in serverless |
| Security (NFR10-18) | Covered | SAQ-A (PCI), AES-256 encryption, NextAuth DB sessions (HttpOnly/Secure/SameSite), API-level RBAC, immutable audit table, HTTPS enforcement, Zod input validation (OWASP), PSD2/SCA via Stripe |
| Reliability (NFR19-24) | Covered | Vercel uptime, PostgreSQL managed service (RPO/RTO), Inngest/Trigger.dev for 99.9% auto-cancel, circuit breaker for supplier isolation, tiered alerting, atomic wallet transactions |
| Scalability (NFR25-29) | Covered | Vercel auto-scaling, adapter pattern (new supplier ≤2 weeks), Redis hotel mapping cache (2M+ records), PostgreSQL for 100K+ bookings, email service for 1000+/day |
| Integration (NFR30-36) | Covered | Unified adapter interface, 5s timeout + circuit breaker, supplier_api_logs table, health alerting thresholds, Vervotech 24h sync job, email delivery tracking, Stripe tokenization |

**0 uncovered NFRs.**

### Implementation Readiness Validation

**Decision Completeness:**
- All 5 decision categories documented with rationale
- Technology versions to be verified at implementation time (web search at project init)
- Deferred decisions explicitly listed with trigger conditions

**Structure Completeness:**
- 60+ files and directories explicitly defined
- Every FR domain mapped to specific feature module and files
- All cross-cutting concerns mapped to shared locations

**Pattern Completeness:**
- Naming conventions cover database, API, code, files, types, schemas, constants, enums
- Layer boundaries explicitly enforced with call-chain diagram
- Server Action precondition sequence with code example
- Error handling at every layer (action, service, adapter, client)
- Testing requirements include co-located, contract, and idempotency tests

### Gap Analysis Results

**Critical Gaps: 0**

**Important Gaps (non-blocking, resolve during implementation stories):**

1. **Testing framework not specified** — Architecture defines co-located `.test.ts` files but does not name the test runner. Vitest is the natural choice (fast, TypeScript-native, compatible with the stack). Decision deferred to project initialization story.
2. **Email provider not specified** — `lib/email.ts` is defined but the specific provider (SendGrid, AWS SES, Resend) is left open. All are architecturally compatible. Decision deferred to HCN implementation story.
3. **Inngest vs Trigger.dev not selected** — Architecture says "Inngest or Trigger.dev." Both are architecturally equivalent. Final selection deferred to auto-cancellation implementation story.

**Nice-to-Have Gaps (address post-MVP):**
- No API versioning strategy (not needed — no public API at MVP)
- No database backup/restore procedure documented (handled by managed PostgreSQL provider)
- No load testing strategy (define when approaching 500-agent scale target)

### Minimum Test Gates (Merge Requirements)

The following test categories are required to pass before any PR can be merged. These echo the testing requirements from Implementation Patterns and serve as enforceable merge gates:

1. **Supplier adapter contract tests** — Every adapter must pass the shared `adapter-contract.test.ts` suite validating normalized output shape. New adapters cannot merge without passing the existing contract suite.
2. **Idempotency test matrix** — Every financial and booking operation (wallet debit, booking confirmation, auto-cancellation) must include tests for: first-call success, replay with same key returns same result, concurrent replay is safe. Cannot merge without all three passing.
3. **Co-located unit tests** — Every new service, Server Action, and adapter must ship with its `.test.ts` file. PRs adding business logic without corresponding tests are blocked.

### PR Template Enforcement

All PRs that include protected Server Actions must include a checklist confirming:

- [ ] Auth check (session resolved + `authorize()` called)
- [ ] Input validation (Zod schema `.parse()` on all external input)
- [ ] Idempotency check (for financial/booking operations)
- [ ] Audit trail entry (for state-changing financial/booking operations)
- [ ] Structured log entry (for state-changing operations)
- [ ] Co-located test file included
- [ ] Layer boundaries respected (action → service → adapter/Prisma only)

This checklist is included in the GitHub PR template (`.github/pull_request_template.md`) and enforced by code review.

### Architecture Completeness Checklist

**Requirements Analysis**
- [x] Project context thoroughly analyzed (73 FRs, 36 NFRs, 10 constraints)
- [x] Scale and complexity assessed (High, 12-15 subsystems)
- [x] Technical constraints identified (10 constraints with sources)
- [x] Cross-cutting concerns mapped (8 concerns with implications)

**Architectural Decisions**
- [x] Critical decisions documented with rationale
- [x] Technology stack fully specified
- [x] Integration patterns defined (adapter, circuit breaker, SSE)
- [x] Performance considerations addressed (caching, progressive loading, timeouts)
- [x] Security fully covered (SAQ-A, RBAC, encryption, idempotency, audit)

**Implementation Patterns**
- [x] Naming conventions established (database, API, code)
- [x] Structure patterns defined (feature-based, co-located tests, contracts)
- [x] Communication patterns specified (SSE events, audit events, logging)
- [x] Process patterns documented (preconditions, error handling, retries, loading)
- [x] Layer boundaries enforced
- [x] Testing requirements defined (co-located, contract, idempotency)

**Project Structure**
- [x] Complete directory structure defined (60+ files)
- [x] Component boundaries established (layer diagram)
- [x] Integration points mapped (6 external services)
- [x] Requirements to structure mapping complete (8 FR domains → feature modules)
- [x] Data flow documented (search → quote → book)

### Architecture Readiness Assessment

**Overall Status:** READY FOR IMPLEMENTATION

**Confidence Level:** High

**Key Strengths:**
- Simple, direct architecture aligned with launch scale — no over-engineering
- Every decision has clear rationale tied to specific requirements
- Layer boundaries and patterns prevent AI agent implementation drift
- Cross-cutting concerns (RBAC, markup, audit, tenant scoping) centralized from the start
- Compliance requirements (PCI, Expedia, GDPR) architecturally addressed
- PR template and minimum test gates provide practical enforcement

**Areas for Future Enhancement:**
- SAQ A-EP upgrade if payment redirect UX proves insufficient
- External secrets manager if moving to multi-cloud
- Schema-per-tenant if tenant count exceeds thousands
- API versioning when/if a public API is needed
- Load testing strategy approaching 500-agent scale

**First Implementation Priority:**
```bash
pnpm dlx create-t3-app@latest apolles --CI --appRouter --tailwind --prisma --nextAuth --dbProvider postgres --trpc false --drizzle false
```

**AI Agent Guidelines:**
- Follow all architectural decisions exactly as documented
- Use implementation patterns consistently across all components
- Respect project structure and boundaries
- Refer to this document for all architectural questions
- Pass all minimum test gates before submitting PRs
- Complete the PR template checklist for every protected Server Action
