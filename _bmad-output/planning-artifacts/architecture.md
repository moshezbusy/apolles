---
project_name: Apolles
user_name: Moshe
date: '2026-03-11'
workflowType: 'architecture'
lastStep: 8
status: 'complete'
completedAt: '2026-03-11'
stepsCompleted: [1, 2, 3, 4, 5, 6, 7, 8]
revisionNote: 'Lean MVP alignment revision — aligned to approved lean product brief, lean PRD, and updated UX design spec (all 2026-03-11)'
inputDocuments:
  - product-brief-Apolles-2026-03-11.md
  - prd.md
  - ux-design-specification.md
---

# Apolles — Lean MVP Architecture

## Architecture Alignment Summary

This document is a **lean alignment revision** of the original Apolles architecture. It preserves the useful structural decisions from the original while removing, simplifying, or deferring everything that conflicts with the approved lean MVP direction.

### What Was Preserved
- **Next.js App Router + TypeScript + Tailwind + Prisma + NextAuth + PostgreSQL** — the core T3-adjacent stack
- **Feature-based directory structure** with co-located files
- **Server Actions as the primary API layer** — no REST API routes except webhooks/auth
- **Supplier adapter pattern** — one interface, separate TBO and Expedia adapters
- **Zod validation** at action boundaries
- **Prisma as the sole ORM** with PostgreSQL
- **NextAuth with DB sessions** (HttpOnly, Secure, SameSite cookies)
- **Vercel deployment** with managed PostgreSQL (Neon/Supabase)
- **Naming conventions** (camelCase code, snake_case DB, kebab-case files, PascalCase types)
- **Layer boundaries** (Pages → Server Actions → Services → Adapters/Prisma)
- **Co-located test files** (`.test.ts` alongside source)
- **Structured error handling** with typed error codes
- **Markup as a service-layer concern** applied before display

### What Was Simplified
- **Supplier orchestration** → removed `supplier-orchestrator.ts`; search service calls both adapters in parallel directly, no dedup, no merge
- **Booking status model** → aligned to PRD states: `pending`, `price_changed`, `confirmed`, `failed`, `cancelled`
- **Price chain** → simplified to: supplier base → markup applied → displayed amount → rechecked amount → confirmed amount → voucher amount
- **Role system** → two roles only: `agent` and `admin` (no agency hierarchy, no multi-tenant scoping beyond agent ownership)
- **Payment architecture** → Expedia path uses Stripe Elements hosted fields (SAQ A-EP) for tokenized card capture; TBO path has no payment step
- **Error handling** → simple try/catch with typed error codes, no circuit breaker pattern
- **Supplier timeout** → 5-second timeout per supplier call (per PRD), no retry, no Redis-backed circuit breaker
- **Audit** → supplier API logs table + booking state history, no immutable 7-year audit system
- **Idempotency** → booking confirmation only (idempotency key on confirm action), not on every financial operation

### What Was Removed (Not in MVP)
- **Redis** — no caching layer, no pub/sub, no SSE
- **SSE / real-time push** — search uses standard request/response with loading states
- **Inngest / Trigger.dev / job system** — no background jobs
- **Vervotech hotel mapping** — no mapping, no dedup, no unified hotel entity
- **Supplier orchestrator + dedup pipeline** — results stay supplier-specific
- **Wallet & Finance module** — no wallet, no prepaid balance, no top-up
- **HCN Verification module** — no hotel confirmation number automation
- **Quote Builder module** — no quote composition, no quote PDF
- **Email service** — no transactional emails in MVP
- **Auto-cancellation system** — no deadline-triggered automation
- **Circuit breaker** (Redis-backed) — replaced by simple 5s timeout, no retry
- **`@react-pdf/renderer`** — voucher is a simple HTML-to-PDF generation
- **Stripe payment redirect flow** — replaced by Stripe Elements hosted fields
- **Agency hierarchy / multi-tenant scoping** — two roles, flat structure
- **Agent self-registration** — admin creates agents manually
- **API versioning strategy** — no public API
- **Batch voucher generation** — one voucher at a time
- **Booking modification routing** — no modification in MVP
- **Escalation tracking** — no escalation system

### What Was Moved to Later Phases

**Late MVP / Phase 1.5:**
- Cancellation flow with supplier cancellation API calls
- Password reset flow
- Agent settings (nationality/residency defaults)
- Destination autocomplete on search
- Multi-room search support

**Phase 2:**
- Quote Builder (composition, PDF, send)
- Wallet & prepaid balance
- HCN Verification automation
- Hotel mapping (Vervotech or equivalent)
- Cross-supplier deduplication
- Unified hotel detail page
- Advanced admin analytics
- Agent self-registration
- Auto-cancellation with deadline jobs
- Email transactional system
- Redis caching layer (if performance requires)

### Supplier Scope: Source of Truth

The **lean PRD (2026-03-11)** and **updated UX design specification (2026-03-11)** are the authoritative documents for supplier scope in this architecture. Both suppliers — TBO Holidays and Expedia Rapid API — are active in the MVP from day one. The earlier product brief contained language about phased supplier rollout (TBO first, Expedia later). That phasing is superseded. This architecture reflects the approved dual-supplier MVP direction. Any conflict between the old product brief and the lean PRD/UX on supplier scope should be resolved in favor of the lean PRD and UX.

---

## Project Context Analysis

### Requirements Overview

**Functional Requirements (from Lean PRD):**

The lean PRD defines approximately 52 functional requirements across these domains:

| FR Domain | FR Count | Architectural Weight |
|-----------|----------|---------------------|
| Authentication & Session (FR1-FR4) | 4 | Low — NextAuth handles most |
| Hotel Search (FR5-FR15) | 11 | High — dual-supplier, parallel fetch, progressive display |
| Room & Rate Details (FR16-FR22) | 7 | Medium — supplier-specific rate display |
| Booking Flow (FR23-FR34) | 12 | High — price recheck, Expedia payment, confirmation |
| Voucher (FR35-FR38) | 4 | Low — PDF generation from booking data |
| Reservations Management (FR39-FR44) | 6 | Medium — list, filter, detail, status |
| Admin & Back-Office (FR45-FR52) | 8 | Medium — bookings view, supplier logs, agent management, markup |

**Non-Functional Requirements:**
- Performance: search results in <3s, booking confirmation <5s
- Security: no raw card storage, Stripe Elements for Expedia, HTTPS everywhere
- Reliability: graceful supplier failure handling (one source fails → show the other)
- Accessibility: WCAG 2.1 AA
- Deployment: Vercel serverless, managed PostgreSQL

**Scale & Complexity:**
- Complexity level: Medium (reduced from High — fewer subsystems, no background jobs, no real-time)
- Primary domain: Full-stack web application
- Estimated architectural components: 6-8 feature modules (reduced from 12-15)
- Users at launch: 1 admin + 5-10 agents
- No high-concurrency requirements at MVP

### Technical Constraints

| Constraint | Source | Implication |
|-----------|--------|-------------|
| Expedia Rapid API v3 requires SHA-512 signature auth | Expedia contract | Custom auth header generation in adapter |
| Expedia requires tokenized card for booking | Expedia API | Stripe Elements integration for Expedia path only |
| TBO API v1.4 uses Basic Auth | TBO contract | Simple auth header in adapter |
| No raw card data in application | PCI compliance | Stripe Elements hosted fields — card data never touches our server |
| Supplier results cannot be merged (no mapping) | Lean MVP scope | Results displayed per-supplier with neutral source indicators |
| Single markup percentage (platform-wide) | Lean MVP scope | One markup config value, applied in service layer |
| Admin-only supplier identity visibility | PRD requirement | Role-based display logic in UI |

### Cross-Cutting Concerns

| Concern | Approach |
|---------|----------|
| Authentication | NextAuth with DB sessions, two roles (agent/admin) |
| Authorization | Simple role check middleware — `requireRole('admin')` |
| Markup | Service-layer function: `applyMarkup(supplierAmount, markupPercentage)` |
| Supplier Logging | All supplier API calls logged to `supplier_api_logs` table |
| Error Handling | Typed error codes, try/catch at action boundary, user-friendly messages |
| Input Validation | Zod schemas at Server Action entry points |
| Booking State | Explicit state machine: pending → confirmed/failed, confirmed → cancelled |
| Price Integrity | Chain: supplier base → markup → display → recheck → confirmed → voucher |

---

## Starter Template Evaluation

### Primary Technology Domain

Full-stack web application (Next.js App Router) based on project requirements.

### Selected Starter: create-t3-app (adapted)

**Rationale:** T3 stack provides the exact foundation needed — Next.js App Router, TypeScript, Tailwind, Prisma, NextAuth — in a single well-maintained scaffold. We skip tRPC (using Server Actions instead) and Drizzle (using Prisma).

**Initialization Command:**

```bash
pnpm dlx create-t3-app@latest apolles --CI --appRouter --tailwind --prisma --nextAuth --dbProvider postgres --trpc false --drizzle false
```

**Architectural Decisions Provided by Starter:**

- **Language & Runtime:** TypeScript strict mode, Node.js runtime on Vercel
- **Styling:** Tailwind CSS with PostCSS
- **ORM:** Prisma with PostgreSQL
- **Auth:** NextAuth.js with database sessions
- **Build:** Next.js bundler (Turbopack in dev)
- **Code Organization:** App Router file-based routing, `src/` directory

**Note:** Project initialization using this command should be the first implementation story.

---

## Core Architectural Decisions

### Decision Priority Analysis

**Critical Decisions (Block Implementation):**
1. Modular monolith — single Next.js application, no microservices
2. Server Actions as the API layer — no REST routes except auth/webhooks
3. PostgreSQL as the single database — no Redis, no secondary stores
4. Supplier adapter pattern — one interface, two implementations
5. Stripe Elements for Expedia payment — hosted fields, tokenized card
6. Two roles only — agent and admin, simple role check

**Important Decisions (Shape Architecture):**
1. Feature-based directory structure with co-located files
2. Zod validation at action boundaries
3. Prisma as sole data access layer
4. Vercel deployment with managed PostgreSQL
5. NextAuth DB sessions (not JWT)

**Deferred Decisions (Post-MVP):**
1. Redis caching — add only if performance monitoring shows need
2. Background job system — add only when auto-cancellation is built
3. Email provider — add when HCN or transactional emails are needed
4. Hotel mapping provider — add when dedup/merge is built
5. Testing framework — Vitest recommended, finalize at project init
6. PDF library for voucher — evaluate `@react-pdf/renderer` vs simple HTML-to-PDF at implementation

### Data Architecture

**Database: PostgreSQL (managed — Neon or Supabase)**

Single database, single schema. No multi-tenancy isolation beyond `agent_id` foreign keys on bookings.

**Core Data Model:**

```
┌──────────────┐     ┌──────────────────┐     ┌──────────────────┐
│   users       │     │   bookings        │     │  booking_guests   │
│──────────────│     │──────────────────│     │──────────────────│
│ id (uuid)    │────<│ agent_id (fk)     │     │ booking_id (fk)  │
│ email        │     │ status (enum)     │────<│ full_name        │
│ name         │     │ supplier (enum)   │     │ email            │
│ role (enum)  │     │ supplier_hotel_id │     │ phone            │
│ is_active    │     │ supplier_ref      │     │ special_requests │
│ created_at   │     │ hotel_name        │     └──────────────────┘
│ updated_at   │     │ room_name         │
└──────────────┘     │ check_in          │     ┌──────────────────┐
                     │ check_out         │     │ supplier_api_logs │
                     │ adults            │     │──────────────────│
                     │ children          │     │ id               │
                     │ supplier_amount   │     │ supplier (enum)  │
                     │ markup_percentage │     │ method           │
                     │ markup_amount     │     │ endpoint         │
                     │ display_amount    │     │ request_body     │
                     │ recheck_amount    │     │ response_body    │
                     │ confirmed_amount  │     │ response_status  │
                     │ currency          │     │ duration_ms      │
                     │ cancellation_policy│    │ error_message    │
                     │ supplier_raw_response│  │ created_at       │
                     │ idempotency_key   │     └──────────────────┘
                     │ created_at        │
                     │ updated_at        │     ┌──────────────────┐
                     └──────────────────┘     │ platform_settings │
                                              │──────────────────│
                                              │ key (unique)     │
                                              │ value            │
                                              │ updated_at       │
                                              │ updated_by (fk)  │
                                              └──────────────────┘
```

**Booking Status Enum (aligned with PRD):**

```typescript
enum BookingStatus {
  PENDING = 'pending',           // Booking initiated, awaiting supplier confirmation
  PRICE_CHANGED = 'price_changed', // Price recheck returned different amount
  CONFIRMED = 'confirmed',       // Supplier confirmed the booking
  FAILED = 'failed',             // Supplier rejected or error occurred
  CANCELLED = 'cancelled',       // Booking cancelled (Late MVP)
}
```

**Supplier Enum:**

```typescript
enum Supplier {
  TBO = 'tbo',
  EXPEDIA = 'expedia',
}
```

**Price Chain Fields on Booking Record:**

| Field | Purpose |
|-------|---------|
| `supplier_amount` | Raw price from supplier API |
| `markup_percentage` | Platform markup % at time of booking |
| `markup_amount` | Calculated markup in currency |
| `display_amount` | Price shown to agent (supplier + markup) |
| `recheck_amount` | Price from recheck call (may differ) |
| `confirmed_amount` | Final price confirmed by supplier at booking |

**Data Validation Strategy:** Zod schemas defined per feature, validated at Server Action entry point. Prisma handles DB-level constraints.

**Migration Approach:** Prisma Migrate for schema changes. Sequential migrations in version control.

### Authentication & Security

**Authentication: NextAuth.js with Database Sessions**

- Session stored in PostgreSQL (via Prisma adapter)
- HttpOnly, Secure, SameSite=Lax cookies
- No JWT — session lookup on every request
- Session includes: `userId`, `role`, `name`, `email`

**Authorization: Simple Role Check**

```typescript
// src/lib/authorize.ts
export function requireRole(session: Session, role: 'agent' | 'admin') {
  if (!session?.user) throw new AuthError('NOT_AUTHENTICATED');
  if (session.user.role !== role && session.user.role !== 'admin') {
    throw new AuthError('NOT_AUTHORIZED');
  }
}

export function requireAuth(session: Session) {
  if (!session?.user) throw new AuthError('NOT_AUTHENTICATED');
}
```

Admin can access everything. Agent can only access their own bookings and search.

**Payment Security (Expedia Path):**
- Stripe Elements hosted payment fields — card data goes directly to Stripe, never touches our server
- PCI compliance level: SAQ A-EP (hosted fields within our page)
- Stripe returns a payment method token → passed to Expedia adapter for booking
- TBO bookings have no payment step — billed to agency account

**Data Security:**
- HTTPS everywhere (Vercel enforced)
- No sensitive data in client-side state beyond session
- Supplier API credentials in environment variables only
- Supplier raw responses stored in DB for admin debugging (not exposed to agents)
- No encryption layer needed at MVP — no card data, no PII beyond guest names

### API & Communication Patterns

**Primary API Pattern: Next.js Server Actions**

All client→server communication uses Server Actions. No REST API routes except:
- `/api/auth/*` — NextAuth endpoints
- `/api/webhooks/stripe` — (conditional) Only required if the Expedia payment integration uses asynchronous Stripe payment confirmation. If the Stripe Elements flow completes synchronously (tokenize → pass to Expedia in a single request), this webhook route is not needed at MVP. Determine during Expedia adapter implementation.

**Server Action Pattern:**

```typescript
'use server'

import { z } from 'zod';
import { getServerSession } from 'next-auth';
import { requireAuth } from '@/lib/authorize';

const SearchSchema = z.object({
  destination: z.string().min(1),
  checkIn: z.string().date(),
  checkOut: z.string().date(),
  adults: z.number().int().min(1).max(6),
  children: z.array(z.number().int().min(0).max(17)).max(4),
  nationality: z.string().length(2),
});

export async function searchHotels(input: z.infer<typeof SearchSchema>) {
  const session = await getServerSession();
  requireAuth(session);

  const validated = SearchSchema.parse(input);
  const results = await searchService.search(validated);
  return results;
}
```

**Error Handling Pattern:**

```typescript
// src/lib/errors.ts
export class AppError extends Error {
  constructor(
    public code: string,
    public message: string,
    public statusCode: number = 500,
    public isOperational: boolean = true,
  ) {
    super(message);
  }
}

// Error codes
export const ErrorCodes = {
  NOT_AUTHENTICATED: 'NOT_AUTHENTICATED',
  NOT_AUTHORIZED: 'NOT_AUTHORIZED',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  SUPPLIER_TIMEOUT: 'SUPPLIER_TIMEOUT',
  SUPPLIER_ERROR: 'SUPPLIER_ERROR',
  RATE_UNAVAILABLE: 'RATE_UNAVAILABLE',
  PRICE_CHANGED: 'PRICE_CHANGED',
  BOOKING_FAILED: 'BOOKING_FAILED',
  BOOKING_ALREADY_EXISTS: 'BOOKING_ALREADY_EXISTS',
} as const;
```

**Server Action Response Shape:**

```typescript
type ActionResult<T> =
  | { success: true; data: T }
  | { success: false; error: { code: string; message: string } };
```

**No REST API, no GraphQL, no tRPC.** Server Actions provide type-safe function calls with Zod validation.

### Supplier Adapter Architecture

**Adapter Interface:**

```typescript
// src/features/suppliers/contracts/supplier-adapter.ts
export interface SupplierAdapter {
  search(params: SearchParams): Promise<SupplierSearchResult[]>;
  getRoomDetails(params: RoomDetailParams): Promise<SupplierRoomDetail[]>;
  recheckPrice(params: PriceCheckParams): Promise<PriceCheckResult>;
  book(params: BookingParams): Promise<BookingResult>;
  // cancel(params: CancelParams): Promise<CancelResult>; // Late MVP
}

export interface SupplierSearchResult {
  supplier: 'tbo' | 'expedia';
  supplierHotelId: string;
  hotelName: string;
  starRating: number;
  address: string;
  images: string[];
  lowestRate: {
    supplierAmount: number;
    currency: string;
    roomName: string;
    mealPlan: string;
    cancellationPolicy: string;
    isCancellable: boolean;
  };
  supplierRateContext: unknown; // Opaque supplier data needed for drill-down
}

export interface PriceCheckResult {
  available: boolean;
  priceChanged: boolean;
  originalAmount: number;
  currentAmount: number;
  currency: string;
}

export interface BookingResult {
  success: boolean;
  supplierRef: string | null;
  confirmedAmount: number | null;
  currency: string;
  errorMessage: string | null;
}
```

**Key design rules:**
- Each adapter translates supplier-specific formats to the common interface
- `supplierRateContext` is an opaque blob — the adapter that produced it is the only one that reads it
- No UnifiedHotel entity — results are always tied to `supplier + supplierHotelId`
- Booking always goes to the adapter that produced the search result
- Adapters log all API calls to `supplier_api_logs` via a shared logging function
- **Supplier timeout: 5 seconds per call.** If a supplier does not respond within 5s, the call is treated as failed. No retry. The other supplier's results are shown. This is the single timeout rule for all supplier API calls (search, roomDetails, recheckPrice, book).

**Search Flow (no orchestrator):**

```typescript
// src/features/search/search-service.ts
export async function searchHotels(params: SearchParams) {
  const [tboResults, expediaResults] = await Promise.allSettled([
    tboAdapter.search(params),
    expediaAdapter.search(params),
  ]);

  const results: SupplierSearchResult[] = [];
  const supplierStatus = { tbo: 'success', expedia: 'success' };

  if (tboResults.status === 'fulfilled') {
    results.push(...tboResults.value);
  } else {
    supplierStatus.tbo = 'failed';
    // Log error, continue with other results
  }

  if (expediaResults.status === 'fulfilled') {
    results.push(...expediaResults.value);
  } else {
    supplierStatus.expedia = 'failed';
  }

  // Apply markup to all results
  const pricedResults = results.map(r => applyMarkup(r));

  return { results: pricedResults, supplierStatus };
}
```

**No dedup. No merge. No mapping. No orchestrator. Flat parallel fetch.**

### Expedia Payment Architecture

**One payment path only in MVP: Stripe Elements hosted payment fields.**

```
Agent selects Expedia room
  → Booking form (guest details)
  → Price recheck
  → Payment step (Stripe Elements iframe)
  → Agent enters card in Stripe-hosted fields
  → Stripe returns paymentMethodId token
  → Our server passes token to Expedia adapter
  → Expedia adapter includes payment token in booking request
  → Booking confirmation
```

**Stripe Integration Points:**
1. **Frontend:** Stripe Elements `<PaymentElement>` renders hosted card fields
2. **Server Action:** `confirmBookingWithPayment(bookingData, paymentMethodId)`
3. **Expedia Adapter:** Includes Stripe token in Expedia booking API call
4. **Webhook (conditional):** `/api/webhooks/stripe` — only if Stripe requires asynchronous payment confirmation for the chosen integration path. The default expectation is that Stripe Elements tokenization completes synchronously and the token is passed directly to Expedia. If async confirmation is needed, this webhook route is added. Not a hard MVP dependency until proven otherwise during implementation.

**PCI Scope:** SAQ A-EP — card fields are in Stripe's iframe, card data never enters our application. We only handle the resulting token.

**TBO Path:** No payment step. TBO bookings are billed to the agency's TBO account. The booking form skips the payment step entirely.

**Supplier-Specific Legal Text Rendering:**
Expedia requires specific legal/compliance text to be displayed during booking (e.g., important information, terms). This text is returned in the Expedia API response and must be rendered as-is on the booking form and review pages. Architecturally, this is handled in the Expedia adapter (which extracts and passes through the legal text fields) and in the booking form UI (which conditionally renders the legal text block for Expedia-sourced bookings only). No separate legal text service or CMS is needed — the supplier response is the source.

**SCA / 3DS Handling:**
If Stripe Elements triggers a 3D Secure (3DS) authentication challenge as part of SCA (Strong Customer Authentication) requirements, this is handled entirely within the Stripe Elements iframe — the agent completes the 3DS challenge in the hosted UI. Our application does not need to manage 3DS flows, redirects, or challenge status directly. Stripe handles it. The architecture does not expand PCI scope for SCA. If 3DS confirmation requires a webhook callback from Stripe, that is covered by the conditional webhook route (`/api/webhooks/stripe`).

### Frontend Architecture

**Framework:** Next.js App Router with Server Components (default) and Client Components (explicit `"use client"`)

**Server Components (default):**
- Page layouts, navigation, static content
- Data fetching for initial page load (reservations list, admin views)
- SEO metadata, page headers

**Client Components (explicit `"use client"`):**
- Interactive forms (search form, booking form)
- Components using `useState`, `useEffect`
- Components reading `localStorage` (sidebar collapse state)
- Stripe Elements payment container

**State Management:** No global state library. React state for forms. Server state via Server Actions with `revalidatePath()`.

**UI Component Library:** shadcn/ui + Tailwind CSS + Radix UI. This is the approved design system direction from the UX specification. shadcn/ui provides copy-paste-able, customizable components built on Radix UI primitives, styled with Tailwind. Components are owned in-repo (not a dependency) and can be modified freely to match the Apolles design tokens.

**Key Frontend Patterns:**
- Search results rendered as a flat list of `HotelResultCard` components with `SourceIndicatorBadge`
- Progressive loading: skeleton cards → first results appear → remaining results append
- Price display always shows the marked-up amount. Agent never sees supplier base price.
- Source indicators: "Source A" / "Source B" for agents. Real supplier name for admin.

### Infrastructure & Deployment

**Hosting: Vercel**
- Serverless functions for Server Actions and API routes
- Edge network for static assets
- Automatic HTTPS
- Preview deployments for PRs

**Database: Managed PostgreSQL (Neon or Supabase)**
- Connection pooling via provider's pooler
- Automatic backups by provider
- Single database, single schema

**Environment Configuration:**
- `.env.local` for local development
- Vercel environment variables for staging/production
- Type-safe env validation with `@t3-oss/env-nextjs`

**Monitoring:**
- Vercel Analytics for performance metrics
- Sentry for error tracking and alerting
- Supplier API logs in database for debugging

**No Docker. No Redis. No message queues. No worker processes. No cron jobs.**

---

## Implementation Patterns & Consistency Rules

### Naming Patterns

**Database Naming (Prisma schema → PostgreSQL):**
- Tables: `snake_case` plural (`users`, `bookings`, `supplier_api_logs`)
- Columns: `snake_case` (`supplier_amount`, `check_in`, `created_at`)
- Enums: `PascalCase` definition, `snake_case` values (`BookingStatus.CONFIRMED` → `'confirmed'`)
- Foreign keys: `referenced_table_singular_id` (`agent_id`, `booking_id`)
- Indexes: `idx_tablename_columnname` (`idx_bookings_agent_id`)

**API / Server Action Naming:**
- Server Action functions: `camelCase` verb-first (`searchHotels`, `createBooking`, `recheckPrice`)
- Action files: `kebab-case` (`search-hotels.ts`, `create-booking.ts`)
- Response shape: `{ success: true, data: T } | { success: false, error: { code, message } }`

**Code Naming:**
- Files: `kebab-case` (`search-service.ts`, `tbo-adapter.ts`, `hotel-result-card.tsx`)
- Components: `PascalCase` (`HotelResultCard`, `SearchForm`, `StatusBadge`)
- Functions/variables: `camelCase` (`getBookingById`, `supplierAmount`)
- Types/interfaces: `PascalCase` (`BookingStatus`, `SupplierSearchResult`)
- Constants/enums: `SCREAMING_SNAKE_CASE` for constant values, `PascalCase` for enum names
- Zod schemas: `PascalCase` + `Schema` suffix (`SearchSchema`, `BookingSchema`)

### Structure Patterns

**Feature-Based Organization:**
Each feature is a self-contained directory under `src/features/`:

```
src/features/search/
  ├── actions/
  │   └── search-hotels.ts        # Server Action
  ├── search-service.ts            # Business logic
  ├── contracts/
  │   └── search-schemas.ts        # Zod schemas
  └── search-service.test.ts       # Co-located test
```

**Co-located Tests:**
Every service and adapter has a `.test.ts` file next to it. No separate `tests/` directory.

**Shared Code:**
- `src/lib/` — infrastructure utilities (db, auth, errors, logger)
- `src/components/ui/` — shadcn/ui components (owned in-repo, Radix + Tailwind)
- `src/features/suppliers/contracts/` — shared adapter interface

### Format Patterns

**JSON Fields:** `camelCase` in API responses and client-side code. Prisma handles `snake_case` ↔ `camelCase` mapping automatically.

**Dates:** ISO 8601 strings in APIs and database (`2026-03-15`). Display format: "Mar 15, 2026" (via `date-fns` or `Intl.DateTimeFormat`).

**Currency:** Amounts as numbers (not strings, not cents). Currency as ISO code string (`"USD"`, `"EUR"`). Display: `$1,247.00` formatted with `Intl.NumberFormat`.

**Booleans:** `true`/`false` (never `1`/`0`).

**Null handling:** Explicit `null` for absent values. Never `undefined` in API responses.

### Process Patterns

**Server Action Precondition Sequence:**

Every Server Action follows this exact order:
1. Get session (`getServerSession()`)
2. Check auth (`requireAuth(session)` or `requireRole(session, 'admin')`)
3. Validate input (`Schema.parse(input)`)
4. Execute business logic (call service)
5. Return typed result

```typescript
'use server'
export async function createBooking(input: unknown): Promise<ActionResult<Booking>> {
  try {
    // 1. Session
    const session = await getServerSession();
    // 2. Auth
    requireAuth(session);
    // 3. Validate
    const validated = CreateBookingSchema.parse(input);
    // 4. Execute
    const booking = await bookingService.create(validated, session.user.id);
    // 5. Return
    return { success: true, data: booking };
  } catch (error) {
    return handleActionError(error);
  }
}
```

**Error Handling Pattern:**

```
Client Component
  → catches { success: false } from Server Action
  → shows user-friendly error via toast or inline message

Server Action
  → catches service/adapter errors
  → translates to { success: false, error: { code, message } }

Service Layer
  → catches adapter errors
  → throws AppError with typed code

Adapter Layer
  → catches supplier API errors
  → logs to supplier_api_logs
  → throws SupplierError with details
```

**Loading State Pattern:**
- Form submission: disable button, show spinner in button, keep form visible
- Search: show skeleton cards, replace with real results as they arrive
- Page navigation: skeleton matching page layout
- Never a blank page

**Supplier API Logging Pattern:**

Every supplier API call is logged:

```typescript
async function logSupplierCall(params: {
  supplier: 'tbo' | 'expedia';
  method: string;          // 'search', 'roomDetails', 'priceCheck', 'book'
  endpoint: string;
  requestBody: unknown;
  responseBody: unknown;
  responseStatus: number;
  durationMs: number;
  errorMessage?: string;
}) {
  await db.supplierApiLog.create({ data: params });
}
```

### Enforcement Guidelines

**All implementations MUST:**
1. Follow the Server Action precondition sequence exactly
2. Use Zod schemas for all external input validation
3. Return the standard `ActionResult<T>` shape from all Server Actions
4. Log all supplier API calls to the database
5. Apply markup through the markup service (never calculate inline)
6. Respect role boundaries (agent cannot see supplier identity, admin can)
7. Include a co-located `.test.ts` file for every new service and adapter
8. Use the `AppError` class for all thrown errors in the service layer

---

## Project Structure & Boundaries

### Complete Project Directory Structure

```
apolles/
├── .github/
│   └── pull_request_template.md
├── prisma/
│   ├── schema.prisma
│   └── migrations/
├── public/
│   └── favicon.ico
├── src/
│   ├── app/
│   │   ├── globals.css
│   │   ├── layout.tsx                       # Root layout (NextAuth provider, sidebar)
│   │   ├── page.tsx                         # Redirect to /search
│   │   │
│   │   ├── login/
│   │   │   └── page.tsx                     # Login page
│   │   │
│   │   ├── search/
│   │   │   ├── page.tsx                     # Search home + results
│   │   │   └── [supplier]/[hotelId]/
│   │   │       └── page.tsx                 # Room details page
│   │   │
│   │   ├── booking/
│   │   │   ├── [supplier]/[hotelId]/[rateId]/
│   │   │   │   └── page.tsx                 # Booking form (guest details + payment if Expedia)
│   │   │   └── [bookingId]/
│   │   │       ├── review/
│   │   │       │   └── page.tsx             # Booking review/summary
│   │   │       └── confirmation/
│   │   │           └── page.tsx             # Booking confirmation
│   │   │
│   │   ├── reservations/
│   │   │   ├── page.tsx                     # Reservations list
│   │   │   └── [bookingId]/
│   │   │       └── page.tsx                 # Reservation detail
│   │   │
│   │   ├── admin/
│   │   │   ├── bookings/
│   │   │   │   ├── page.tsx                 # All bookings (admin)
│   │   │   │   └── [bookingId]/
│   │   │   │       └── page.tsx             # Booking detail with supplier identity
│   │   │   ├── supplier-logs/
│   │   │   │   └── page.tsx                 # Supplier API logs
│   │   │   └── settings/
│   │   │       └── page.tsx                 # Platform settings (agents + markup)
│   │   │
│   │   └── api/
│   │       ├── auth/
│   │       │   └── [...nextauth]/
│   │       │       └── route.ts             # NextAuth API routes
│   │       └── webhooks/
│   │           └── stripe/
│   │               └── route.ts             # Stripe webhook handler (conditional — only if async payment confirmation needed)
│   │
│   ├── features/
│   │   ├── auth/
│   │   │   ├── auth-service.ts              # Login, session management
│   │   │   └── auth-service.test.ts
│   │   │
│   │   ├── search/
│   │   │   ├── actions/
│   │   │   │   └── search-hotels.ts         # Search Server Action
│   │   │   ├── search-service.ts            # Parallel supplier search + markup
│   │   │   ├── search-service.test.ts
│   │   │   └── contracts/
│   │   │       └── search-schemas.ts        # Search input/output Zod schemas
│   │   │
│   │   ├── suppliers/
│   │   │   ├── contracts/
│   │   │   │   └── supplier-adapter.ts      # Shared adapter interface
│   │   │   ├── adapters/
│   │   │   │   ├── tbo-adapter.ts           # TBO Holidays API adapter
│   │   │   │   ├── tbo-adapter.test.ts
│   │   │   │   ├── expedia-adapter.ts       # Expedia Rapid API adapter
│   │   │   │   └── expedia-adapter.test.ts
│   │   │   └── supplier-logger.ts           # Shared supplier API logging
│   │   │
│   │   ├── booking/
│   │   │   ├── actions/
│   │   │   │   ├── recheck-price.ts         # Price recheck Server Action
│   │   │   │   └── create-booking.ts        # Booking confirmation Server Action
│   │   │   ├── booking-service.ts           # Booking creation, state transitions
│   │   │   ├── booking-service.test.ts
│   │   │   └── contracts/
│   │   │       └── booking-schemas.ts       # Booking input/output Zod schemas
│   │   │
│   │   ├── voucher/
│   │   │   ├── actions/
│   │   │   │   └── generate-voucher.ts      # Voucher generation Server Action
│   │   │   ├── voucher-service.ts           # PDF generation from booking data
│   │   │   └── voucher-service.test.ts
│   │   │
│   │   ├── reservations/
│   │   │   ├── actions/
│   │   │   │   └── get-reservations.ts      # List/filter reservations
│   │   │   ├── reservations-service.ts      # Reservations queries
│   │   │   └── reservations-service.test.ts
│   │   │
│   │   ├── markup/
│   │   │   ├── markup-service.ts            # Apply markup calculation
│   │   │   └── markup-service.test.ts
│   │   │
│   │   └── admin/
│   │       ├── actions/
│   │       │   ├── get-all-bookings.ts      # Admin bookings list
│   │       │   ├── get-supplier-logs.ts     # Supplier logs query
│   │       │   ├── manage-agents.ts         # Create/deactivate agents
│   │       │   └── update-markup.ts         # Update platform markup
│   │       ├── admin-service.ts             # Admin business logic
│   │       └── admin-service.test.ts
│   │
│   ├── components/
│   │   ├── ui/                              # Reusable UI primitives
│   │   │   ├── button.tsx
│   │   │   ├── input.tsx
│   │   │   ├── badge.tsx
│   │   │   ├── card.tsx
│   │   │   ├── dialog.tsx
│   │   │   ├── separator.tsx
│   │   │   ├── skeleton.tsx
│   │   │   ├── toast.tsx
│   │   │   └── data-table.tsx
│   │   ├── layout/
│   │   │   ├── sidebar.tsx
│   │   │   ├── page-header.tsx
│   │   │   └── app-shell.tsx
│   │   └── domain/
│   │       ├── hotel-result-card.tsx
│   │       ├── source-indicator-badge.tsx
│   │       ├── status-badge.tsx
│   │       ├── price-change-notice.tsx
│   │       ├── payment-fields-container.tsx
│   │       ├── supplier-status-banner.tsx
│   │       └── search-form.tsx
│   │
│   ├── lib/
│   │   ├── db.ts                            # Prisma client singleton
│   │   ├── auth.ts                          # NextAuth config
│   │   ├── authorize.ts                     # Role check helpers
│   │   ├── errors.ts                        # AppError + error codes
│   │   ├── logger.ts                        # Structured logging (console-based)
│   │   └── utils.ts                         # Shared utility functions
│   │
│   ├── middleware.ts                         # Auth redirect middleware
│   └── env.ts                               # @t3-oss/env-nextjs type-safe env
│
├── .env.example
├── .env.local
├── .gitignore
├── next.config.js
├── tailwind.config.js
├── tsconfig.json
├── package.json
└── README.md
```

### Architectural Boundaries

**API Boundaries:**
- **External-facing Route Handlers:** `/api/auth/*` (NextAuth) is required. `/api/webhooks/stripe` is conditional (only if Expedia payment flow requires async Stripe confirmation). Everything else is Server Actions.
- **Supplier boundary:** All external supplier communication passes through `src/features/suppliers/adapters/`. No other module makes direct HTTP calls to supplier APIs.
- **Payment boundary:** Card data handled entirely by Stripe Elements iframe. Our server only receives a token.

**Layer Boundaries (enforced):**

```
┌─────────────────────────────────────────┐
│  App Router Pages (Server Components)    │
│  + Client Components (UI interaction)    │
├──────────────┬──────────────────────────┤
│  Server Actions  (src/features/*/actions)│
├──────────────┼──────────────────────────┤
│  Services        (src/features/*-service)│
├──────────┬───┴──────────────────────────┤
│ Adapters │ Prisma                        │
│(suppliers)│ (db.ts)                      │
├──────────┴──────────────────────────────┤
│  External: Expedia │ TBO                 │
│  External: Stripe                        │
│  Infra: PostgreSQL                       │
└─────────────────────────────────────────┘
```

**Data Boundaries:**
- All database access through Prisma client (`src/lib/db.ts`), called only from service layer functions
- Agent scoping enforced at service layer — agent queries always include `where: { agentId: session.user.id }`
- Admin queries have no agent scoping restriction

### Requirements to Structure Mapping

**FR Domain → Feature Module:**

| FR Domain | Feature Module | Key Files |
|-----------|---------------|-----------|
| Authentication (FR1-FR4) | `features/auth/` | auth-service, authorize |
| Hotel Search (FR5-FR15) | `features/search/`, `features/suppliers/` | search-service, tbo-adapter, expedia-adapter |
| Room & Rate Details (FR16-FR22) | `features/search/`, `features/suppliers/` | search-service (getRoomDetails), adapters |
| Booking Flow (FR23-FR34) | `features/booking/` | booking-service, create-booking, recheck-price |
| Voucher (FR35-FR38) | `features/voucher/` | voucher-service, generate-voucher |
| Reservations (FR39-FR44) | `features/reservations/` | reservations-service, get-reservations |
| Admin & Back-Office (FR45-FR52) | `features/admin/`, `features/markup/` | admin-service, markup-service |

**Cross-Cutting Concerns → Shared Location:**

| Concern | Location |
|---------|----------|
| Authorization | `lib/authorize.ts` |
| Markup Calculation | `features/markup/markup-service.ts` |
| Supplier Logging | `features/suppliers/supplier-logger.ts` |
| Structured Logging | `lib/logger.ts` |
| Error Codes | `lib/errors.ts` |
| Supplier Abstraction | `features/suppliers/contracts/supplier-adapter.ts` |

### Integration Points

**Internal Communication:**
- Pages → Server Actions (type-safe function calls)
- Server Actions → Services (direct function calls)
- Services → Prisma / Adapters (direct calls within layer boundary)

**External Integrations:**

| External Service | Integration Point | Protocol |
|-----------------|-------------------|----------|
| Expedia Rapid API v3 | `features/suppliers/adapters/expedia-adapter.ts` | HTTPS + SHA-512 signature auth |
| TBO Holidays API v1.4 | `features/suppliers/adapters/tbo-adapter.ts` | HTTPS + Basic Auth |
| Stripe Elements | `components/domain/payment-fields-container.tsx` | HTTPS + client-side SDK |
| Stripe Webhooks (conditional) | `api/webhooks/stripe/route.ts` — only if async payment confirmation required | HTTPS + webhook signatures |

**Data Flow (Search → Book):**

```
Agent searches → Server Action → search-service
  → Promise.allSettled([tbo-adapter.search(), expedia-adapter.search()])
  → markup-service.applyMarkup() to each result
  → return flat results array + supplier status

Agent selects room → Server Action → search-service.getRoomDetails()
  → adapter.getRoomDetails() (same adapter that produced the search result)
  → markup-service.applyMarkup() to each rate
  → return room/rate list

Agent books → Server Action → booking-service.create()
  → adapter.recheckPrice() → if changed, return PRICE_CHANGED
  → if Expedia: use Stripe token from client
  → adapter.book() with all details
  → persist booking record with full price chain
  → return confirmation
```

---

## Architecture Validation Results

### Coherence Validation

**Decision Compatibility:**
All technology choices are compatible and form a cohesive stack:
- Next.js App Router + TypeScript + Tailwind + Prisma + NextAuth + PostgreSQL — standard T3-adjacent stack, well-tested together
- Zod works natively with Prisma and Server Actions
- Stripe Elements client-side SDK compatible with Next.js App Router
- Sentry + Vercel Analytics are complementary
- No contradictory decisions found

**Pattern Consistency:**
- Naming conventions internally consistent (camelCase in code/JSON, snake_case in DB, PascalCase for types, kebab-case for files)
- Layer boundary rules align with the project structure (actions → services → adapters/Prisma)
- Server Action precondition sequence aligns with auth + validation decisions
- Error handling pattern (typed codes, adapter translation) is consistent throughout
- No inconsistencies found

**Structure Alignment:**
- Feature-based directory structure matches the layer boundary rules
- `contracts/` directories align with the Zod validation strategy
- Co-located tests align with the testing requirements
- `lib/` infrastructure files align with cross-cutting concern decisions
- No structural misalignment found

### Requirements Coverage Validation

**Functional Requirements Coverage:**

| FR Domain | Coverage | Notes |
|-----------|----------|-------|
| Authentication (FR1-FR4) | Covered | NextAuth, two roles, middleware redirect |
| Hotel Search (FR5-FR15) | Covered | Dual-supplier parallel search, markup, progressive display, source indicators |
| Room & Rate Details (FR16-FR22) | Covered | Adapter getRoomDetails, supplier-specific rates, cancellation policy display |
| Booking Flow (FR23-FR34) | Covered | Price recheck, Expedia payment (Stripe Elements), idempotency key, booking state machine |
| Voucher (FR35-FR38) | Covered | PDF generation from booking record |
| Reservations (FR39-FR44) | Covered | List with filters, detail page, status display |
| Admin & Back-Office (FR45-FR52) | Covered | All bookings view, supplier logs, agent CRUD, markup settings |

**0 uncovered functional requirements.**

**Non-Functional Requirements Coverage:**

| NFR Area | Coverage | Architectural Support |
|----------|----------|----------------------|
| Performance | Covered | Parallel supplier calls, Vercel serverless auto-scaling, managed PostgreSQL |
| Security | Covered | SAQ A-EP (Stripe Elements), NextAuth DB sessions, HTTPS, Zod validation, role checks |
| Reliability | Covered | Graceful supplier failure (show one source if other fails), 5s supplier timeout, no retry |
| Accessibility | Covered | shadcn/ui + Radix UI ARIA primitives, semantic HTML, WCAG 2.1 AA target |

**0 uncovered non-functional requirements.**

### Implementation Readiness Validation

**Decision Completeness:**
- All critical decisions documented with rationale
- Technology versions to be verified at project initialization (web search)
- Deferred decisions explicitly listed with trigger conditions

**Structure Completeness:**
- 40+ files and directories explicitly defined
- Every FR domain mapped to specific feature module and files
- All cross-cutting concerns mapped to shared locations

**Pattern Completeness:**
- Naming conventions cover database, API, code, files, types, schemas
- Layer boundaries explicitly enforced with diagram
- Server Action precondition sequence with code example
- Error handling at every layer

### Gap Analysis Results

**Critical Gaps: 0**

**Important Gaps (non-blocking, resolve during implementation):**

1. **Testing framework not specified** — Vitest recommended. Finalize at project init story.
2. **PDF generation approach not finalized** — Evaluate `@react-pdf/renderer` vs HTML-to-PDF at voucher implementation story.
3. **Stripe Elements exact configuration** — Finalize during Expedia payment implementation story (PaymentElement vs CardElement).

**Nice-to-Have Gaps (address post-MVP):**
- No API versioning strategy (not needed — no public API)
- No database backup/restore procedure documented (handled by managed PostgreSQL provider)
- No load testing strategy (not needed at 5-10 agent scale)

### Architecture Completeness Checklist

**Requirements Analysis**
- [x] Project context analyzed (lean PRD, ~52 FRs)
- [x] Scale and complexity assessed (Medium, 6-8 feature modules)
- [x] Technical constraints identified (7 constraints)
- [x] Cross-cutting concerns mapped (8 concerns)

**Architectural Decisions**
- [x] Critical decisions documented with rationale
- [x] Technology stack fully specified
- [x] Integration patterns defined (adapter pattern, Stripe Elements)
- [x] Performance considerations addressed (parallel calls, Vercel)
- [x] Security covered (SAQ A-EP, role checks, Zod validation)

**Implementation Patterns**
- [x] Naming conventions established (database, API, code)
- [x] Structure patterns defined (feature-based, co-located tests)
- [x] Communication patterns specified (Server Actions, typed results)
- [x] Process patterns documented (preconditions, error handling, loading)
- [x] Layer boundaries enforced

**Project Structure**
- [x] Complete directory structure defined (40+ files)
- [x] Component boundaries established (layer diagram)
- [x] Integration points mapped (4 external services)
- [x] Requirements to structure mapping complete (7 FR domains → feature modules)
- [x] Data flow documented (search → book)

### Architecture Readiness Assessment

**Overall Status:** READY FOR IMPLEMENTATION

**Confidence Level:** High

**Key Strengths:**
- Drastically simplified from original — fewer moving parts, fewer failure points
- No Redis, no jobs, no SSE, no queues — just Next.js + PostgreSQL + supplier adapters
- Every decision aligned with lean PRD scope
- Dual-supplier architecture is clean — parallel fetch, no merge, no mapping
- Expedia payment path is one clear path (Stripe Elements)
- Booking state model matches PRD exactly
- Price chain is explicit and auditable
- Practical for a non-developer building incrementally with vibe coding

**Areas for Future Enhancement (Phase 2+):**
- Redis caching if performance monitoring shows need
- Background job system when auto-cancellation is built
- Hotel mapping when dedup/merge is desired
- Wallet system when prepaid model is needed
- Email system when HCN or transactional emails are needed
- Multi-room booking support (Late MVP)

**First Implementation Priority:**
```bash
pnpm dlx create-t3-app@latest apolles --CI --appRouter --tailwind --prisma --nextAuth --dbProvider postgres --trpc false --drizzle false
```

**AI Agent / Vibe Coding Guidelines:**
- Follow all architectural decisions exactly as documented
- Use implementation patterns consistently across all components
- Respect project structure and boundaries
- Refer to this document for all architectural questions
- Every Server Action follows the precondition sequence: session → auth → validate → execute → return
- Every supplier call is logged to the database
- Every price displayed has markup applied through the markup service
- Never expose supplier identity to agent role
- Booking always goes to the adapter that produced the search result
