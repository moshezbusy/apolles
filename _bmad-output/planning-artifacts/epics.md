---
stepsCompleted: [1, 2, 3, 4]
inputDocuments:
  - _bmad-output/planning-artifacts/prd.md
  - _bmad-output/planning-artifacts/architecture.md
  - _bmad-output/planning-artifacts/ux-design-specification.md
revisionNote: 'Complete lean MVP re-breakdown aligned to approved lean product brief, lean PRD, updated UX design, and lean architecture (all 2026-03-11). Replaces old heavy-scope epic file.'
---

# Apolles - Epic Breakdown (Lean MVP)

## Epic Rewrite Summary

This is a **complete replacement** of the previous epics file. The old file contained 11 epics and 60+ stories reflecting the pre-lean scope (wallet, quotes, HCN automation, hotel mapping, deduplication, auto-cancellation, agency hierarchy, self-registration, circuit breaker, SSE, Redis). That scope is no longer valid.

This file contains **6 MVP Core epics** with narrow, implementation-friendly stories, plus **Late MVP / Phase 1.5** items and **Phase 2 items** listed for reference only. Every epic and story aligns directly to the approved lean PRD (2026-03-11), UX design specification (2026-03-11), and architecture (2026-03-11).

### What Was Removed from Old Epics File

| Removed Item | Old Location | Reason |
|---|---|---|
| Wallet & Financial Operations (entire epic) | Epic 3 (7 stories) | Wallet cut from MVP — no prepaid balance, no wallet-gated booking |
| Auto-Cancellation System (entire epic) | Epic 6 (5 stories) | Auto-cancel cut from MVP — no background jobs, no Inngest/Trigger.dev |
| Quote & Itinerary Builder (entire epic) | Epic 7 (7 stories) | Quote builder cut from MVP |
| HCN Verification (entire epic) | Epic 8 (6 stories) | HCN automation cut from MVP |
| Agent Settings & Customization (entire epic) | Epic 9 (3 stories) | No notification prefs, no quote branding, no agent settings in MVP |
| Agency & Team Features (entire epic) | Epic 11 (6 stories) | No agency hierarchy, no super/sub agent model |
| Self-registration (Story 1.3) | Epic 1 | Admin creates agents manually |
| Logo upload (Story 1.7) | Epic 1 | No branded PDFs in MVP |
| Circuit breaker + Redis state tracking | Epic 2 (Story 2.4) | No Redis, no circuit breaker — simple 5s timeout |
| Supplier orchestrator | Epic 2 (Story 2.5) | Replaced by simple Promise.allSettled in search service |
| SSE progressive delivery | Epic 2 (Story 2.6) | Standard request/response with loading states |
| Vervotech mapping sync | Epic 2 (Story 2.7) | No hotel mapping in MVP |
| Hotel deduplication | Epic 2 (Story 2.8) | No dedup in MVP |
| Destination autocomplete | Epic 2 (Story 2.9) | Moved to Late MVP |
| Rate comparison across suppliers | Epic 2 (Story 2.11) | No merged hotel view — results are supplier-specific |
| Wallet credit indicators on search | Epic 4 (Story 4.1) | No wallet |
| Wallet-gated booking enforcement | Epic 4 (Story 4.6) | No wallet |
| Multi-room booking | Epic 4 (Stories 4.7-4.8) | Moved to Late MVP |
| Booking cancellation action | Epic 5 (Story 5.3) | Moved to Late MVP |
| Booking modification requests | Epic 5 (Story 5.4) | Cut from MVP |
| Voucher queue / batch | Epic 5 (Stories 5.7-5.8) | Cut from MVP |
| Hotel mapping management admin | Epic 10 (Story 10.3) | No mapping |
| Booking status override admin | Epic 10 (Story 10.5) | Cut from MVP |
| Supplier issue escalation | Epic 10 (Story 10.7) | Cut from MVP |
| Auto-cancel escalation admin | Epic 10 (Story 10.6 partial) | No auto-cancel |
| Advanced admin dashboard metrics | Epic 10 (Story 10.1) | Simplified to minimal admin |

---

## Overview

This document provides the complete epic and story breakdown for Apolles Lean MVP, decomposing the requirements from the Lean PRD, UX Design Specification, and Lean Architecture into implementable stories.

The MVP delivers: login → admin-created users → hotel search (TBO + Expedia parallel) → supplier-specific results → room/rate details → price recheck → booking form → Expedia hosted payment → booking confirmation → voucher PDF → reservations list → reservation detail → minimal admin → supplier logs → platform markup.

---

## Requirements Inventory

### Functional Requirements

- **FR1**: Agent can log in with email and password
- **FR2**: Agent can log out, ending their session
- **FR3**: Admin can create a new agent account with name, email, and initial password
- **FR4**: Admin can deactivate an agent account, preventing login
- **FR5**: Admin can view a list of all agent accounts with status (active/inactive)
- **FR6**: Agent can search for hotels by destination (city name, free text), check-in date, check-out date, number of rooms (1 at MVP), adults per room, and children with ages
- **FR7**: System queries both TBO Holidays and Expedia Rapid APIs in parallel and returns combined results displaying: hotel name, star rating, image, starting price (with platform markup applied)
- **FR7a**: Results from each supplier displayed independently. Neutral source indicators (Source A / Source B). No dedup or merging.
- **FR8**: Agent can filter search results by price range and star rating
- **FR9**: Agent can sort search results by price or star rating
- **FR10**: If one supplier fails/times out (5s), system shows results from responsive supplier + retry action
- **FR10a**: If both fail, error message + Retry All
- **FR11**: Agent can view a list of rooms for a selected hotel
- **FR12**: Each room displays: room name, bed type, cancellation policy, meal plan, refundability, total price (with markup)
- **FR13**: Taxes/fees shown per supplier. Expedia mandated tax disclaimer.
- **FR14**: Agent selects room/rate → booking routed to originating supplier
- **FR15**: Price recheck with originating supplier before booking
- **FR16**: Price change displayed, agent decides proceed or cancel
- **FR17**: Guest details: full name (required), email (optional), phone (optional), special requests (optional)
- **FR17a**: Expedia bookings: card via hosted payment fields (Stripe Elements). No raw card data on Apolles servers. Only Expedia payment path at MVP.
- **FR18**: Booking summary/review with hotel, room, dates, guest, price, cancellation terms
- **FR18a**: Expedia rates: mandated display elements (tax disclaimer, cancellation, payment processing country)
- **FR19**: Agent can confirm or go back from summary
- **FR20**: Booking confirmation with supplier reference + Apolles booking ID
- **FR21**: Clear confirmed indication
- **FR21a-e**: Booking lifecycle states: pending, price_changed, confirmed, failed, cancelled
- **FR22**: Agent generates PDF voucher for confirmed booking
- **FR23**: Voucher displays: hotel name, address, dates, room type, guest name, confirmation number, agent company name
- **FR24**: Agent downloads voucher as PDF
- **FR25**: One voucher per booking, no queue, no batch
- **FR26**: Agent views all their bookings
- **FR27**: Filter reservations by status and date range
- **FR28**: Sort reservations by date or status
- **FR29**: Search reservations by guest name or booking reference
- **FR30**: Full reservation detail with reference numbers, status, cancellation terms, voucher button
- **FR31**: Admin sets platform-wide markup percentage
- **FR32**: Markup applied server-side before returning to agents
- **FR33**: Agent sees marked-up price as their cost
- **FR34**: Admin views all bookings across all agents
- **FR35**: Admin filters bookings by agent, date range, status
- **FR36**: Admin views full booking details for any booking
- **FR37**: System logs every supplier API call to database
- **FR38**: Admin views recent supplier API logs with filtering
- **FR39**: Admin identifies failed or slow API calls per supplier
- **FR40**: Admin lists all agents with name, email, status, date created
- **FR41**: Admin creates a new agent account
- **FR42**: Admin deactivates an agent account
- **FR43**: Common supplier interface: search(), priceCheck(), book(), cancel(), getBookingDetail()
- **FR44**: TBO adapter implements interface (Basic Auth)
- **FR44a**: Expedia adapter implements interface (SHA-512 signature auth)
- **FR45**: All supplier API calls logged (supplier, method, latency, status, error)
- **FR46**: 5-second timeout per supplier per call
- **FR47**: Both adapters normalize to common Apolles data model. No mapping, no dedup, no merge.
- **FR48**: Third supplier requires implementing the same interface, no core changes
- **FR49-52**: Supplier-specific result model (no UnifiedHotel, supplier-tied results, booking from concrete supplier result, booking record stores originating supplier context)

### Non-Functional Requirements

- **NFR1**: Combined search results < 5 seconds p95, progressive loading (first results as soon as they arrive)
- **NFR2**: Price recheck < 3 seconds per supplier
- **NFR3**: Booking confirmation < 10 seconds
- **NFR4**: Voucher PDF < 5 seconds
- **NFR5**: All pages load < 2 seconds
- **NFR6**: 20 concurrent agent sessions
- **NFR7**: Passwords via industry-standard one-way hashing (bcrypt)
- **NFR8**: Secure sessions (HttpOnly, Secure, SameSite), 30-min inactivity timeout
- **NFR9**: HTTPS everywhere
- **NFR10**: Supplier credentials encrypted at rest, never displayed
- **NFR10a**: Payment card data exclusively through Stripe hosted fields (SAQ A-EP)
- **NFR11**: OWASP Top 10 protection
- **NFR12**: Role-based data access enforced at API level
- **NFR13**: Platform availability 99%+ business hours
- **NFR14**: Zero data loss on confirmed bookings. RPO < 1 hour.
- **NFR15**: Graceful single-supplier failure (show other + retry)
- **NFR16**: Booking DB operations use transactions
- **NFR17**: Scale to 50 concurrent agents without re-architecture
- **NFR18**: New supplier = no core changes
- **NFR19**: 10K+ bookings/year without query degradation
- **NFR20**: 100% bookable fields mapped for TBO and Expedia
- **NFR21**: 5s timeout, clear error, no cascading failures
- **NFR22**: All supplier API calls logged with metadata

### Additional Requirements

**From Architecture:**

- Starter: T3-adjacent stack (Next.js App Router + TypeScript + Tailwind + Prisma + NextAuth + PostgreSQL)
- Server Actions as primary API layer (no REST routes except auth/webhooks)
- Feature-based directory structure with co-located tests
- Supplier adapter pattern: unified interface, separate TBO and Expedia adapters
- Stripe Elements for Expedia payment (SAQ A-EP, tokenized card)
- Two roles only: agent and admin
- No Redis, no SSE, no background jobs, no circuit breaker
- Simple 5s timeout per supplier, no retry logic
- Booking status model: pending → confirmed/failed, confirmed → cancelled
- Vercel deployment with managed PostgreSQL (Neon/Supabase)
- Zod validation at Server Action boundaries
- @t3-oss/env-nextjs for type-safe env validation
- Co-located .test.ts files for services and adapters
- Idempotency key on booking confirmation only
- Supplier API logs table for debugging
- Markup as service-layer concern (one centralized function)

**From UX Design Specification:**

- shadcn/ui + Tailwind CSS + Radix UI component library
- WCAG 2.1 Level AA accessibility
- Desktop-first responsive design
- Progressive loading: skeleton cards → results appear
- Neutral source indicators (Source A / Source B) on hotel cards
- Price change notice UX pattern (amber banner, old/new price)
- Expedia hosted payment step (Stripe Elements iframe)
- Confirmation gate for non-refundable bookings
- Light mode only for MVP. Design tokens support future dark mode.
- Inter primary font, JetBrains Mono for codes/numbers
- Booking lifecycle StatusBadge variants: pending, price_changed, confirmed, failed, cancelled
- Hotel card: View Rooms (primary), Book (secondary)
- Sidebar: Search (Home), Reservations, Admin section (admin only)
- Error toasts persistent with recovery action. Success toasts auto-dismiss 4s.
- Form validation: validate on blur, scroll-to-first-error on submit
- Empty states with contextual message + next-action button
- Filter bar: client-side, instant, no API call

### FR Coverage Map

| FR | Epic | Description |
|----|------|-------------|
| FR1 | Epic 1 | Agent login |
| FR2 | Epic 1 | Agent logout |
| FR3 | Epic 1 | Admin creates agent account |
| FR4 | Epic 1 | Admin deactivates agent |
| FR5 | Epic 1 | Admin views agent list (Story 1.6) |
| FR6 | Epic 2 | Hotel search form |
| FR7 | Epic 2 | Parallel supplier search with markup |
| FR7a | Epic 3 | Supplier-specific results with source indicators |
| FR8 | Epic 3 | Filter search results |
| FR9 | Epic 3 | Sort search results |
| FR10 | Epic 2 | Supplier failure with partial results + retry |
| FR10a | Epic 2 | Both suppliers fail handling |
| FR11 | Epic 3 | Room list for selected hotel |
| FR12 | Epic 3 | Room details (bed, cancellation, meal, price) |
| FR13 | Epic 3 | Taxes/fees display, Expedia tax disclaimer |
| FR14 | Epic 4 | Room selection → booking initiation |
| FR15 | Epic 4 | Price recheck before booking |
| FR16 | Epic 4 | Price change display and agent decision |
| FR17 | Epic 4 | Guest details entry |
| FR17a | Epic 4 | Expedia hosted payment fields |
| FR18 | Epic 4 | Booking summary/review |
| FR18a | Epic 4 | Expedia mandated display elements |
| FR19 | Epic 4 | Confirm or go back |
| FR20 | Epic 4 | Booking confirmation with references |
| FR21 | Epic 4 | Confirmed indication |
| FR21a-e | Epic 4 | Booking lifecycle states |
| FR22 | Epic 5 | Voucher PDF generation |
| FR23 | Epic 5 | Voucher content |
| FR24 | Epic 5 | Voucher PDF download |
| FR25 | Epic 5 | One voucher per booking |
| FR26 | Epic 5 | Reservations list |
| FR27 | Epic 5 | Filter reservations |
| FR28 | Epic 5 | Sort reservations |
| FR29 | Epic 5 | Search reservations |
| FR30 | Epic 5 | Reservation detail |
| FR31 | Epic 6 | Admin sets platform markup |
| FR32 | Epic 2 | Markup applied server-side |
| FR33 | Epic 2 | Agent sees marked-up price |
| FR34 | Epic 6 | Admin views all bookings |
| FR35 | Epic 6 | Admin filters bookings |
| FR36 | Epic 6 | Admin views booking details |
| FR37 | Epic 6 | Supplier API logging |
| FR38 | Epic 6 | Admin views supplier logs |
| FR39 | Epic 6 | Admin identifies failed/slow API calls |
| FR40 | Epic 1 | Admin lists agents (Story 1.6) |
| FR41 | Epic 1 | Admin creates agent (Story 1.6) |
| FR42 | Epic 1 | Admin deactivates agent (Story 1.6) |
| FR43 | Epic 2 | Common supplier interface |
| FR44 | Epic 2 | TBO adapter |
| FR44a | Epic 2 | Expedia adapter |
| FR45 | Epic 2 | Supplier API call logging |
| FR46 | Epic 2 | 5-second timeout |
| FR47 | Epic 2 | Normalized data model, no mapping/dedup |
| FR48 | Epic 2 | Third supplier = no core changes |
| FR49-52 | Epic 2 | Supplier-specific result model |

**All FRs mapped. 0 gaps.**

---

## Epic List

### Epic 1: Foundation, Authentication & Admin-Created Users
Agents can log in, log out, and access a secure authenticated workspace with sidebar navigation and role-based authorization. Admin can create, deactivate, and manage agent accounts. Platform infrastructure is initialized with the T3-adjacent starter, Prisma schema, NextAuth DB sessions, role-based authorization, structured logging, error handling, design tokens, and Vercel deployment.
**FRs covered:** FR1, FR2, FR3, FR4, FR5, FR40, FR41, FR42
**Scope clarification:** Includes project scaffolding (create-t3-app init), Prisma schema for User/Session/Account, NextAuth with database sessions, two roles (agent/admin), simple role-check authorization, dashboard shell with sidebar navigation, structured logging, typed error handling, design token setup, env validation, and agent management (list, create, deactivate). Admin creates agents manually — no self-registration. No password reset (Late MVP).

### Epic 2: Search & Supplier Adapters
Agents can search for hotels by destination and dates, and the system queries both TBO and Expedia in parallel, returning combined results with platform markup applied. All supplier interactions use a common adapter interface.
**FRs covered:** FR6, FR7, FR10, FR10a, FR32, FR33, FR43, FR44, FR44a, FR45, FR46, FR47, FR48, FR49-52
**Scope clarification:** Supplier adapter interface + TBO adapter + Expedia adapter, search service with Promise.allSettled, markup service, supplier API logging, 5s timeout. No circuit breaker, no Redis, no SSE, no orchestrator. Search form with basic inputs (no autocomplete — Late MVP). Results returned as a flat array, not streamed.

### Epic 3: Results Display, Room Details & Source Indicators
Agents can view search results as hotel cards with neutral source indicators, filter and sort results client-side, and drill into room/rate details with cancellation policies, meal plans, and supplier-specific tax disclaimers.
**FRs covered:** FR7a, FR8, FR9, FR11, FR12, FR13
**Scope clarification:** Hotel result card component, source indicator badges, client-side filter bar (price, stars, cancellation, sort), room details page with all rate info, Expedia tax disclaimer rendering, back navigation preserving state. No dedup view, no rate comparison across suppliers.

### Epic 4: Booking Flow & Expedia Payment
Agents can select a room, enter guest details, see a price recheck, handle price changes, provide card details for Expedia bookings via hosted payment fields, review the booking summary, and receive a confirmed booking with reference numbers.
**FRs covered:** FR14, FR15, FR16, FR17, FR17a, FR18, FR18a, FR19, FR20, FR21, FR21a-e
**Scope clarification:** Booking form (guest details + payment step for Expedia), price recheck via adapter, price change notice UX, Stripe Elements for Expedia tokenized card, booking summary/review page, booking confirmation page, booking status model (pending/price_changed/confirmed/failed/cancelled), idempotency key on booking confirmation. No wallet, no multi-room (Late MVP).

### Epic 5: Reservations, Voucher & Booking Detail
Agents can view all their bookings in a filterable list, access full reservation details with status and cancellation terms, generate a PDF voucher for confirmed bookings, and download the voucher.
**FRs covered:** FR22, FR23, FR24, FR25, FR26, FR27, FR28, FR29, FR30
**Scope clarification:** Reservations list page (filter, sort, search), reservation detail page (all booking info, status badge, cancellation terms), voucher PDF generation (server-side, one per booking), voucher download. No cancellation action (Late MVP), no batch vouchers, no modification requests.

### Epic 6: Minimal Admin & Supplier Logs
Admin (Moshe) can view all bookings across agents, view supplier API logs for debugging, and configure the platform-wide markup percentage. Agent management is delivered in Epic 1 (Story 1.6).
**FRs covered:** FR31, FR34, FR35, FR36, FR37, FR38, FR39
**Scope clarification:** Admin bookings page (all agents, with supplier identity visible), supplier logs page (filter by supplier/method/status), platform markup setting. Agent management (FR5, FR40-42) is already delivered in Epic 1, Story 1.6 — admin-created users are required before the MVP can be used. Epic 6 does not duplicate that functionality. No advanced dashboard, no mapping management, no escalation tracking.

### Dependency Flow

```
Epic 1 (Foundation + Auth)
  └── Epic 2 (Search + Adapters)
        └── Epic 3 (Results + Room Details)
              └── Epic 4 (Booking Flow + Payment)
                    └── Epic 5 (Reservations + Voucher)
                          └── Epic 6 (Admin + Logs)
```

Note: Epic 6 stories for supplier logs and markup can technically begin once Epic 2 delivers the logging table and markup service. However, the recommended build order keeps Epic 6 last because admin visibility is less urgent than the core agent workflow.

Each epic is standalone — it delivers complete user value without requiring future epics.

### Recommended Build Order

1. **Epic 1** — Foundation. Everything depends on auth and project scaffolding.
2. **Epic 2** — Search. The core value proposition (two suppliers, one search). Delivers the adapter layer, markup service, and logging that later epics depend on.
3. **Epic 3** — Results display. Makes search results usable (filtering, sorting, room details). Agent can now search and browse.
4. **Epic 4** — Booking. The revenue-generating flow. Agent can complete a booking end-to-end.
5. **Epic 5** — Reservations + Voucher. Agent can manage bookings and deliver the voucher artifact.
6. **Epic 6** — Admin. Moshe gets visibility into bookings, suppliers, agents, and markup.

---

## Late MVP / Phase 1.5

These features are added shortly after MVP Core is stable. Not epics — they are individual stories appended to existing epics.

| Feature | Target Epic | Notes |
|---------|-------------|-------|
| Password reset | Epic 1 (append) | Email-based reset flow. Requires email service. |
| Booking cancellation action | Epic 5 (append) | Cancel button on reservation detail with penalty display and confirmation gate. Requires adapter cancel() implementation. |
| Agent settings / defaults | Epic 1 (append) | Basic settings page: saved nationality/residency, password change. |
| Destination autocomplete | Epic 2 (append) | Debounced autocomplete on search destination field. |
| Multi-room search support | Epic 4 (append) | Support >1 room per booking. |

## Phase 2 / Future

| Feature | Notes |
|---------|-------|
| Vervotech hotel mapping | Cross-supplier deduplication |
| Unified hotel view | Single hotel card with rates from multiple suppliers |
| Quote / itinerary builder | Multi-city quote composition and PDF |
| Wallet system | Prepaid balance, wallet-gated booking |
| HCN verification automation | Automated email to hotels, status tracking |
| Agent self-registration | Public registration flow |
| Auto-cancellation | Deadline-triggered automatic cancellation of unvouchered bookings |
| Advanced admin analytics | Dashboards, metrics, performance data |
| Email transactional system | Notifications, alerts, HCN emails |
| Agency hierarchy (super/sub agent) | Team management, cascading markup |
| Booking modification requests | Date/guest name changes via supplier API |
| Per-agent markup override | Agent sets own markup on top of platform price |

---

## Epic 1: Foundation, Authentication & Admin-Created Users

Agents can log in, log out, and access a secure authenticated workspace with sidebar navigation and role-based authorization. Admin can create, deactivate, and manage agent accounts. Platform infrastructure is initialized with design tokens, structured logging, and error handling.

### Story 1.1: Initialize Project and Deploy Baseline App

As a **developer**,
I want the Apolles project scaffolded with the T3-adjacent stack and deployed to Vercel,
So that all subsequent development starts from a consistent, deployable foundation.

**Acceptance Criteria:**

**Given** the project is initialized with Next.js App Router, TypeScript, Tailwind CSS, Prisma, and NextAuth
**When** the project is pushed to GitHub
**Then** the app builds and runs locally without errors
**And** Vercel deployment produces a working preview environment
**And** `@t3-oss/env-nextjs` validates all required environment variables at build time
**And** `.env.example` documents every required variable (DATABASE_URL, NEXTAUTH_SECRET, NEXTAUTH_URL, TBO_API_KEY, TBO_API_SECRET, EXPEDIA_API_KEY, EXPEDIA_API_SECRET, STRIPE_PUBLIC_KEY, STRIPE_SECRET_KEY)
**And** structured JSON logger is implemented in `src/lib/logger.ts`
**And** error factory with typed error codes is implemented in `src/lib/errors.ts` (NOT_AUTHENTICATED, NOT_AUTHORIZED, VALIDATION_ERROR, SUPPLIER_TIMEOUT, SUPPLIER_ERROR, RATE_UNAVAILABLE, PRICE_CHANGED, BOOKING_FAILED)
**And** Prisma client singleton is configured in `src/lib/db.ts`
**And** `tailwind.config.js` includes the Apolles design tokens (color palette, typography scale, spacing scale from UX spec)
**And** shadcn/ui is installed and base components (Button, Input, Badge, Card, Dialog, Skeleton, Toast, Separator) are copied into `src/components/ui/`

### Story 1.2: Auth-Ready Data Model and Seed

As a **developer**,
I want the foundational Prisma schema with User, Session, and Account models,
So that authentication and all future data models build on a stable foundation.

**Acceptance Criteria:**

**Given** the Prisma schema is created
**When** migrations are run
**Then** User model exists with fields: id (uuid), email (unique), name, passwordHash, role (enum: AGENT, ADMIN), isActive (boolean, default true), createdAt, updatedAt
**And** Account and Session models exist per NextAuth Prisma adapter requirements
**And** Prisma Migrate generates and applies the initial migration successfully
**And** a seed script creates test data: one admin account (Moshe) and one agent account
**And** Prisma client singleton is configured and working

### Story 1.3: Agent Login, Logout & Secure Sessions

As an **agent**,
I want to log in with email and password and maintain a secure session,
So that I can securely access my workspace.

**Acceptance Criteria:**

**Given** I have a valid account created by admin
**When** I submit valid credentials on the login page
**Then** a database session is created via NextAuth with Prisma adapter
**And** session cookie is set with HttpOnly, Secure, SameSite flags (NFR8)
**And** I am redirected to the search page (home)
**Given** I submit invalid credentials
**When** the login is processed
**Then** I see a generic error message that does not reveal which field was wrong
**Given** I have been inactive for 30 minutes
**When** I attempt any action
**Then** my session has expired and I am redirected to login
**When** I click logout
**Then** my database session is deleted and I am redirected to the login page
**And** login page uses the Apolles design system (Inter font, #635BFF primary, #0A2540 dark elements)
**And** password is verified against industry-standard one-way hash (bcrypt) (NFR7)
**And** deactivated accounts (isActive = false) cannot log in and see "Account is inactive"

### Story 1.4: Dashboard Shell with Sidebar Navigation

As an **agent**,
I want to see an authenticated dashboard with sidebar navigation,
So that I have a central workspace to access all platform features.

**Acceptance Criteria:**

**Given** I am logged in
**When** I access any authenticated page
**Then** I see a sidebar with navigation items: Search (active by default), Reservations
**And** admin users additionally see: All Bookings, Supplier Logs, Platform Settings
**And** the sidebar uses `#0A2540` dark background with white text
**And** active nav item shows `#635BFF` primary color text with left accent bar
**And** my name and role are displayed at the sidebar bottom
**And** logout action is available from sidebar bottom
**And** all pages within the authenticated area require auth — unauthenticated access redirects to login
**And** Next.js middleware handles auth redirect
**And** semantic HTML landmarks: header, nav, main
**And** skip-to-content link visible on first Tab press
**And** focus indicators: 2px primary outline, 2px offset on all interactive elements (WCAG 2.1 AA)
**And** sidebar is responsive: on mobile (< 768px), navigation moves to a simple header with hamburger menu

### Story 1.5: Simple Role-Based Authorization

As the **platform**,
I want a simple role-check authorization module,
So that admin-only actions are protected and agents can only access their own data.

**Acceptance Criteria:**

**Given** the `requireAuth()` and `requireRole()` functions exist in `src/lib/authorize.ts`
**When** a protected Server Action is called
**Then** the precondition sequence is enforced: resolve session → check auth → check role → validate input → execute
**And** `requireAuth(session)` throws NOT_AUTHENTICATED if no session
**And** `requireRole(session, 'admin')` throws NOT_AUTHORIZED if user is not admin
**And** agent queries for bookings/reservations are always scoped to their own userId
**And** admin queries have no agent scoping restriction
**And** authorization failures return { success: false, error: { code: 'NOT_AUTHORIZED', message } }
**And** co-located unit tests cover: valid agent, valid admin, no session, wrong role

### Story 1.6: Admin Creates and Deactivates Agent Accounts

As the **admin**,
I want to create new agent accounts and deactivate existing ones,
So that I can manually onboard agents to the platform.

**Acceptance Criteria:**

**Given** I am logged in as admin
**When** I navigate to Platform Settings
**Then** I see a section for agent management with a list of agents (name, email, status, date created)
**And** I can click "Create Agent" to open a form: name (required), email (required), initial password (required)
**And** password must meet complexity: 12+ characters, uppercase, lowercase, digit, special character (NFR7)
**And** on successful creation, the agent appears in the list with status "Active"
**And** the agent's password is hashed with bcrypt before storage
**And** I can click "Deactivate" on an active agent, changing their status to Inactive
**And** I can click "Activate" on an inactive agent, restoring access
**And** deactivated agents cannot log in (enforced at login — Story 1.3)
**And** creating an agent with an existing email shows a clear error
**And** all fields validated with Zod on both client and server
**And** success toast: "Agent created" / "Agent deactivated" (auto-dismiss 4s)

---

## Epic 2: Search & Supplier Adapters

Agents can search for hotels by destination and dates. The system queries TBO and Expedia in parallel, returns combined results with markup applied. All supplier interactions go through a common adapter interface.

### Story 2.1: Supplier Adapter Interface and Normalized Data Model

As a **developer**,
I want a unified supplier adapter interface with normalized data model schemas,
So that all supplier integrations implement a consistent contract.

**Acceptance Criteria:**

**Given** the `SupplierAdapter` interface is defined in `src/features/suppliers/contracts/supplier-adapter.ts`
**When** a new adapter implements it
**Then** the interface defines methods: `search()`, `getRoomDetails()`, `recheckPrice()`, `book()`. The interface also defines `cancel()` and `getBookingDetail()` for forward compatibility, but these are not implemented at MVP Core — cancellation action is Late MVP (Story L2)
**And** normalized Zod schemas exist for all response types: `SupplierSearchResult` (supplier, supplierHotelId, hotelName, starRating, address, images, lowestRate with supplierAmount, currency, roomName, mealPlan, cancellationPolicy, isCancellable), `SupplierRoomDetail`, `PriceCheckResult`, `BookingResult`
**And** each result carries its supplier identifier (`'tbo' | 'expedia'`) and `supplierHotelId` — results are always supplier-specific (FR49-52)
**And** the `supplier_api_logs` table Prisma model is created with fields: id, supplier (enum: TBO, EXPEDIA), method, endpoint, requestBody, responseBody, responseStatus, durationMs, errorMessage, createdAt
**And** a logging helper in `src/features/suppliers/supplier-logger.ts` wraps all adapter calls to write to `supplier_api_logs` automatically (FR45, NFR22)
**And** typed error codes for supplier failures are defined: SUPPLIER_TIMEOUT, SUPPLIER_ERROR, RATE_UNAVAILABLE (FR46)

### Story 2.2: TBO Holidays API Search Adapter

As a **developer**,
I want a TBO adapter implementing the supplier interface for hotel search,
So that TBO hotel inventory is available through the normalized contract.

**Acceptance Criteria:**

**Given** the `SupplierAdapter` interface exists (Story 2.1)
**When** the TBO adapter implements `search()`
**Then** it authenticates using Basic Auth per TBO API v1.4 requirements
**And** search parameters (destination, dates, rooms, adults, children with ages) are mapped to TBO's HotelSearch API format
**And** TBO responses are normalized into the unified Apolles data model
**And** the adapter enforces a 5-second timeout and returns SUPPLIER_TIMEOUT on expiry (FR46, NFR21)
**And** every API call is logged to `supplier_api_logs` via the shared logging helper (FR45)
**And** TBO-specific errors are translated to Apolles typed error codes — raw TBO errors never reach the service layer
**And** co-located unit tests in `tbo-adapter.test.ts` cover: successful search, timeout, auth failure, malformed response, empty results

### Story 2.3: Expedia Rapid API v3 Search Adapter

As a **developer**,
I want an Expedia adapter implementing the supplier interface for hotel search,
So that Expedia hotel inventory is available through the same normalized contract.

**Acceptance Criteria:**

**Given** the `SupplierAdapter` interface exists (Story 2.1)
**When** the Expedia adapter implements `search()`
**Then** it authenticates using SHA-512 signature auth per Expedia Rapid API v3 requirements
**And** search parameters are mapped to Expedia's API format
**And** Expedia responses are normalized into the same unified Apolles data model as TBO
**And** Expedia-specific metadata is preserved in the normalized output: tax disclaimer text, cancellation policy text, check-in instructions, payment processing country (for use in booking flow FR18a)
**And** the adapter enforces a 5-second timeout and returns SUPPLIER_TIMEOUT on expiry (FR46)
**And** every API call is logged to `supplier_api_logs` (FR45)
**And** Expedia-specific errors are translated to Apolles typed error codes
**And** co-located unit tests in `expedia-adapter.test.ts` cover: successful search, timeout, auth failure, malformed response, empty results

### Story 2.4: Platform Markup Service

As the **platform**,
I want a centralized markup calculation module,
So that all supplier rates have the platform markup applied consistently before display.

**Acceptance Criteria:**

**Given** the markup service exists in `src/features/markup/markup-service.ts`
**When** `applyMarkup(supplierAmount, markupPercentage)` is called
**Then** the result is `supplierAmount * (1 + markupPercentage / 100)` rounded to 2 decimal places (half-up) (FR32)
**And** the markup percentage is read from the `platform_settings` table (key: `markup_percentage`)
**And** the `platform_settings` Prisma model is created: key (unique string), value (string), updatedAt, updatedBy (FK to users)
**And** a seed migration sets the initial markup percentage (e.g., 12%)
**And** the markup service is a pure function used by: search results, price recheck, booking confirmation — one source of truth (FR33)
**And** co-located unit tests cover: zero markup, typical markup (12%), edge cases (0.1%, 100%), rounding precision verified to the cent

### Story 2.5: Search Service with Parallel Supplier Calls

As an **agent**,
I want to search for hotels and get results from both TBO and Expedia in one request,
So that I see inventory from both suppliers without searching separately.

**Acceptance Criteria:**

**Given** I submit a hotel search with destination, check-in, check-out, adults, children
**When** the search Server Action is called
**Then** it validates input with Zod, calls `requireAuth()`, then calls the search service
**And** the search service calls both TBO and Expedia adapters using `Promise.allSettled()` (FR7)
**And** results from all responsive suppliers are combined into a flat array
**And** the markup service applies the platform markup to every result's price before returning (FR32, FR33)
**And** if one adapter rejects (timeout/error), results from the responsive adapter are returned with a `supplierStatus` object indicating which supplier(s) failed (FR10)
**And** if both adapters reject, an empty results array is returned with both suppliers marked as failed (FR10a)
**And** the response shape is: `{ results: SupplierSearchResult[], supplierStatus: { tbo: 'success' | 'failed', expedia: 'success' | 'failed' } }`
**And** combined search results return within 5 seconds for p95 queries (NFR1)
**And** search service has co-located tests covering: both succeed, one timeout, one error, both fail

### Story 2.6: Search Form UI

As an **agent**,
I want a clean search form on the home page,
So that I can quickly find hotels for my client.

**Acceptance Criteria:**

**Given** I am logged in and on the Search (home) page
**When** the page loads
**Then** I see a search form with fields: Destination (text input), Check-in date (date picker), Check-out date (date picker), Adults (number, default 2), Children (number, default 0, with age inputs when > 0)
**And** the form uses shadcn/ui components (Input, Calendar + Popover for dates, Button)
**And** the search button triggers search on click and Enter key in any field
**And** all inputs validated with Zod before submission: destination required, check-out > check-in, dates in the future, adults 1-6, children ages 0-17
**And** form validates on blur and shows errors at field level per UX spec
**And** scroll-to-first-error on submit with focus on the first invalid field
**And** during search: button shows spinner, form remains visible
**And** search results area shows skeleton cards (6 cards) immediately on search submission
**And** when results arrive, skeleton cards are replaced with real hotel cards (or error state)

---

## Epic 3: Results Display, Room Details & Source Indicators

Agents can view search results as hotel cards with neutral source indicators, filter and sort results, and drill into room/rate details.

### Story 3.1: Hotel Result Cards with Source Indicators

As an **agent**,
I want to see hotel search results as cards with key information and source indicators,
So that I can quickly scan options and distinguish results from different sources.

**Acceptance Criteria:**

**Given** search results are loaded
**When** the results grid renders
**Then** each hotel is displayed as a `HotelResultCard` component showing: hotel name (semibold), star rating (icons), primary image (via `next/image` with lazy loading for below-fold), starting price (bold, medium weight, with markup applied), source indicator badge ("Source A" / "Source B"), meal plan badge, cancellation policy badge ("Free cancel until [date]" or "Non-refundable"), location (if available) (FR7a)
**And** source indicator badges use `Micro` type scale (11px, medium weight), `--neutral-bg` background — deliberately subtle
**And** source labels are consistent within a search session: all TBO results share one label, all Expedia results share another
**And** each card is an `<article>` with `aria-label="[Hotel Name], [Star Rating] stars, from $[Price]"`
**And** action buttons: "View Rooms" (primary) → room details page, "Book" (secondary) → booking form for cheapest rate
**And** results grid: 3-col on desktop (xl+), 2-col on tablet (md-lg), 1-col on mobile (< md)
**And** prices use JetBrains Mono font
**And** when no results: empty state "No hotels found for these dates. Try different dates or destination." + "Search Again" button
**And** supplier unavailability banner positioned above results: amber background, clear text, "[Retry Source B]" ghost button (FR10)

### Story 3.2: Client-Side Filtering and Sorting

As an **agent**,
I want to filter and sort search results by price and star rating,
So that I can narrow down the best options quickly.

**Acceptance Criteria:**

**Given** search results are displayed
**When** I apply filters
**Then** results are filtered instantly on the client side with zero API calls (FR8)
**And** available filters: price range slider, star rating checkboxes (1-5), cancellation toggle ("Free cancellation only")
**And** active filters shown as removable chips above results
**And** "Clear all filters" link appears when any filter is active
**And** visible result count updates as filters change: "Showing 23 of 82 hotels"
**When** I select a sort option from a dropdown
**Then** results re-sort instantly (FR9): Price low-to-high, Price high-to-low, Star rating
**And** back navigation (browser back or in-app back) preserves filter state, sort state, and scroll position
**And** filter bar is above results, below supplier status banner

### Story 3.3: Room Details Page

As an **agent**,
I want to see all available rooms and rates for a selected hotel,
So that I can compare options before booking.

**Acceptance Criteria:**

**Given** I click "View Rooms" on a hotel card
**When** the room details page loads
**Then** I see a page header with: hotel name (H1), star rating, source indicator badge, location
**And** a room list showing each available room with: room name (semibold), bed type, meal plan badge, cancellation policy with dates and penalty amounts ("Free cancellation until Apr 10, 2026" or "Non-refundable"), refundability badge (green "Refundable" or amber "Non-refundable"), total price (bold, with markup applied), taxes/fees breakdown (FR11, FR12)
**And** for Expedia-sourced rooms: the legally mandated tax disclaimer text is displayed below the price (FR13)
**And** TBO-sourced rooms show TBO-specific tax display per certification requirements
**And** each room has a "Book This Room" primary button
**And** "Back to Results" button in page header returns to search results with scroll position and filters preserved
**And** the room details page loads room data via the adapter's `getRoomDetails()` method (or from the search result data if it contains full room details)
**And** loading state: skeleton matching page layout

---

## Epic 4: Booking Flow & Expedia Payment

Agents can select a room, complete a booking with price recheck, enter guest details, handle Expedia payment, and receive a confirmed booking.

### Story 4.1: Booking Data Model and Status Machine

As a **developer**,
I want the booking database model with lifecycle status tracking,
So that all booking operations have a stable data foundation.

**Acceptance Criteria:**

**Given** the Prisma schema is updated
**When** the migration runs
**Then** a `bookings` table exists with fields: id (uuid), agentId (FK to users), status (enum: PENDING, PRICE_CHANGED, CONFIRMED, FAILED, CANCELLED), supplier (enum: TBO, EXPEDIA), supplierHotelId, supplierRef (nullable), hotelName, roomName, checkIn, checkOut, adults, children, supplierAmount, markupPercentage, markupAmount, displayAmount, recheckAmount (nullable), confirmedAmount (nullable), currency, cancellationPolicy (JSON), supplierRawResponse (JSON), idempotencyKey (unique), createdAt, updatedAt
**And** a `booking_guests` table exists with: id, bookingId (FK), fullName, email (nullable), phone (nullable), specialRequests (nullable, max 500 chars)
**And** the BookingStatus enum aligns with the PRD lifecycle: PENDING → CONFIRMED/FAILED, CONFIRMED → CANCELLED (FR21a-e)
**And** PRICE_CHANGED is a transient state (FR21b)
**And** booking records store the originating supplier context (FR52)

### Story 4.2: Price Recheck via Supplier Adapter

As an **agent**,
I want the system to verify the current price before I confirm a booking,
So that I am not surprised by price changes.

**Acceptance Criteria:**

**Given** I have selected a room and initiated booking
**When** the price recheck Server Action is called
**Then** it calls the originating supplier adapter's `recheckPrice()` method (FR15)
**And** the recheck returns: `{ available: boolean, priceChanged: boolean, originalAmount: number, currentAmount: number, currency: string }`
**And** if the supplier does not respond within 5 seconds, a SUPPLIER_TIMEOUT error is returned
**And** the recheck result is used by the booking form to determine the next step
**And** the markup service is applied to the rechecked amount before display
**And** the API call is logged to `supplier_api_logs`
**And** co-located tests cover: price unchanged, price increased, price decreased, rate unavailable, timeout

### Story 4.3: Guest Details Form and Price Change Notice

As an **agent**,
I want to enter guest details and see clear information if the price changed,
So that I can complete the booking with accurate information.

**Acceptance Criteria:**

**Given** I selected a room and the system performed a price recheck
**When** the price is unchanged
**Then** I see the booking form with guest detail fields: full name (required), email (optional), phone (optional), special requests (textarea, optional, max 500 chars) (FR17)
**And** form uses single-column layout, label above field, required fields marked with asterisk
**And** all fields validated with Zod on blur and on submit
**When** the price changed
**Then** a Price Change Notice banner appears at the top: amber `--warning-bg` background, 4px left border, showing original price (strikethrough) and updated price (bold) with difference (FR16)
**And** "Back to Rooms" (ghost button) and "Continue at $X" (primary button) actions
**And** the agent must explicitly accept the new price before guest details form becomes active
**When** the rate is no longer available
**Then** error: "This rate is no longer available. [Back to Rooms] [Search Again]"
**When** the recheck times out
**Then** error: "Unable to verify the rate. [Retry] [Back to Rooms]"
**And** form data is preserved if an error occurs — agent does not re-enter details

### Story 4.4: Expedia Hosted Payment Fields

As an **agent**,
I want to securely enter card details for Expedia bookings via hosted payment fields,
So that the booking can be processed without Apolles handling raw card data.

**Acceptance Criteria:**

**Given** I am booking an Expedia-sourced room and guest details are entered
**When** the payment step renders
**Then** a "Payment Details" section appears with Stripe Elements hosted payment fields (card number, expiry, CVC) (FR17a)
**And** explanation text: "Card details are required to complete this booking. Your card information is securely processed and never stored on our servers."
**And** the iframe is styled to match Apolles design tokens (Inter font, matching border radius, input heights)
**And** below the iframe: "Secured by Stripe" indicator text
**And** help text: "Some sources require card details to complete the booking. This depends on the source providing the rate." (avoids revealing supplier identity)
**Given** I am booking a TBO-sourced room
**When** the booking form renders
**Then** the payment step is skipped entirely — TBO uses credit-based payment
**And** Stripe Elements SDK loaded only when needed (code-split, not in main bundle)
**And** PCI scope: SAQ A-EP — card data never touches Apolles server, only the token (NFR10a)

### Story 4.5: Booking Summary and Review

As an **agent**,
I want to review all booking details before confirming,
So that I can verify everything is correct before committing.

**Acceptance Criteria:**

**Given** guest details are entered (and payment for Expedia)
**When** I proceed to the review step
**Then** I see the booking summary showing: hotel name, location, room type, bed configuration, check-in/check-out dates, number of nights, guest name, meal plan, cancellation policy with dates and penalties, total price (post-recheck, with markup), taxes/fees breakdown (FR18)
**And** for Expedia rates: mandated display elements (tax disclaimer text, payment processing country) (FR18a)
**And** "Back" (ghost button) returns to edit guest details
**And** "Confirm Booking" (primary button) submits to supplier
**And** if the rate is non-refundable, an explicit warning is shown: "This booking is non-refundable. Once confirmed, this booking cannot be cancelled or refunded. Total charge: $X" (confirmation gate per UX spec)

### Story 4.6: Booking Submission and Confirmation

As an **agent**,
I want to submit the booking and receive a confirmed reservation,
So that I have a committed booking with reference numbers.

**Acceptance Criteria:**

**Given** I click "Confirm Booking" on the review page
**When** the booking is submitted
**Then** the Server Action creates a booking record with status PENDING and a unique idempotency key
**And** the adapter's `book()` method is called with: guest details, room/rate context, payment token (Expedia only), and idempotency key
**And** on successful supplier confirmation: booking status transitions to CONFIRMED, supplier reference number is stored, confirmedAmount is recorded (FR20, FR21)
**And** the confirmation page displays: "Booking Confirmed" with green checkmark, Apolles booking ID (monospace, copyable), Confirmation Number (supplier ref, monospace, copyable), hotel name, room type, dates, guest name, total price, cancellation terms (FR20)
**And** "Generate Voucher" primary button and "Go to Reservations" link on confirmation page
**And** booking response time within 10 seconds p95 (NFR3)
**Given** the supplier rejects the booking
**Then** booking status transitions to FAILED, failure reason is displayed: "Booking Failed" with error icon, plain-language reason, "[Search Again]" "[Try Another Room]" actions (FR21d)
**Given** the same idempotency key is replayed (network retry)
**Then** the original booking outcome is returned without creating a duplicate reservation
**And** the booking record stores: originating supplier, supplier hotel ID, supplier booking reference, supplier-specific rate details (FR52)
**And** all booking operations use database transactions to prevent partial writes (NFR16)

---

## Epic 5: Reservations, Voucher & Booking Detail

Agents can view, filter, and manage their bookings. Agents can generate and download a PDF voucher for confirmed bookings.

### Story 5.1: Reservations List Page

As an **agent**,
I want to view all my bookings in a filterable, sortable list,
So that I can quickly find and manage any booking.

**Acceptance Criteria:**

**Given** I navigate to the Reservations page (sidebar)
**When** the page loads
**Then** I see a data table of my bookings with columns: Booking Ref (monospace, JetBrains Mono, clickable → detail), Hotel name, Guest name, Check-in date ("Mar 15, 2026"), Check-out date, Status (StatusBadge: Pending/Confirmed/Failed/Cancelled), Total price, Actions (FR26)
**And** the table loads within 2 seconds (NFR5)
**And** bookings are scoped to my agentId only — I see only my own bookings (NFR12)
**And** I can filter by: status (checkbox group: Confirmed, Failed, Cancelled), date range (check-in date picker) (FR27)
**And** I can sort by: date (default: newest first), status, hotel name (FR28)
**And** I can search by: guest name or booking reference (FR29)
**And** pagination: "Showing 1-25 of N" with page buttons
**And** empty state: "No bookings yet. Search for hotels to make your first booking." + "[Go to Search]" button
**And** each row clickable → reservation detail page
**And** on mobile: table transforms to card-based list with booking ref, status badge, and hotel name visible

### Story 5.2: Reservation Detail Page

As an **agent**,
I want to view full booking details for a single reservation,
So that I have all information about the booking in one place.

**Acceptance Criteria:**

**Given** I click a booking row in the reservations list
**When** the reservation detail page loads
**Then** I see:
- **Header:** Hotel name (H1), StatusBadge (current lifecycle state), Apolles booking ID (monospace, copyable), "← Back to Reservations" link
- **Section 1 — Booking Details:** Confirmation number (monospace, copyable), hotel name and address, check-in/check-out dates, number of nights, room type and bed configuration, meal plan, guest name, email, phone, special requests (FR30)
- **Section 2 — Pricing:** Total price (confirmed amount — immutable), taxes/fees breakdown, for Expedia: mandated tax disclaimer
- **Section 3 — Cancellation Terms:** Full policy with dates and penalties. "Free cancellation until [date]" or "Non-refundable". If free period passed: "Cancellation penalty: $[amount]"
- **Section 4 — Voucher:** If generated: "Download Voucher" button. If not: "Generate Voucher" button.
**And** source indicator badge visible (Source A / Source B) — no supplier name for agents
**And** the page loads within 2 seconds (NFR5)
**And** skeleton matching page layout shown during load
**And** cancellation action button: **not present in MVP Core** — added in Late MVP

### Story 5.3: Voucher PDF Generation

As an **agent**,
I want to generate a PDF voucher for a confirmed booking,
So that I have a document to send my client.

**Acceptance Criteria:**

**Given** I am on the booking confirmation page or reservation detail page for a CONFIRMED booking
**When** I click "Generate Voucher"
**Then** a PDF voucher is generated server-side (FR22)
**And** the voucher includes: hotel name, hotel address, check-in date, check-out date, room type, guest name(s), confirmation number (supplier reference), agent company name (from user profile) (FR23)
**And** the voucher includes applicable legal/tax disclaimer text (supplier-specific, but without revealing supplier name)
**And** voucher generation completes within 5 seconds (NFR4)
**And** button shows spinner during generation
**And** one voucher per booking — if already generated, the existing voucher is returned (FR25)
**And** the voucher PDF is stored and accessible from the reservation detail page permanently
**And** success toast: "Voucher generated" (auto-dismiss 4s)

### Story 5.4: Voucher PDF Download

As an **agent**,
I want to download the voucher PDF,
So that I can share it with my client via WhatsApp, email, or any channel.

**Acceptance Criteria:**

**Given** a voucher has been generated for a booking
**When** I click "Download Voucher" on the reservation detail page
**Then** the PDF downloads to my device with filename: `voucher-{apolles-booking-id}.pdf` (FR24)
**And** the PDF does NOT contain: supplier name, supplier API reference ID, cost prices, markup information
**And** if download fails, an error toast with "Retry" option
**And** the download link is also available from the reservations list row actions for CONFIRMED bookings with a generated voucher

---

## Epic 6: Minimal Admin & Supplier Logs

Admin (Moshe) can view all bookings across agents, view supplier API logs, and configure platform markup. Agent management is delivered in Epic 1 (Story 1.6).

### Story 6.1: Admin Bookings View

As the **admin**,
I want to view all bookings across all agents,
So that I can monitor platform activity and investigate issues.

**Acceptance Criteria:**

**Given** I am logged in as admin and navigate to All Bookings (admin sidebar)
**When** the page loads
**Then** I see a data table of all bookings across all agents with columns: Booking Ref, Supplier (actual name: TBO / Expedia — admin only), Agent name, Hotel, Guest, Check-in, Status (StatusBadge), Total (Agent price), Total (Supplier cost — admin only), Markup amount (admin only) (FR34)
**And** I can filter by: agent, date range, status, supplier (FR35)
**And** row click opens full booking detail with admin-level visibility: supplier name, cost breakdown, supplier reference labeled with supplier name (FR36)
**And** the page loads within 2 seconds (NFR5)
**And** the admin route is protected by `requireRole(session, 'admin')` (NFR12)

### Story 6.2: Supplier API Logs View

As the **admin**,
I want to view recent supplier API logs,
So that I can debug supplier issues and monitor API health.

**Acceptance Criteria:**

**Given** I navigate to Supplier Logs (admin sidebar)
**When** the page loads
**Then** I see a data table with columns: Timestamp, Supplier (TBO/Expedia), Method (search, getRoomDetails, recheckPrice, book), Latency (ms), HTTP Status, Status (Success/Error badge), Error message (truncated, expandable) (FR38)
**And** most recent logs first
**And** I can filter by: supplier, method, status (success/error), date range (FR38, FR39)
**And** error rows highlighted with `--error-bg` background
**And** click to expand full error details and request/response metadata
**And** pagination: 25/50/100 per page
**And** the page loads within 2 seconds (NFR5)

### Story 6.3: Platform Markup Configuration

As the **admin**,
I want to set the platform-wide markup percentage,
So that the platform earns margin on every booking.

**Acceptance Criteria:**

**Given** I navigate to Platform Settings (admin sidebar)
**When** I view the markup section
**Then** I see the current markup percentage displayed prominently (e.g., "12%")
**And** an input field to set a new percentage (0-100%, 0.1% increments) (FR31)
**And** "Save" button to update
**And** confirmation toast: "Markup updated to 12%. All future searches will use this rate."
**And** note displayed: "This does not affect existing confirmed bookings."
**And** the markup value is stored in `platform_settings` table and read by the markup service (Story 2.4)
**And** input validated with Zod (number, >= 0, <= 100)

---

## Late MVP / Phase 1.5 Stories (Reference Only)

### Story L1: Password Reset (appends to Epic 1)

As an **agent**,
I want to reset my password via email,
So that I can regain access without contacting the admin.

**Acceptance Criteria:**

**Given** I click "Forgot Password" on login page
**When** I enter my email and submit
**Then** a reset email with a time-limited token (1 hour) is sent
**And** the same message shows whether or not the email exists (no enumeration)
**And** following the link lets me set a new password (meeting complexity requirements)
**And** all existing sessions are invalidated on password change
**And** expired/used links show a clear error with "Request new link" option

### Story L2: Booking Cancellation Action (appends to Epic 5)

As an **agent**,
I want to cancel a confirmed booking with penalty display,
So that I can cancel when my client's plans change.

**Acceptance Criteria:**

**Given** I am on reservation detail for a CONFIRMED booking
**When** I click "Cancel Booking"
**Then** a confirmation dialog shows: hotel, dates, guest, cancellation penalty (or "Free cancellation"), explicit consequence statement
**And** "Dismiss" (ghost) and "Cancel Booking" (destructive) buttons
**And** on confirm: adapter's `cancel()` is called, status → CANCELLED
**And** requires adapter `cancel()` implementation in both TBO and Expedia adapters
**And** success toast: "Booking cancelled" (auto-dismiss 4s)

### Story L3: Agent Settings Page (appends to Epic 1)

As an **agent**,
I want a basic settings page,
So that I can save defaults and change my password.

**Acceptance Criteria:**

**Given** I navigate to Settings (added to agent sidebar)
**Then** I see: saved nationality default, saved residency default, password change form
**And** defaults pre-fill the search form for future searches

### Story L4: Destination Autocomplete (appends to Epic 2)

As an **agent**,
I want autocomplete suggestions when typing a destination,
So that I can search faster and avoid typos.

**Acceptance Criteria:**

**Given** I type in the destination field
**Then** autocomplete suggestions appear, debounced at 300ms
**And** suggestions come from a destination API or static city list

### Story L5: Multi-Room Search Support (appends to Epic 4)

As an **agent**,
I want to book multiple rooms in a single booking,
So that I can handle group or family bookings.

**Acceptance Criteria:**

**Given** I set rooms > 1 on the search form
**Then** I can configure adults/children per room
**And** booking form shows per-room guest detail fields
**And** total price is the sum of all room rates
