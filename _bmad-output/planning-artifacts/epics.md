---
stepsCompleted: [1, 2]
inputDocuments:
  - _bmad-output/planning-artifacts/prd.md
  - _bmad-output/planning-artifacts/architecture.md
  - _bmad-output/planning-artifacts/ux-design-specification.md
---

# Apolles - Epic Breakdown

## Overview

This document provides the complete epic and story breakdown for Apolles, decomposing the requirements from the PRD, UX Design, and Architecture requirements into implementable stories.

## Requirements Inventory

### Functional Requirements

- **FR1**: Agent can search for hotels by destination (city/area), check-in/check-out dates, number of rooms, adults per room, and children with ages
- **FR2**: System queries multiple supplier APIs (Expedia, TBO) in parallel, returning combined results in a single view
- **FR3**: System deduplicates hotel results across suppliers using hotel mapping, merging the same physical hotel into one result card with rates from each supplier
- **FR4**: System displays low-confidence mapping matches as separate entries rather than incorrectly merging them
- **FR5**: Agent can view rate comparison across suppliers for the same hotel, with the cheapest rate highlighted
- **FR6**: Agent can view room-level details per hotel: bed types, cancellation policy, meal plans, refundability status
- **FR7**: Agent can filter and sort search results by price, star rating, cancellation policy, and other hotel attributes
- **FR8**: System displays wallet credit indicators on search results, flagging rates that require wallet credit the agent doesn't have
- **FR9**: When one or more suppliers fail to respond within the timeout window, the system displays results from responsive suppliers within the 5-second target, shows a visible indicator identifying which supplier(s) are unavailable, and provides a "Retry" action for the failed supplier(s)
- **FR10**: Platform owner can view supplier name and API metadata for each search result; agents cannot see supplier identity
- **FR11**: Agent can add hotel options from search results to a quote across 2 or more cities/destinations (up to 10 cities per quote)
- **FR12**: Agent can select 2-4 hotel options per city and organize them within a quote
- **FR13**: Agent can add notes per city or per hotel option within a quote
- **FR14**: Agent can generate a branded PDF quote/itinerary document with hotel details, images, rates, cancellation terms, and agent branding (logo, company name)
- **FR15**: Agent can send the quote PDF via email or download it for sharing through other channels (WhatsApp, etc.)
- **FR16**: Quote PDF displays only the final client price -- no supplier names, cost prices, or internal markup information
- **FR17**: Agent can select a specific room/rate from search results and proceed to booking
- **FR18**: System performs a price check / pre-book validation with the supplier before confirming a booking
- **FR19**: System notifies the agent if the price changed between search and booking, displaying the updated price before confirmation
- **FR20**: Agent can enter required guest details (full name, email, phone number) and optional special requests (free text, max 500 characters) during the booking process. Payment processed via wallet deduction for penalized rates or direct supplier charge for free-cancellation rates. Required fields validated before submission.
- **FR21**: System enforces Expedia B2B display requirements throughout the booking flow: cancellation policies, tax breakdowns with legally mandated text, check-in instructions, payment processing country, SCA compliance, and downstream agent T&C acceptance
- **FR22**: Agent can complete a multi-room booking with separate cancellation capability per room
- **FR23**: System blocks booking of non-refundable / penalized rates when the agent's wallet balance is insufficient to cover the potential penalty
- **FR24**: Agent can book free cancellation rates regardless of wallet balance
- **FR25**: Sub-agent can request wallet top-up from super agent with booking details when blocked by insufficient credit (fast-follow)
- **FR25b**: Super agent receives in-app and email notification when a sub-agent requests booking approval or wallet top-up. Super agent can review the request details, approve or reject with a reason, and the sub-agent is notified of the outcome immediately (fast-follow)
- **FR26**: System generates a booking confirmation with supplier reference number and Apolles internal booking ID
- **FR27**: Agent can view all bookings in a list with search, filter (by status, date, hotel, client, voucher status), and sort
- **FR28**: Agent can view full booking details: reservation info, supplier reference, HCN status, voucher status, auto-cancel countdown, cancellation policy, and price breakdown (per role visibility rules)
- **FR29**: Agent can cancel a booking with cancellation penalty display and confirmation before execution
- **FR30**: Agent can submit a modification request for date changes or guest name changes on active bookings. System checks supplier API support for the specific modification type: if supported, executes the modification and displays the updated booking; if not supported, displays a message directing the agent to contact the hotel or supplier directly. Modification requests logged in the booking audit trail.
- **FR31**: Agent can generate a voucher for a confirmed booking, changing its status to "vouchered" (committed) and stopping the auto-cancel timer
- **FR32**: Agent can add up to 20 confirmed bookings to a voucher queue and generate vouchers for all queued items in a single batch action
- **FR33**: Agent can download voucher PDFs for individual or batch-generated vouchers
- **FR34**: System auto-cancels unvouchered bookings before the last free cancellation deadline with a configurable safety buffer (default: 2-4 hours). All cancellation deadlines converted to a common time reference to prevent timezone-related missed cancellations.
- **FR35**: System sends multi-touchpoint auto-cancellation warnings: in-app notification at 48 hours, email at 48 and 24 hours, visual countdown on the booking card
- **FR36**: System retries failed auto-cancellation attempts with progressively increasing delays (up to 3 retries within the safety buffer window) and escalates to admin if all retries fail
- **FR37**: Agent can view a chronological audit trail for each booking showing: creation, price checks, status changes (confirmed/vouchered/cancelled), voucher generation, HCN status updates, cancellation or modification events, auto-cancel warnings sent, and admin interventions. Each entry includes timestamp, actor (system/agent/admin), and event details.
- **FR38**: System automatically sends an HCN verification email to the hotel reservation department after booking confirmation
- **FR39**: Agent can view per-reservation HCN status: Available / Waiting / Email Sent / Confirmed / Mismatch / Issue
- **FR40**: Agent can manually update HCN status and add notes
- **FR41**: Agent can resend HCN verification emails from the booking detail view
- **FR42**: Agent can configure their sending email address for HCN verification in account settings
- **FR43**: Agent can customize the HCN verification email body text, greeting, and closing. The email must always include system-populated, non-removable fields: hotel name, confirmation number, guest name, check-in/check-out dates, and room type. Agent can preview the template before saving.
- **FR44**: Agent can view a dashboard of all bookings with pending/unverified HCN statuses
- **FR45**: Agent can view their current wallet balance
- **FR46**: Agent can top up their wallet via payment gateway (credit card / other supported methods)
- **FR47**: System prevents double-spending during simultaneous bookings by reserving wallet balance before confirming with the supplier. If two bookings attempt to use the same balance concurrently, one succeeds and the other is rejected with a clear insufficient-balance message.
- **FR48**: Agent can view transaction history: bookings, charges, wallet top-ups, cancellation refunds
- **FR49**: Agent can generate a PDF invoice for any completed booking or wallet top-up transaction. Invoice includes: agent business details, transaction date, booking reference, hotel name, dates, total amount, applicable taxes, and payment method. Invoices are sequentially numbered and stored for 7 years per tax compliance requirements.
- **FR50**: Agent can set their markup percentage on supplier rates (applied to the price they see as their "cost")
- **FR51**: Platform owner can set the platform markup percentage applied to all supplier rates
- **FR52**: Super agent can set agency-level markup applied to all sub-agent pricing (fast-follow)
- **FR53**: Sub agent can set their own personal markup on top of their visible cost (fast-follow)
- **FR54**: System calculates markup at each layer by applying the configured percentage to the layer's visible cost, rounding to 2 decimal places (half-up). Each layer's calculation is independent and uses the output of the layer below as input. Margin accuracy validated to the cent across all active layers for 100% of booking transactions (fast-follow for multi-layer; single-layer at MVP)
- **FR55**: Agent can register an account (self-service) with email, password, and basic company information
- **FR56**: Agent can log in, log out, and reset their password
- **FR57**: Agent can edit their profile: company/agent details, business name, contact info, address, tax ID
- **FR58**: Agent can upload a company logo for use in quote PDFs and vouchers, with immediate preview
- **FR59**: Agent can configure quote settings: (1) select a default quote PDF template from a system-provided set, (2) set primary and secondary brand colors via hex code or color picker, (3) edit header/footer text, (4) edit disclaimer text (free text, max 1000 characters), and (5) set default markup percentage (0-100%, 0.1% increments). Changes apply to all subsequently generated quotes.
- **FR60**: Agent can independently toggle on/off each notification type: auto-cancellation warnings (in-app + email), HCN status updates (in-app + email), booking confirmations (email), and wallet low-balance alerts (in-app + email). Default: all notifications enabled.
- **FR61**: Super agent can invite sub-agents to their agency and configure their permissions (fast-follow)
- **FR62**: Super agent can view a filterable activity feed for all sub-agents showing: searches performed (count per day), quotes generated (with client details), bookings made (with status and value), HCN statuses, and wallet usage. Data filterable by sub-agent, date range, and activity type (fast-follow)
- **FR63**: Super agent can deactivate or modify sub-agent accounts and permissions (fast-follow)
- **FR64**: System enforces role-based data visibility: supplier names visible only to platform owner; cost/markup visible per the cascading visibility rules
- **FR65**: Platform owner can view a dashboard with platform-wide metrics: active agents, booking volume, supplier API health, hotel mapping stats
- **FR66**: Platform owner can monitor supplier API response times and availability status
- **FR67**: Platform owner can manage hotel mapping: review low-confidence matches, manually confirm or reject merges, override mappings
- **FR68**: Platform owner can investigate individual bookings across all agents for support purposes
- **FR69**: Platform owner can view and manage failed auto-cancellation attempts and escalated booking issues
- **FR70**: Platform owner can view all agent accounts and their status across the platform
- **FR71**: Platform owner can override a booking's status (e.g., mark as manually cancelled, force voucher generation) with a mandatory reason note logged in the audit trail
- **FR72**: Platform owner can escalate supplier issues by logging a supplier support ticket reference against a booking, tracking resolution status (Open / Escalated / Resolved), and viewing all open escalations in a filtered dashboard view

### NonFunctional Requirements

- **NFR1**: Combined search results from all connected suppliers returned in under 5 seconds for 95th percentile of queries
- **NFR2**: Progressive result loading -- first supplier results displayed within 2 seconds; additional supplier results appended as they arrive
- **NFR3**: Price check / pre-book validation completes in under 3 seconds
- **NFR4**: Booking confirmation response within 10 seconds (dependent on supplier API)
- **NFR5**: Quote PDF generation completes in under 5 seconds for a multi-city quote with up to 12 hotel options
- **NFR6**: Batch voucher generation (up to 10 vouchers) completes in under 15 seconds
- **NFR7**: Dashboard and booking list pages load in under 2 seconds
- **NFR8**: System supports 50 concurrent agent sessions with no degradation in response times
- **NFR9**: Hotel mapping lookups (Vervotech) add no more than 500ms to search response time
- **NFR10**: PCI DSS compliance -- cardholder data encrypted in transit (TLS 1.2+) and at rest (AES-256). No storage of full card numbers where avoidable; use tokenization.
- **NFR11**: Supplier API credentials stored encrypted at rest, never displayed in full in any UI
- **NFR12**: Agent authentication via industry-standard one-way password hashing with appropriate computational cost factor. Minimum password complexity: 12+ characters, at least one uppercase letter, one lowercase letter, one digit, and one special character. Passwords checked against common breach lists on registration and change.
- **NFR13**: Session management with secure tokens, automatic timeout after 30 minutes of inactivity, secure cookie handling (HttpOnly, Secure, SameSite=Strict). Session invalidated on password change. Maximum 3 concurrent sessions per agent.
- **NFR14**: Role-based data access enforced at the API level -- not just UI-hidden. Sub-agents cannot access supplier names or cost prices even via direct API calls.
- **NFR15**: All financial transactions (wallet top-ups, booking charges, refunds) logged in an immutable audit trail
- **NFR16**: HTTPS enforced on all endpoints. No plaintext HTTP.
- **NFR17**: Input validation and protection against OWASP Top 10 vulnerabilities (SQL injection, XSS, CSRF, etc.)
- **NFR18**: SCA (Strong Customer Authentication) / 3D Secure support for European card payments per PSD2
- **NFR19**: Platform availability 99.5%+ during business hours (06:00-23:00 in agent's configured time zone)
- **NFR20**: Zero data loss on confirmed bookings, financial transactions, and wallet balances under any single-point failure scenario. Data durability and recovery mechanisms must ensure recovery to within 1 minute of failure (RPO < 1 minute). Recovery time objective (RTO) under 4 hours for full platform restoration.
- **NFR21**: Auto-cancellation system reliability: 99.9%+ success rate on scheduled cancellations. Failed cancellations retry and escalate within the safety buffer window.
- **NFR22**: When an individual supplier API is unavailable, the platform continues operating with available suppliers. Specifically: search returns results from responsive suppliers within the 5-second target, displays which supplier(s) are unavailable, and provides a retry action. Booking management, wallet, quote builder, and HCN features remain fully functional regardless of supplier availability. No user-facing errors or blank screens from a single supplier outage.
- **NFR23**: Scheduled job monitoring with alerting for failures (auto-cancellation, HCN emails, mapping syncs). Alerts delivered within 5 minutes of failure detection via email and team messaging channel. Escalation to on-call within 15 minutes if unacknowledged. Alert categories: auto-cancellation failure (Critical), HCN email delivery failure (High), mapping sync failure (Medium).
- **NFR24**: All wallet operations must be fully atomic -- no partial updates, no lost credits, no double-spending under any concurrent access scenario.
- **NFR25**: System supports scaling to 500 concurrent agents without significant re-architecture. Response time SLAs (NFR1-NFR9) must be maintained at 500-agent load.
- **NFR26**: Adding a new supplier integration requires no changes to core search or booking logic. New supplier onboarding effort must not exceed 2 developer-weeks.
- **NFR27**: Hotel mapping lookups across 2M+ hotel records must complete in sub-second times (< 500ms p95).
- **NFR28**: Booking and transaction database designed for 100K+ bookings per year without query performance degradation
- **NFR29**: Email delivery system supports 1,000+ emails per day (HCN verification, notifications, auto-cancel warnings)
- **NFR30**: All supplier-specific data formats normalized into a unified Apolles data model. Normalization must cover: room types, cancellation policies, tax breakdowns, meal plans, and hotel amenities. Completeness target: 100% of bookable fields mapped for Expedia and TBO at MVP launch.
- **NFR31**: External API calls must fail fast when a supplier is unresponsive (timeout within 5 seconds) and recover automatically when the supplier becomes available again, preventing cascading timeouts across the platform. No single supplier failure may degrade response times for other suppliers or platform features.
- **NFR32**: All external API interactions logged with request/response metadata for debugging and support
- **NFR33**: Supplier API health monitoring with alerting thresholds: alert when average response time exceeds 3 seconds (sustained over 5 minutes) or error rate exceeds 5% (sustained over 5 minutes). Thresholds adjustable per supplier.
- **NFR34**: Vervotech mapping data synchronized at least once per 24 hours with incremental updates
- **NFR35**: Email delivery tracking for HCN verification emails -- delivery status (sent, delivered, bounced) and open tracking. Bounce notifications surfaced to agent within 1 hour. Delivery success rate target: 95%+ for non-bounced addresses.
- **NFR36**: Payment gateway integration supports tokenized card storage (no raw card data stored on Apolles infrastructure) and recurring wallet top-ups. Tokenization success rate: 99.9%+. Stored tokens valid for at least 12 months before re-authentication required.

### Additional Requirements

**From Architecture:**

- Starter template: create-t3-app (Next.js App Router + TypeScript + Tailwind + Prisma + NextAuth + PostgreSQL). Project initialization command specified.
- Database: Single PostgreSQL with row-level tenant scoping. Prisma Migrate for migrations. Redis (Upstash) for caching and pub/sub.
- Auth: NextAuth.js with database sessions. Centralized RBAC authorization module.
- Payments: SAQ-A with Stripe hosted payment page (redirect flow).
- Supplier adapters: Unified interface pattern (search, priceCheck, book, cancel, getBookingDetail). Circuit breaker with Redis state tracking.
- Real-time: SSE via Vercel Edge Functions. Redis pub/sub feeds SSE connections.
- Auto-cancellation: Inngest or Trigger.dev for reliability-critical job scheduling with retry, dead-letter, and observability.
- PDF generation: @react-pdf/renderer for quotes and vouchers (server-side).
- Monitoring: Sentry for errors, Vercel Analytics for performance, structured JSON logging, supplier health dashboard from supplier_api_logs table.
- CI/CD: GitHub Actions + Vercel auto-deploy. PR template with enforcement checklist.
- Environment: @t3-oss/env-nextjs for type-safe env validation.
- Idempotency keys required for all financial operations.
- Immutable audit_events table for 7-year financial record retention.
- Encrypted supplier credentials (AES-256) decrypted only at runtime in adapter layer.

**From UX Design Specification:**

- WCAG 2.1 Level AA accessibility compliance required.
- Desktop-first responsive design with 5 Tailwind breakpoints. Critical transition at lg (1024px).
- Mobile bottom navigation bar replaces sidebar below md breakpoint.
- Quote builder read-only on mobile with "Continue on desktop" deep link.
- Data tables transform to card-based list views on mobile.
- Keyboard shortcuts: `/` or `Ctrl+K` for search, `Ctrl+N` new tab, `Ctrl+W` close tab, `Ctrl+Enter` submit, `Escape` dismiss, `?` help overlay.
- All animations < 300ms. prefers-reduced-motion fully respected (opt-in animation pattern).
- Skeleton loading for all data-dependent content. Progressive search loading with supplier count indicator.
- Search results > 50 hotels: virtualized rendering (@tanstack/react-virtual).
- Error toasts persistent with recovery action. Success toasts auto-dismiss 4s. Max 3 toasts visible.
- Form validation: validate on blur, scroll-to-first-error on submit, clear on correction.
- Every empty state includes contextual message + next-action button.
- "Add to Quote" is true 1-click action (no modal, no confirmation).
- Workspace tabs (soft limit 8) with state preservation across tab switches.
- State persistence across breakpoint transitions (no state loss on resize).
- Last 5 searches stored in localStorage as quick-access chips.
- Search filters are client-side (instant, no API call). Active filters as removable chips.
- Destination autocomplete debounced 300ms.
- Light mode only for MVP. Design tokens must support future dark mode.
- Performance targets: LCP < 2.5s desktop / < 3.5s mobile, INP < 200ms desktop / < 300ms mobile, CLS < 0.1, initial JS < 200KB gzipped desktop.
- CI quality gates: Playwright responsive smoke tests (3 viewports) on every PR, axe-core accessibility (zero critical/serious violations blocks merge).
- Hotel images via next/image with WebP/AVIF, lazy loading for below-fold.
- Monospace font (JetBrains Mono) for booking references, confirmation codes, wallet amounts.
- Touch targets: 44px minimum mobile, 36px minimum desktop.
- Focus indicators: 2px primary outline with 2px offset on all interactive elements.
- Back navigation preserves exact state (scroll position, filters, selections).

### FR Coverage Map

| FR | Epic | Description |
|----|------|-------------|
| FR1 | Epic 2 | Hotel search by destination, dates, rooms, guests |
| FR2 | Epic 2 | Parallel multi-supplier search |
| FR3 | Epic 2 | Hotel deduplication via Vervotech mapping |
| FR4 | Epic 2 | Low-confidence matches shown separately |
| FR5 | Epic 2 | Rate comparison across suppliers |
| FR6 | Epic 2 | Room-level details (beds, cancellation, meals) |
| FR7 | Epic 2 | Filter and sort search results |
| FR8 | Epic 4 | Wallet credit indicators on search results |
| FR9 | Epic 2 | Graceful supplier timeout with retry |
| FR10 | Epic 2 | Role-based supplier name visibility |
| FR11 | Epic 7 | Add hotels to multi-city quote |
| FR12 | Epic 7 | 2-4 hotel options per city |
| FR13 | Epic 7 | Notes per city/hotel in quote |
| FR14 | Epic 7 | Branded PDF quote generation |
| FR15 | Epic 7 | Send/download quote PDF |
| FR16 | Epic 7 | Client-price-only PDF |
| FR17 | Epic 4 | Select room/rate and proceed to booking |
| FR18 | Epic 4 | Price check / pre-book validation |
| FR19 | Epic 4 | Price change notification |
| FR20 | Epic 4 | Guest details + payment processing |
| FR21 | Epic 4 | Expedia B2B display compliance |
| FR22 | Epic 4 | Multi-room booking |
| FR23 | Epic 4 | Wallet balance enforcement for penalized rates |
| FR24 | Epic 4 | Free cancellation booking without wallet |
| FR25 | Epic 11 | Sub-agent wallet top-up request (fast-follow) |
| FR25b | Epic 11 | Super agent approval workflow (fast-follow) |
| FR26 | Epic 4 | Booking confirmation with references |
| FR27 | Epic 5 | Booking list with search/filter/sort |
| FR28 | Epic 5 | Full booking detail view |
| FR29 | Epic 5 | Booking cancellation with penalty display |
| FR30 | Epic 5 | Booking modification request |
| FR31 | Epic 5 | Voucher generation (commitment boundary) |
| FR32 | Epic 5 | Batch voucher queue (up to 20) |
| FR33 | Epic 5 | Voucher PDF download |
| FR34 | Epic 6 | Auto-cancellation with safety buffer |
| FR35 | Epic 6 | Multi-touchpoint auto-cancel warnings |
| FR36 | Epic 6 | Auto-cancel retry + admin escalation |
| FR37 | Epic 5 | Booking audit trail |
| FR38 | Epic 8 | Automatic HCN email after booking |
| FR39 | Epic 8 | HCN status per reservation |
| FR40 | Epic 8 | Manual HCN status update |
| FR41 | Epic 8 | Resend HCN email |
| FR42 | Epic 8 | Configure HCN sending email |
| FR43 | Epic 8 | Customize HCN email template |
| FR44 | Epic 8 | HCN pending dashboard |
| FR45 | Epic 3 | View wallet balance |
| FR46 | Epic 3 | Wallet top-up via Stripe |
| FR47 | Epic 3 | Atomic wallet / double-spend prevention |
| FR48 | Epic 3 | Transaction history |
| FR49 | Epic 3 | PDF invoice generation |
| FR50 | Epic 3 | Agent markup percentage |
| FR51 | Epic 3 | Platform owner markup percentage |
| FR52 | Epic 11 | Agency-level markup (fast-follow) |
| FR53 | Epic 11 | Sub-agent personal markup (fast-follow) |
| FR54 | Epic 3 (single-layer) / Epic 11 (multi-layer) | Markup calculation |
| FR55 | Epic 1 | Agent registration |
| FR56 | Epic 1 | Login, logout, password reset |
| FR57 | Epic 1 | Profile editing |
| FR58 | Epic 1 | Logo upload |
| FR59 | Epic 9 | Quote settings and branding (UI calls Epic 3 markup engine) |
| FR60 | Epic 9 | Notification preferences |
| FR61 | Epic 11 | Sub-agent invitation + permissions (fast-follow) |
| FR62 | Epic 11 | Sub-agent activity feed (fast-follow) |
| FR63 | Epic 11 | Sub-agent account management (fast-follow) |
| FR64 | Epic 1 | Role-based data visibility enforcement |
| FR65 | Epic 10 | Platform admin dashboard |
| FR66 | Epic 10 | Supplier API monitoring |
| FR67 | Epic 10 | Hotel mapping management |
| FR68 | Epic 10 | Cross-tenant booking investigation |
| FR69 | Epic 10 | Auto-cancel escalation management |
| FR70 | Epic 10 | Agent account management |
| FR71 | Epic 10 | Booking status override |
| FR72 | Epic 10 | Supplier issue escalation tracking |

**All 73 FRs mapped. 0 gaps.**

## Epic List

### Epic 1: Project Foundation & Agent Authentication
Agents can register, log in, manage their profile, and access a secure authenticated workspace. Platform infrastructure is initialized with the T3 starter, Prisma schema foundation, database provisioning, and Redis setup.
**FRs covered:** FR55, FR56, FR57, FR58, FR64
**Scope clarification:** Includes create-t3-app init, Prisma schema foundation with tenant scoping, NextAuth DB sessions, centralized RBAC authorization module, dashboard shell with sidebar navigation, structured logging, audit trail infrastructure, and environment configuration. Delivers a usable authenticated app with profile management. RBAC enforces role-based data visibility (FR64) at the API level from day one.

### Epic 2: Hotel Search & Discovery
Agents can search for hotels across multiple suppliers and view deduplicated, comparable results with room details, rate comparison, filtering, and sorting. Progressive loading shows results as suppliers respond.
**FRs covered:** FR1, FR2, FR3, FR4, FR5, FR6, FR7, FR9, FR10
**Scope clarification:** Supplier adapter layer (Expedia + TBO) with unified interface, Vervotech hotel mapping integration with Redis cache, supplier orchestrator for parallel search, circuit breaker, progressive SSE loading, client-side filtering/sorting, role-based supplier name visibility. FR8 (wallet indicators) deferred to Epic 4 when wallet exists.

### Epic 3: Wallet & Financial Operations
Agents can view their wallet balance, top up via Stripe, view transaction history, generate PDF invoices, and set their markup percentage. Platform owner can set platform markup. All financial operations are atomic, idempotent, and fully audited.
**FRs covered:** FR45, FR46, FR47, FR48, FR49, FR50, FR51, FR54 (single-layer MVP)
**Scope clarification:** Stripe SAQ-A integration (hosted redirect), wallet service with PostgreSQL row-level locking and idempotency keys, immutable audit trail for all financial transactions, centralized markup calculation module (single-layer at MVP), transaction history UI, PDF invoice generation via @react-pdf/renderer with sequential numbering and 7-year retention. Must be complete before booking flow (wallet-gated bookings).

### Epic 4: Booking Flow
Agents can select a room from search results, complete a booking with real-time price check, enter guest details, and receive a confirmed booking. Wallet-gated enforcement prevents bookings beyond the agent's balance. Wallet credit indicators now appear on search results.
**FRs covered:** FR8, FR17, FR18, FR19, FR20, FR21, FR22, FR23, FR24, FR26
**Scope clarification:** Booking service with price check via supplier adapter, Expedia B2B compliance display (cancellation policies, tax breakdowns, check-in instructions, SCA), wallet debit integration with idempotency, multi-room booking, booking confirmation with supplier + Apolles reference numbers, audit trail entries. FR8 activates wallet indicators on search results now that wallet exists.

### Epic 5: Booking Management & Vouchers
Agents can view, filter, manage, cancel, and modify bookings. Agents can generate vouchers (single + batch), download voucher PDFs, and view the full booking audit trail. Voucher generation is the commitment boundary that stops the auto-cancel timer.
**FRs covered:** FR27, FR28, FR29, FR30, FR31, FR32, FR33, FR37
**Scope clarification:** Booking list with search/filter/sort, booking detail view with role-based price visibility, cancellation with penalty display and confirmation gate, modification request routing (check supplier support, execute or redirect), voucher generation as status transition, batch voucher queue (up to 20), voucher PDF via @react-pdf/renderer, chronological audit trail UI.

### Epic 6: Auto-Cancellation System
Unvouchered bookings are automatically cancelled before the free cancellation deadline with a configurable safety buffer. Agents receive warnings at 48h and 24h. Failed cancellations retry and escalate to admin. 99.9% reliability target.
**FRs covered:** FR34, FR35, FR36
**Scope clarification:** Inngest/Trigger.dev job with retry, dead-letter, and observability. SSE-powered countdown on booking cards. Email + in-app warnings at 48h and 24h. All deadlines normalized to UTC with safety buffer. Admin escalation on repeated failure. Depends on bookings and voucher status existing (Epics 4-5).

### Epic 7: Quote & Itinerary Builder
Agents can build multi-city quotes from search results with 1-click hotel addition, organize hotel options per city, add notes, generate branded PDF quotes, and share with clients via email or download.
**FRs covered:** FR11, FR12, FR13, FR14, FR15, FR16
**Scope clarification:** Quote builder with server-side state persistence, 1-click "Add to Quote" from search results (no modal), multi-city organization (up to 10 cities, 2-4 hotels per city), notes per city/hotel, quote PDF via @react-pdf/renderer with agent branding (logo, colors from profile), role-based price visibility (client price only, no supplier/markup info). Can begin after Epic 2 (search results exist to add to quotes).

### Epic 8: HCN Verification
The system automatically sends HCN verification emails after booking confirmation. Agents can monitor HCN status per reservation, resend emails, update status manually, customize email templates, and view a dashboard of pending verifications.
**FRs covered:** FR38, FR39, FR40, FR41, FR42, FR43, FR44
**Scope clarification:** Email service integration, HCN status state machine (Available / Waiting / Email Sent / Confirmed / Mismatch / Issue), SSE push for status updates, template editor with preview (system fields non-removable), configurable sending email address, HCN pending dashboard. Requires bookings to exist (Epic 4).

### Epic 9: Agent Settings & Customization
Agents can configure quote branding (template, colors, header/footer, disclaimer), set default markup percentage, and manage notification preferences for all alert types.
**FRs covered:** FR59, FR60
**Scope clarification:** Quote template selector with live preview, brand color picker, header/footer/disclaimer editing, default markup percentage setting (calls Epic 3 markup engine), notification toggles for auto-cancel warnings, HCN updates, booking confirmations, and wallet alerts. Enhances personalization on top of quote (Epic 7) and HCN (Epic 8) features.

### Epic 10: Platform Administration
Platform owner can monitor the entire platform: supplier API health, hotel mapping management, booking investigation across all agents, agent account management, auto-cancel escalation handling, booking status overrides, and supplier issue tracking.
**FRs covered:** FR65, FR66, FR67, FR68, FR69, FR70, FR71, FR72
**Scope clarification:** Admin dashboard with platform-wide metrics, supplier health dashboard from supplier_api_logs table with alerting thresholds, hotel mapping management UI (review/confirm/reject/override), cross-tenant booking investigation, auto-cancel failure management, agent account overview, booking status override with mandatory audit reason, supplier issue escalation with resolution tracking. Can begin after Epic 5 (bookings and management exist).

### Epic 11: Agency & Team Features (Fast-Follow)
Super agents can invite and manage sub-agents, configure permissions, set agency markup, and view team activity. Sub-agents can set personal markup and request wallet top-ups when blocked by insufficient credit.
**FRs covered:** FR25, FR25b, FR52, FR53, FR54 (multi-layer), FR61, FR62, FR63
**Scope clarification:** All fast-follow features consolidated. RBAC enforcement already built (Epic 1), tenant scoping already in database (Epic 1). This epic activates multi-agent/agency features on the existing foundation: sub-agent invitation, permission configuration, agency-level markup, sub-agent personal markup, multi-layer markup calculation, wallet top-up request/approval workflow, sub-agent activity feed. Builds on all previous epics.

### Dependency Flow

```
Epic 1 (Foundation + Auth) ─────────────────────────────────────
  ├── Epic 2 (Search) ──────────────────────────────────────────
  │     ├── Epic 3 (Wallet) ────────────────────────────────────
  │     │     └── Epic 4 (Booking) ─────────────────────────────
  │     │           ├── Epic 5 (Booking Mgmt) ──────────────────
  │     │           │     ├── Epic 6 (Auto-Cancel) ─────────────
  │     │           │     └── Epic 10 (Admin) ──────────────────
  │     │           └── Epic 8 (HCN) ──────────────────────────
  │     └── Epic 7 (Quotes) ───────────────────────────────────
  │           └── Epic 9 (Settings) ────────────────────────────
  └── Epic 11 (Agency — Fast-Follow) ──────────────────────────
```

Each epic is standalone — it delivers complete user value without requiring future epics.

## Epic 1: Project Foundation & Agent Authentication

Agents can register, log in, manage their profile, and access a secure authenticated workspace. Platform infrastructure is initialized.

### Story 1.1: Initialize Apolles Workspace and Deploy Baseline App

As a **developer**,
I want the Apolles project scaffolded with create-t3-app and deployed to Vercel with working CI,
So that all subsequent development starts from a consistent, deployable foundation.

**Acceptance Criteria:**

**Given** the create-t3-app command is run with App Router, Tailwind, Prisma, NextAuth, and PostgreSQL options
**When** the project is initialized and pushed to GitHub
**Then** the app builds and runs locally without errors
**And** Vercel deployment produces a working preview environment
**And** GitHub Actions CI pipeline runs lint and type-check on every PR
**And** Redis client is configured in `src/lib/redis.ts` using Upstash
**And** `@t3-oss/env-nextjs` validates all required environment variables at build time
**And** `.env.example` documents every required variable
**And** structured JSON logger is implemented in `src/lib/logger.ts`
**And** error factory with typed error codes is implemented in `src/lib/errors.ts`
**And** the PR template includes the architecture enforcement checklist

### Story 1.2: Create Auth-Ready Data Foundation

As a **developer**,
I want the foundational Prisma schema with User, Session, Account, and Agency models with tenant-scoping columns,
So that authentication, authorization, and all future data models build on a consistent multi-tenant foundation.

**Acceptance Criteria:**

**Given** the Prisma schema is created
**When** migrations are run
**Then** User model exists with fields for email, name, passwordHash, role (enum: AGENT, SUPER_AGENT, PLATFORM_OWNER), agencyId (nullable), and timestamps
**And** Account and Session models exist per NextAuth Prisma adapter requirements
**And** Agency model exists with id, name, and timestamps
**And** Role enum uses SCREAMING_SNAKE values per naming conventions
**And** all tenant-sensitive models include agentId and/or agencyId columns
**And** Prisma Migrate generates and applies the initial migration successfully
**And** a seed script creates test data: one platform owner account, one agent account, one agency with a member
**And** Prisma client singleton is configured in `src/lib/db.ts`

### Story 1.3: Agent Registration with Secure Password Policy

As an **agent**,
I want to register an account with my email, password, and basic company information,
So that I can access the Apolles platform.

**Acceptance Criteria:**

**Given** I am on the registration page
**When** I submit a valid email, password, and company name
**Then** my account is created with role AGENT
**And** my password is hashed using industry-standard one-way hashing with appropriate computational cost
**And** password complexity is enforced: 12+ characters, at least one uppercase, one lowercase, one digit, and one special character (NFR12)
**And** password is checked against common breach lists and rejected if found
**And** I am redirected to the login page with a success message
**Given** I submit an email that already exists
**When** the registration is processed
**Then** I see a clear error message that the email is already registered
**And** all input is validated with Zod schemas on both client and server
**And** form validates on blur and shows errors at field level per UX spec
**And** registration event is logged in structured log format

### Story 1.4: Agent Login, Logout & Secure Session Management

As an **agent**,
I want to log in with my email and password, maintain a secure session, and log out,
So that I can securely access my workspace across visits.

**Acceptance Criteria:**

**Given** I have a registered account
**When** I submit valid credentials on the login page
**Then** a database session is created via NextAuth with Prisma adapter
**And** session cookie is set with HttpOnly, Secure, SameSite=Strict flags (NFR13)
**And** I am redirected to the dashboard
**Given** I submit invalid credentials
**When** the login is processed
**Then** I see a generic error message that does not reveal which field was wrong
**Given** I have been inactive for 30 minutes
**When** I attempt any action
**Then** my session has expired and I am redirected to login
**Given** I already have 3 active sessions
**When** I log in on a new device
**Then** the oldest session is invalidated automatically (NFR13)
**When** I click logout
**Then** my database session is deleted and I am redirected to the login page

### Story 1.5: Password Reset with Token Expiry and Session Invalidation

As an **agent**,
I want to reset my password via email if I forget it,
So that I can regain access to my account without contacting support.

**Acceptance Criteria:**

**Given** I am on the login page and click "Forgot Password"
**When** I enter my email address and submit
**Then** a password reset email is sent with a secure, time-limited token (expires after 1 hour)
**And** the same success message is shown whether or not the email exists (no email enumeration)
**Given** I follow a valid reset link
**When** I enter a new password meeting all complexity requirements
**Then** my password is updated
**And** all existing sessions for my account are invalidated
**And** I am redirected to login with a success message
**Given** I follow an expired or already-used reset link
**When** I attempt to reset
**Then** I see a clear error that the link is no longer valid with an option to request a new one

### Story 1.6: Authenticated Dashboard Shell with Responsive Navigation

As an **agent**,
I want to see an authenticated dashboard with sidebar navigation and responsive layout,
So that I have a central workspace to access all platform features.

**Acceptance Criteria:**

**Given** I am logged in
**When** I access the dashboard
**Then** I see a sidebar with navigation items: Search, Bookings, Quotes, Wallet, HCN, Settings
**And** the sidebar is collapsible (240px expanded, 64px icon-only) with collapse state persisted in localStorage
**And** the active navigation item shows primary color text with a left accent bar
**And** my name and role are displayed in the sidebar
**Given** I am on a viewport below the md breakpoint (768px)
**When** the layout renders
**Then** the sidebar is replaced by a 5-item bottom navigation bar (Search, Bookings, Quotes, Wallet, More)
**And** all pages within the (dashboard) route group require authentication — unauthenticated access redirects to login
**And** Next.js middleware handles auth redirect and resolves tenant context from session
**And** skip-to-content link is visible on first Tab press, bypassing sidebar
**And** focus indicators (2px primary outline, 2px offset) are present on all interactive elements (WCAG 2.1 AA)
**And** semantic HTML landmarks are used: header, nav, main, aside
**And** page loads in under 2 seconds (NFR7)

### Story 1.7: Agent Profile Edit and Logo Upload with Preview

As an **agent**,
I want to edit my profile details and upload my company logo with immediate preview,
So that my business information is accurate and my branding is ready for quotes and vouchers.

**Acceptance Criteria:**

**Given** I am logged in and navigate to Settings > Profile
**When** I edit my profile fields (business name, contact info, address, tax ID)
**Then** changes are saved and confirmed with a success toast (auto-dismiss 4s)
**And** all fields are validated with Zod schemas on client and server
**And** form validates on blur, shows errors at field level, and clears errors on correction
**Given** I upload a company logo image
**When** the upload completes
**Then** I see an immediate preview of the logo
**And** the logo is persisted and available for quote PDFs and vouchers
**And** only image file types (PNG, JPG, SVG) are accepted with a maximum file size of 2MB
**And** uploading an invalid file shows a clear error message
**And** profile changes are logged in the audit trail with actor and timestamp

### Story 1.8: Centralized Authorization Guard for Role and Tenant Scope

As the **platform**,
I want a centralized authorization module that checks both role permissions and tenant data scope on every protected operation,
So that no data leaks across tenants and no user exceeds their role's permissions.

**Acceptance Criteria:**

**Given** the `authorize()` function exists in `src/features/auth/authorize.ts`
**When** a protected Server Action is called
**Then** the precondition sequence is enforced: resolve session → authorize → validate input → execute
**And** AGENT role queries are scoped to their own agentId only
**And** SUPER_AGENT role queries are scoped to their agencyId (own data + sub-agents)
**And** PLATFORM_OWNER role can access data across all tenants
**And** an unauthorized request returns a 403 error with the typed error code PERMISSION_DENIED
**And** authorization failures are logged in the audit trail with actorId, attempted action, and target entity
**And** the authorize function has co-located unit tests covering all role + scope combinations
**And** the audit trail insert helper is implemented in `src/lib/audit.ts` with the append-only pattern

### Story 1.9: Enforce Supplier Visibility Restriction

As the **platform**,
I want supplier identity (supplier name, API source metadata) hidden from all agent roles and visible only to the platform owner,
So that agents cannot identify which supplier provides a given rate, preserving the platform's aggregation value.

**Acceptance Criteria:**

**Given** a search result or booking record contains supplier identity fields
**When** an AGENT or SUPER_AGENT requests the data via any Server Action or API endpoint
**Then** supplier name, supplier ID, and API metadata are stripped from the response before it reaches the client
**And** the stripping happens at the service layer (not just UI-hidden) so direct API calls also return sanitized data (NFR14)
**Given** a PLATFORM_OWNER requests the same data
**When** the authorization check passes
**Then** supplier identity fields are included in the response
**And** this behavior is covered by integration tests that verify the response shape per role

## Epic 2: Hotel Search & Discovery

Agents can search for hotels across multiple suppliers and view deduplicated, comparable results with room details, rate comparison, filtering, and sorting. Progressive loading shows results as suppliers respond.

### Story 2.1: Supplier Adapter Contract and Normalized Data Model

As a **developer**,
I want a unified supplier adapter interface with normalized data model schemas and a shared contract test suite,
So that all current and future supplier integrations implement a consistent contract.

**Acceptance Criteria:**

**Given** the `SupplierAdapter` interface is defined in `src/features/suppliers/contracts/supplier-adapter.ts`
**When** a new adapter implements it
**Then** the interface defines methods: `search()`, `priceCheck()`, `book()`, `cancel()`, `getBookingDetail()`
**And** normalized Zod schemas exist for all response types: hotel, room, rate, cancellation policy, meal plan, tax breakdown
**And** the schemas cover 100% of fields required by the PRD for search display, booking, and voucher generation
**And** a shared `adapter-contract.test.ts` suite validates any adapter's `search()` output against the normalized schemas
**And** the `supplier_api_logs` table Prisma model is created with fields: supplierId, method, requestPayload, responseSummary, latencyMs, httpStatus, timestamp
**And** a logging helper wraps all adapter calls to write to `supplier_api_logs` automatically (NFR32)
**And** typed Apolles error codes for supplier failures are defined in `src/features/suppliers/contracts/supplier-errors.ts`

### Story 2.2: Expedia Rapid API v3 Search Adapter

As a **developer**,
I want an Expedia adapter implementing the supplier interface for hotel search,
So that Expedia hotel inventory is available through the normalized contract.

**Acceptance Criteria:**

**Given** the `SupplierAdapter` interface and contract tests exist (Story 2.1)
**When** the Expedia adapter implements `search()`
**Then** it authenticates using SHA-512 signature auth per Expedia Rapid API v3 requirements
**And** search parameters (destination, dates, rooms, adults, children with ages) are mapped to Expedia's API format
**And** Expedia responses are normalized into the unified Apolles data model: hotel name, star rating, address, images, rooms with bed types, cancellation policies, meal plans, refundability, rates
**And** all bookable fields from Expedia are present in the normalized output (verified by contract test fixture set covering all known Expedia response permutations)
**And** the adapter enforces a 5-second timeout and returns a typed `SUPPLIER_TIMEOUT` error on expiry (NFR31)
**And** every API call is logged to `supplier_api_logs` via the shared logging helper (NFR32)
**And** Expedia-specific errors are translated to Apolles typed error codes — raw Expedia errors never reach the service layer
**And** the adapter passes the shared `adapter-contract.test.ts` suite
**And** co-located unit tests cover: successful search, timeout, auth failure, malformed response

### Story 2.3: TBO Holidays API v1.4 Search Adapter

As a **developer**,
I want a TBO adapter implementing the same supplier interface for hotel search,
So that TBO hotel inventory is available through the same normalized contract as Expedia.

**Acceptance Criteria:**

**Given** the `SupplierAdapter` interface and contract tests exist (Story 2.1)
**When** the TBO adapter implements `search()`
**Then** it authenticates using Basic Auth per TBO API requirements
**And** search parameters are mapped to TBO's HotelSearch API format
**And** TBO responses are normalized into the same unified Apolles data model as Expedia
**And** all bookable fields from TBO are present in the normalized output (verified by contract test fixture set)
**And** the adapter enforces a 5-second timeout and returns `SUPPLIER_TIMEOUT` on expiry (NFR31)
**And** every API call is logged to `supplier_api_logs` (NFR32)
**And** TBO-specific errors are translated to Apolles typed error codes
**And** the adapter passes the same `adapter-contract.test.ts` suite with zero modifications to the suite or interface (NFR26)
**And** co-located unit tests cover: successful search, timeout, auth failure, malformed response

### Story 2.4: Circuit Breaker and Supplier Health Tracking

As the **platform**,
I want a circuit breaker that stops calling a consistently failing supplier and recovers automatically,
So that one degraded supplier does not slow down or break the search experience for other suppliers.

**Acceptance Criteria:**

**Given** a supplier adapter is called repeatedly
**When** consecutive failures exceed the configured threshold (default: 5)
**Then** the circuit opens and subsequent calls to that supplier return a typed `SUPPLIER_CIRCUIT_OPEN` error immediately without making API calls
**And** circuit state (open/closed/half-open, failure count, last failure timestamp) is stored in Redis per supplier
**And** after a configurable cooldown period (default: 30 seconds), the circuit enters half-open state
**Given** the circuit is half-open
**When** the next call is made
**Then** exactly one probe request is sent to the supplier
**And** if the probe succeeds, the circuit closes and normal operation resumes
**And** if the probe fails, the circuit re-opens for another cooldown period
**And** all circuit state transitions are logged at info level with supplier identifier and transition reason
**And** no single supplier failure degrades response times for other suppliers or platform features (NFR31)
**And** the circuit breaker has co-located unit tests covering: threshold breach → open, cooldown → half-open, probe success → close, probe fail → re-open

### Story 2.5: Supplier Orchestrator with Parallel Search

As a **developer**,
I want an orchestrator that calls all active supplier adapters in parallel, aggregates results, and handles partial failures,
So that search results include inventory from all responsive suppliers within the performance budget.

**Acceptance Criteria:**

**Given** the orchestrator receives a search request
**When** it dispatches to all active adapters in parallel
**Then** combined results from all responsive suppliers are aggregated within 5 seconds for p95 queries (NFR1)
**And** if one adapter times out or is circuit-broken, results from responsive adapters are returned without delay
**And** the orchestrator returns a metadata object indicating per-supplier status: `responded`, `timed_out`, `circuit_open`, `error`
**And** the orchestrator never waits for a slow supplier beyond the 5-second budget — it returns what it has
**And** the orchestrator has co-located tests covering: all succeed, one timeout, one circuit-open, all fail
**Precondition:** Stories 2.1–2.4 (adapter contract, both adapters, circuit breaker) are complete.

### Story 2.6: SSE Progressive Result Delivery and Supplier Fallback UX

As an **agent**,
I want to see search results appear progressively as each supplier responds, with clear status when a supplier is unavailable,
So that I get fast initial results without waiting for all suppliers.

**Acceptance Criteria:**

**Given** I submit a hotel search
**When** the first supplier responds
**Then** its results are streamed to the client via SSE within 2 seconds of search submission (NFR2)
**And** the search page header shows "Searching [X] suppliers..." with a count that updates as responses arrive
**And** skeleton loading appears immediately on search submission — the page is never blank
**When** additional suppliers respond
**Then** their results are appended to the existing results via SSE without replacing or re-rendering existing cards
**Given** one supplier times out or is circuit-broken
**When** results from responsive suppliers are displayed
**Then** an inline message (not toast, not modal) identifies which supplier(s) are unavailable
**And** a "Retry" action is available for each failed supplier (FR9)
**Given** all suppliers fail
**When** no results are available
**Then** the UI renders an error-state component within 1 second containing a retry action and supplier status details — no blank screen (NFR22)
**And** the SSE endpoint runs as a Vercel Edge Function for extended streaming duration
**Precondition:** Story 2.5 (orchestrator) is complete.

### Story 2.7: Vervotech Mapping Data Sync Job

As the **platform**,
I want hotel mapping data from Vervotech synchronized to Redis at least once every 24 hours,
So that cross-supplier deduplication uses up-to-date mapping data.

**Acceptance Criteria:**

**Given** the mapping sync job is configured as a Vercel Cron Job
**When** the scheduled sync runs
**Then** incremental mapping updates are fetched from the Vervotech API
**And** the Redis hotel mapping cache is updated with new and changed mappings
**And** sync completion is logged at info level with record count, duration, and new/updated/unchanged counts
**And** sync failure is logged at error level and triggers a Medium-priority alert (NFR23)
**And** the sync runs at least once per 24 hours (NFR34)
**And** the job has co-located tests covering: full sync success, incremental update, API failure with retry, partial failure

### Story 2.8: Hotel Mapping and Cross-Supplier Deduplication

As an **agent**,
I want search results from different suppliers for the same physical hotel merged into one result,
So that I see one entry per hotel with rates from each supplier side by side.

**Acceptance Criteria:**

**Given** search results arrive from multiple suppliers
**When** the mapping service processes results using Vervotech data cached in Redis
**Then** results for the same physical hotel (matched by Vervotech canonical ID) are merged into a single hotel entry with rates from each supplier
**And** mapping lookups across 2M+ records complete in under 500ms p95 (NFR27, NFR9)
**And** each merged hotel entry has exactly one rate marked `isCheapest: true` determined by: lowest total price, then refundability preference, then supplier priority as tiebreaker
**And** low-confidence mapping matches (below configurable confidence threshold) are returned as separate entries rather than merged (FR4)
**And** supplier identity fields are not included in the merged output (handled by authorization layer, Story 1.9)
**And** the mapping service has co-located tests covering: confident merge, low-confidence separation, single-supplier result (no merge needed), cache-miss fallback, cheapest-rate selection with ties
**Precondition:** Story 2.7 (mapping sync) is complete so mapping data exists in Redis.

### Story 2.9: Search Form with Destination Autocomplete

As an **agent**,
I want to search for hotels by destination, dates, rooms, and guest details using an intuitive search form,
So that I can quickly find relevant hotel options for my client.

**Acceptance Criteria:**

**Given** I am on the search page
**When** I type in the destination field
**Then** autocomplete suggestions appear, debounced at 300ms
**And** I can enter check-in/check-out dates, number of rooms (1-9), adults per room, and children with ages (FR1)
**And** the form layout is horizontal on desktop, wraps to 2 rows on tablet, vertical stack on mobile
**And** the search button triggers search deliberately — no auto-search on field change
**And** Enter key in any field triggers search
**And** last 5 searches are stored in localStorage and shown as quick-access chips below the form
**And** clicking a search chip pre-fills all fields and auto-triggers search
**And** all inputs are validated with Zod before submission — invalid fields show errors on blur
**And** scroll-to-first-error on submit with focus on the first invalid field
**And** room configuration uses `aria-label="Room [N]: [X] adults, [Y] children"`
**And** form fields meet 44px touch target on mobile, 36px on desktop

### Story 2.10: Search Result Cards with Accessibility

As an **agent**,
I want to see hotel search results as cards with key information at a glance,
So that I can quickly scan and compare options for my client.

**Acceptance Criteria:**

**Given** search results are loaded (from SSE stream)
**When** the results page renders
**Then** each hotel is displayed as a card showing: hotel name, star rating, primary image, starting price, cancellation summary (refundable/non-refundable)
**And** the card showing cheapest rate renders a visual highlight on the rate marked `isCheapest: true` from the data — no client-side price recomputation (FR5)
**And** each card is an `<article>` with `aria-label="[Hotel Name], [Star Rating] stars, from $[Price]"`
**And** hotel images use `next/image` with WebP/AVIF auto-negotiation, `sizes` attribute matching grid columns, and lazy loading for below-fold
**And** prices and booking references use monospace font (JetBrains Mono)
**And** results grid is: 1-col at sm, 2-col at md, 3-col at xl, 4-col at 2xl
**And** keyboard navigation: Tab cycles through cards, Enter opens detail
**And** page loads in under 2 seconds for cached results (NFR7)

### Story 2.11: Room Details Panel and Rate Comparison

As an **agent**,
I want to expand a hotel card to see room-level details and compare rates across suppliers,
So that I can evaluate the best option before adding to a quote or booking.

**Acceptance Criteria:**

**Given** I am viewing search results
**When** I click "More Rooms" on a hotel card
**Then** a detail panel opens (new panel, not inline or modal) showing all available rooms for that hotel
**And** each room shows: bed type(s), cancellation policy details, meal plan, refundability status (FR6)
**And** if the hotel has rates from multiple suppliers, a rate comparison table is displayed with the cheapest rate highlighted (FR5)
**And** sortable columns in the rate table use `aria-sort` attribute
**And** platform owner sees supplier name per rate row; agents see rates without supplier identity (FR10, enforced by service layer)
**And** the panel is keyboard-accessible: Tab cycles through rows, Escape closes the panel

### Story 2.12: Client-Side Filtering and Sorting

As an **agent**,
I want to filter and sort search results by price, star rating, cancellation policy, and other attributes,
So that I can quickly narrow down the best options for my client.

**Acceptance Criteria:**

**Given** search results are displayed
**When** I apply filters (price range, star rating, cancellation policy, meal plan, refundability)
**Then** results are filtered instantly on the client side with zero API calls
**And** active filters are shown as removable chips above results
**And** a "Clear all filters" link appears when any filter is active
**And** the visible result count updates in real-time as filters change (FR7)
**When** I select a sort option (price low-to-high, price high-to-low, star rating, name)
**Then** results re-sort instantly on the client side
**And** sortable column headers use `aria-sort` attribute
**And** filter panel is expanded by default on desktop, collapsed on mobile
**And** when results exceed 50 hotels, virtualized rendering is used (@tanstack/react-virtual) to maintain scroll performance
**And** back navigation (browser back button or in-app back) preserves exact filter state, sort state, and scroll position

## Epic 3: Wallet & Financial Operations

Agents can view their wallet balance, top up via Stripe, view transaction history, generate PDF invoices, and set their markup percentage. Platform owner can set platform markup. All financial operations are atomic, idempotent, and fully audited.

### Story 3.1: Wallet Data Model and Balance Service

As an **agent**,
I want a wallet with a visible balance that accurately reflects my financial position,
So that I know how much credit I have available for bookings.

**Acceptance Criteria:**

**Given** Wallet and WalletTransaction Prisma models are created
**When** I view the wallet page
**Then** my current balance is displayed using monospace font (FR45)
**And** the Wallet model includes: agentId, balance (Decimal), currency, updatedAt
**And** the WalletTransaction model includes: walletId, type (enum: TOP_UP, DEBIT, REFUND, ADJUSTMENT), amount, balanceAfter, referenceType, referenceId, idempotencyKey, createdAt
**And** the WalletTransaction table is append-only — no UPDATE or DELETE operations permitted at the DB role level (NFR15)
**And** every committed transaction row is immutable once written
**And** the wallet service reads balance via a single Prisma query scoped to my agentId (tenant-scoped)
**And** the wallet page shows an empty state with "Top up your wallet" action if balance is zero
**And** page loads in under 2 seconds (NFR7)

### Story 3.2: Wallet Top-Up via Stripe (SAQ-A)

As an **agent**,
I want to top up my wallet using my credit card via a secure hosted payment page,
So that I can add credit to fund future bookings.

**Acceptance Criteria:**

**Given** I am on the wallet page and click "Top Up"
**When** I enter a top-up amount and confirm
**Then** I am redirected to the Stripe hosted payment page (SAQ-A — no card data touches Apolles) (NFR10)
**And** a Stripe Checkout session is created server-side with the top-up amount
**Given** the Stripe webhook `checkout.session.completed` is received
**When** the webhook signature is verified against the Stripe signing secret
**Then** the wallet balance is updated atomically using `SELECT ... FOR UPDATE` within a Prisma interactive transaction
**And** a WalletTransaction record of type TOP_UP is created with idempotencyKey matching the Stripe session ID
**Given** the same webhook is delivered more than once (duplicate delivery)
**When** the idempotency key is checked
**Then** no second credit is created — the original result is returned (NFR24)
**Given** a European card requires SCA / 3D Secure challenge
**When** the payment is challenged on the Stripe hosted page
**Then** the top-up completes only after successful SCA outcome (NFR18) — Stripe handles the challenge flow entirely
**And** the top-up event is recorded in the immutable audit trail (NFR15)
**And** a success toast confirms the top-up amount when the agent returns to the wallet page
**Given** the Stripe payment fails or is cancelled
**When** the agent returns to the wallet page
**Then** balance is unchanged and an error message explains the failure
**Scope note:** Recurring tokenized top-ups (NFR36) are deferred to post-MVP. Manual top-up via Stripe Checkout is sufficient at launch.

### Story 3.3: Atomic Wallet Reservation, Debit and Release

As the **platform**,
I want wallet operations to follow a reserve → confirm/release pattern with row-level locking and idempotency,
So that concurrent bookings cannot cause double-spending and failed bookings always release reserved funds.

**Acceptance Criteria:**

**Given** a booking requires a wallet charge of amount X
**When** the wallet service reserves the amount
**Then** the operation uses `SELECT ... FOR UPDATE` on the wallet row within a Prisma interactive transaction
**And** if balance is sufficient, the amount is reserved (balance decremented) and a WalletTransaction of type DEBIT is created with status RESERVED
**And** if balance is insufficient, the transaction is rolled back and a `WALLET_INSUFFICIENT` error is returned with details: required amount and available balance
**Given** the supplier booking succeeds
**When** the reservation is confirmed
**Then** the DEBIT transaction status is updated to CONFIRMED
**Given** the supplier booking fails after reservation
**When** the release is triggered
**Then** the reserved amount is fully returned to the wallet balance
**And** a WalletTransaction of type REFUND is created
**And** the final balance equals the pre-attempt balance
**Given** the same idempotency key is replayed
**When** the request repeats
**Then** the original result is returned with no additional ledger mutation
**Given** two concurrent booking attempts target the same wallet with insufficient funds for both
**When** both execute simultaneously
**Then** exactly one reservation succeeds and the other fails with `WALLET_INSUFFICIENT` — no double-debit occurs (NFR24)
**And** every wallet operation is recorded in the immutable audit trail with actor, amount, balanceAfter, and booking reference (NFR15)
**And** co-located tests cover: successful reserve+confirm, reserve+release on failure, insufficient balance, idempotent replay, concurrent access safety

### Story 3.4: Transaction History

As an **agent**,
I want to view my full wallet transaction history with filtering,
So that I can track all charges, top-ups, and refunds.

**Acceptance Criteria:**

**Given** I am on the wallet page
**When** I view the transaction history section
**Then** I see a chronological list of all transactions: top-ups, debits, refunds, adjustments (FR48)
**And** each entry shows: date, type, amount (positive/negative), balance after, reference (booking ID or top-up ID)
**And** transactions are displayed in a data table with sticky header, alternating row colors, and entire row clickable to detail
**And** I can filter by transaction type and date range
**And** the table transforms to a card-based list on mobile viewports
**And** pagination shows "Showing 1-25 of N" with page buttons and rows-per-page selector (25, 50, 100)
**And** dates display as "Mar 10, 2026" format; recent transactions show relative time ("2 hours ago")
**And** amounts use monospace font

### Story 3.5: Platform Markup Configuration

As the **platform owner**,
I want to set a platform-wide markup percentage applied to all supplier rates,
So that the platform earns margin on every booking.

**Acceptance Criteria:**

**Given** I am logged in as PLATFORM_OWNER and navigate to markup settings
**When** I set a platform markup percentage (0-100%, 0.1% increments)
**Then** the markup is saved and applies to all supplier rates across the platform (FR51)
**And** the centralized markup service in `src/features/markup/markup-service.ts` applies the percentage to the supplier cost price
**And** the calculation rounds to 2 decimal places using half-up rounding (FR54)
**And** the same markup service is used by all consumers: search results display, booking price check, quote PDF, voucher PDF, invoice generation — one source of truth
**And** the markup service is a pure function with co-located unit tests covering: zero markup, typical markup, edge cases (0.1%, 100%), rounding precision verified to the cent
**And** markup changes are logged in the audit trail

### Story 3.6: Agent Markup Configuration

As an **agent**,
I want to set my own markup percentage on top of my visible cost,
So that I can earn margin on the rates I present to my clients.

**Acceptance Criteria:**

**Given** I am logged in as AGENT and navigate to markup settings
**When** I set my markup percentage (0-100%, 0.1% increments)
**Then** the markup is saved to my profile and applies to all rates I see as "my cost" (FR50)
**And** the calculation uses the same centralized markup service as platform markup — one engine, consistent rounding
**And** at MVP (single-layer): final client price = supplier cost × (1 + platform markup%) × (1 + agent markup%), rounded to 2 decimal places at each step (FR54)
**And** the result is consistent across search results, booking confirmation, quote PDF, and invoice — all surfaces call the same markup service
**And** markup changes are logged in the audit trail

### Story 3.7: PDF Invoice Generation

As an **agent**,
I want to generate a PDF invoice for any booking or wallet top-up transaction,
So that I have professional financial documents for my business records and tax compliance.

**Acceptance Criteria:**

**Given** I am viewing a completed booking or wallet top-up in my transaction history
**When** I click "Generate Invoice"
**Then** a PDF invoice is generated server-side using `@react-pdf/renderer` within 5 seconds (NFR5)
**And** the invoice includes: agent business details (from profile), transaction date, booking reference (if applicable), hotel name and dates (if applicable), total amount, applicable taxes, payment method (FR49)
**And** invoices are sequentially numbered per agent (agent-scoped sequence) with a unique DB constraint preventing duplicates
**And** the generated invoice is stored and retrievable for 7 years per tax compliance requirements
**And** stored invoices are immutable — once generated, the PDF and metadata cannot be modified
**And** the PDF displays only the agent's client price — no supplier cost, no platform markup, no internal pricing
**And** I can download the PDF or view it in a preview pane
**And** invoice generation is logged in the audit trail

## Epic 4: Booking Flow

Agents can select a room from search results, complete a booking with real-time price check, enter guest details, and receive a confirmed booking. Wallet-gated enforcement prevents bookings beyond the agent's balance. Wallet credit indicators now appear on search results.

### Story 4.1: Wallet Credit Indicators on Search Results

As an **agent**,
I want to see which hotel rates require wallet credit I don't have,
So that I can focus on options I can actually book without delays.

**Acceptance Criteria:**

**Given** search results are displayed and my wallet balance is known
**When** a rate's penalty amount (normalized, post-tax, in booking currency) exceeds my available wallet balance
**Then** a visual indicator flags the rate as requiring more wallet credit (FR8)
**And** the indicator shows the shortfall amount
**And** free-cancellation rates are never flagged regardless of balance
**And** the wallet balance is fetched once per search session, not per card render
**And** the indicator updates if I top up my wallet during the same session (via SSE wallet balance update)

### Story 4.2: Room Selection and Booking Initiation

As an **agent**,
I want to select a specific room and rate from search results and proceed to booking,
So that I can start the booking process for my client.

**Acceptance Criteria:**

**Given** I am viewing room details for a hotel (from search results)
**When** I click "Book" on a specific room/rate
**Then** I am taken to the booking form pre-populated with the selected hotel, room, rate, and a snapshot of the search result data (FR17)
**And** the booking form displays: hotel name, room type, rate, cancellation policy, check-in/check-out dates
**And** Expedia B2B required disclosures are rendered when booking an Expedia rate: cancellation policy text, tax breakdown with legally mandated text, payment processing country (FR21)
**And** if the rate is non-refundable/penalized, the wallet impact section is visible showing: penalty amount, current wallet balance, and shortfall (if any)
**And** the form follows the confirmation gate pattern for high-stakes actions per UX spec
**And** adapter failures during form load result in one of two states: `RETRYABLE_ERROR` (with "Retry" button and preserved selections) or `NON_RETRYABLE_ERROR` (with explanation and "Back to Search" action)

### Story 4.3: Price Check and Pre-Book Validation

As an **agent**,
I want the system to verify the current price with the supplier before I confirm a booking,
So that I am not surprised by price changes between search and booking.

**Acceptance Criteria:**

**Given** I have selected a room and initiated booking
**When** the booking form loads
**Then** the system performs a price check / pre-book validation with the supplier via the adapter's `priceCheck()` method (FR18)
**And** price check server response time meets p95 <= 3 seconds (NFR3)
**And** if the supplier does not respond within 6 seconds, the client shows a timeout state with a "Retry" action
**Given** the price has not changed
**When** the validation returns
**Then** the booking form is ready for guest details with the confirmed price
**Given** the price or penalty basis has changed
**When** the validation returns
**Then** the system displays old and new amounts with the change clearly stated, and blocks progression until the agent chooses [Continue at new price] or [Cancel] (FR19)
**And** the agent's explicit acknowledgment is required before proceeding
**And** the price check result and any repricing event are logged in the booking audit trail
**And** a `price_check_latency_ms` metric is emitted for observability

### Story 4.4: Guest Details Entry and Validation

As an **agent**,
I want to enter guest details for the booking with clear validation,
So that the reservation has accurate guest information.

**Acceptance Criteria:**

**Given** the price check has passed (or the agent acknowledged a repricing)
**When** I am on the guest details section of the booking form
**Then** I can enter: full name, email, phone number (required), and special requests (optional, max 500 characters) (FR20)
**And** all required fields are validated with Zod on blur and on submit
**And** scroll-to-first-error on submit with focus on the first invalid field per UX spec
**And** Expedia downstream agent T&C acceptance checkbox is displayed when booking an Expedia rate (FR21)
**And** check-in instructions are displayed per Expedia compliance requirements (FR21)
**And** SCA compliance information is displayed where applicable (FR21)
**And** form data is preserved if an error occurs during submission — the agent does not re-enter details
**And** for multi-room bookings, separate guest detail fields are shown per room

### Story 4.5: Booking Submission and Supplier Confirmation

As an **agent**,
I want to submit the booking and receive a confirmed reservation,
So that I have a committed booking with the supplier.

**Acceptance Criteria:**

**Given** guest details are valid and I click "Confirm Booking"
**When** the booking is submitted
**Then** the submission calls the adapter's `book()` method with an idempotency key (client_request_id) tied to the booking attempt
**And** booking end-to-end response time meets p95 <= 10 seconds (NFR4)
**And** if the supplier does not respond within 12 seconds, the booking transitions to PENDING status and the UI shows a non-blocking status indicator with SSE updates for resolution
**Given** a duplicate submission with the same idempotency key
**When** the request is replayed
**Then** the original booking outcome is returned without creating an additional supplier reservation
**And** all adapter failures during submission map to explicit user states: `RETRYABLE_ERROR` (with "Retry" button and all form data preserved) or `NON_RETRYABLE_ERROR` (with explanation, supplier error code, and "Back to Search" action)
**And** SSE preferred for async status updates; fallback polling every 5 seconds until terminal state (CONFIRMED, FAILED, or CANCELLED) if SSE connection drops
**And** a `booking_submit_latency_ms` metric is emitted for observability
**And** structured error events include supplier error code and correlation_id

### Story 4.6: Wallet-Gated Booking Enforcement

As the **platform**,
I want non-refundable/penalized bookings blocked when wallet balance is insufficient, and free-cancellation bookings allowed regardless of balance,
So that agents are protected from penalties they cannot cover.

**Acceptance Criteria:**

**Given** I attempt to book a non-refundable or penalized rate
**When** wallet sufficiency is evaluated
**Then** the check uses normalized penalty_amount in booking currency (post-tax, consistent with price check result)
**And** wallet sufficiency is enforced at three checkpoints: rate select (UI indicator, Story 4.1), post-price-check (server-side), and pre-book-submit (server-side) — booking allowed only if all server-side checkpoints pass (FR23)
**And** if insufficient, the booking is blocked with a `WALLET_INSUFFICIENT` error showing shortfall amount and a "Top Up" action
**And** the block is enforced server-side in the booking service, not just UI-hidden
**Given** I attempt to book a free-cancellation rate
**When** my wallet balance is any amount (including zero)
**Then** the booking proceeds without wallet check (FR24)
**Given** I book a penalized rate with sufficient wallet balance
**When** the booking is confirmed by the supplier
**Then** the wallet reservation is created via Epic 3's reserve flow with idempotency key tied to the booking ID
**And** if the supplier confirms, the reservation is finalized (confirmed)
**And** if the supplier rejects, the reserved amount is released back to my wallet and the final balance equals the pre-attempt balance
**And** the wallet operation is recorded in the audit trail (NFR15)
**And** wallet reserve/finalize/release executes within a single atomic transaction boundary with row-level locking; concurrent booking attempts against the same wallet cannot double-spend (NFR24)

### Story 4.7: Multi-Room Pricing and Wallet Exposure Calculation

As an **agent**,
I want multi-room bookings to correctly aggregate pricing and wallet exposure across all rooms,
So that I know the total cost and whether my wallet balance covers all penalized rooms.

**Acceptance Criteria:**

**Given** I am booking multiple rooms for the same hotel and dates
**When** the booking form calculates totals
**Then** the total booking cost is the sum of all individual room rates (FR22)
**And** wallet exposure is calculated as the sum of penalty amounts for all penalized rooms only — free-cancellation rooms do not consume wallet exposure
**And** wallet sufficiency is checked against the total penalty exposure, not the total booking cost
**And** each room's cancellation policy is displayed independently
**And** mixed cancellation policies (some rooms refundable, some not) are clearly presented with per-room exposure breakdown

### Story 4.8: Multi-Room Guest Capture and Submission

As an **agent**,
I want to enter guest details per room and submit a multi-room booking,
So that each room has the correct guest information and the booking is processed as a unit.

**Acceptance Criteria:**

**Given** I have selected multiple rooms and pricing/wallet checks have passed
**When** I fill in guest details
**Then** separate guest detail fields are shown per room with room number labels
**And** all per-room fields follow the same validation rules as single-room (Zod, blur validation, scroll-to-first-error)
**When** I click "Confirm Booking"
**Then** the booking is submitted as a single request to the supplier adapter
**And** the idempotency key covers the entire multi-room booking attempt (one key, one atomic operation)
**And** if the submission fails, all wallet reservations across all rooms are released

### Story 4.9: Booking Confirmation and Reference Generation

As an **agent**,
I want to receive a booking confirmation with supplier and Apolles reference numbers,
So that I have a clear record of the confirmed reservation.

**Acceptance Criteria:**

**Given** the supplier confirms the booking (single or multi-room)
**When** the confirmation is processed
**Then** an Apolles internal booking ID is generated atomically with a unique DB constraint (FR26)
**And** the supplier reference number is stored alongside the Apolles ID
**And** for multi-room bookings, per-room references are stored and each room has its own cancellation capability status
**And** the booking status is set to CONFIRMED
**And** the agent sees a confirmation screen with: Apolles booking ID, supplier reference, hotel name, dates, room details, total price, cancellation policy summary per room
**And** reference numbers are displayed in monospace font (JetBrains Mono)
**And** a `booking.confirmed` event is published to Redis for SSE push to the client
**And** the audit trail records: actor, action, hotel, supplier reference, amount, wallet reservation ID, previous state, new state, correlation_id, timestamp (NFR15)
**And** booking read APIs enforce role-based field filtering at the API layer; sub-agents never receive supplier-name or cost fields even via direct API calls (NFR14)
**And** SSE preferred for confirmation push; fallback polling every 5 seconds until terminal state if SSE connection drops
**And** structured log entry is created at info level

## Epic 5: Booking Management & Vouchers

Agents can view, filter, manage, cancel, and modify bookings. Agents can generate vouchers (single + batch), download voucher PDFs, and view the full booking audit trail. Voucher generation is the commitment boundary that stops the auto-cancel timer.

### Story 5.1: Booking List Page with Search, Filter, and Sort

As an **agent**,
I want to view all my bookings in a filterable, sortable list,
So that I can quickly find and manage any booking.

**Acceptance Criteria:**

**Given** I navigate to the Bookings page
**When** the page loads
**Then** I see a paginated data table of my bookings with columns: booking reference (monospace, JetBrains Mono), hotel name, guest name, check-in/check-out dates, StatusBadge (CONFIRMED/VOUCHERED/AUTO_CANCELLED/CANCELLED), voucher status, and auto-cancel countdown (if applicable) (FR27)
**And** the table loads within 2 seconds (NFR7)
**And** skeleton rows (5 rows) are shown during loading per UX spec
**And** bookings are tenant-scoped — I see only my own bookings (or agency bookings per RBAC)
**Given** I type in the search bar
**When** I enter a booking reference, hotel name, or guest name
**Then** the search queries the server across all bookings and returns paginated results; client-side filtering applies only when all results fit within a single page
**Given** I use filter dropdowns
**When** I filter by status (Confirmed, Vouchered, Auto-Cancelled, Cancelled), date range, hotel name, guest name, or voucher status
**Then** results update to match the selected filters (FR27)
**Given** I click a sortable column header
**When** I sort by date, hotel name, or status
**Then** the table re-sorts accordingly with a sort direction indicator
**Given** there are no bookings
**When** the page loads
**Then** I see the empty state: "No bookings yet. Search for hotels to make your first booking." with a "Go to Search" button
**And** each row is clickable, navigating to the booking detail page
**And** pagination shows "Showing 1-25 of N" with page controls and rows-per-page selector (25, 50, 100)
**And** on mobile, the table renders as a card list with booking reference, StatusBadge, and primary action visible; secondary fields in expandable detail

### Story 5.2: Booking Detail View with Role-Based Price Visibility

As an **agent**,
I want to view full booking details with price visibility scoped to my role,
So that I can manage the booking with all relevant information.

**Acceptance Criteria:**

**Given** I click a booking row in the list
**When** the booking detail page loads
**Then** I see: hotel name, room type, check-in/check-out dates, guest name(s), supplier reference (monospace), Apolles booking ID (monospace), StatusBadge, cancellation policy per room, and auto-cancel countdown (if status is CONFIRMED and unvouchered) (FR28)
**And** the page loads within 2 seconds (NFR7)
**And** skeleton matching the page layout is shown during loading
**And** a "Back" button navigates to the bookings list
**Given** I am a standard agent
**When** viewing price breakdown
**Then** I see the client-facing price (my markup-applied price) but NOT supplier name, cost price, or platform markup (FR28, FR64)
**Given** I am a platform owner
**When** viewing price breakdown
**Then** I see full price visibility: supplier name, cost price, platform markup, agent markup, and final client price (FR10)
**And** role-based field filtering is enforced at the API layer, not just UI-hidden (NFR14)
**And** for multi-room bookings, per-room details are displayed with individual cancellation capability status
**And** HCN status section is visible with current status badge (populated by Epic 8; shows "N/A" until HCN features are active)
**And** voucher status section shows whether a voucher has been generated, with download link if available
**And** the booking detail page includes an "Actions" area with contextual buttons based on booking status:
- CONFIRMED (unvouchered): "Generate Voucher", "Add to Voucher Queue", "Cancel Booking", "Request Modification"
- VOUCHERED: "Download Voucher", "Cancel Booking", "Request Modification"
- CANCELLED / AUTO_CANCELLED: no action buttons shown
**Given** the booking status is AUTO_CANCELLED
**When** I view the detail page
**Then** the StatusBadge shows "Auto-Cancelled", the auto-cancel countdown is replaced by the auto-cancellation timestamp, no action buttons are shown, and the audit trail includes the auto-cancel.executed event

### Story 5.3: Booking Cancellation with Penalty Display and Confirmation Gate

As an **agent**,
I want to cancel a booking with clear penalty information and a confirmation step,
So that I understand the financial consequences before committing to cancellation.

**Acceptance Criteria:**

**Given** I am viewing a booking detail with status CONFIRMED or VOUCHERED
**When** I click "Cancel Booking"
**Then** a confirmation dialog (max 480px) opens showing: hotel name, rate, dates, guest name, cancellation penalty amount (or "Free cancellation" if within free period), and explicit consequence statement (FR29)
**And** the cancellation policy text is displayed with the specific penalty that will be applied based on the current date relative to the cancellation deadline
**And** the dialog uses the UX confirmation gate pattern: full context repeated, consequences stated explicitly, financial impact in bold
**And** "Cancel" button (ghost, left) dismisses the dialog; "Cancel Booking" button (destructive variant, right) proceeds
**Given** I confirm the cancellation
**When** the system processes the cancellation
**Then** the adapter's `cancel()` method is called with an idempotency key tied to the cancellation attempt
**And** if the rate is penalized and within penalty period, the wallet reservation is finalized (penalty charged) via Epic 3's confirm flow; the wallet finalization uses the same idempotency key as the cancellation operation to prevent double-charging on retry
**And** if the rate is within free cancellation period, no wallet charge occurs and any existing reservation is released
**And** if the booking is VOUCHERED and the cancellation incurs no penalty (free cancellation period), a wallet REFUND transaction is created to return the previously confirmed debit amount; if the cancellation incurs a penalty, only the difference between the original debit and the penalty amount is refunded (if any)
**And** the booking status transitions to CANCELLED
**And** a `booking.cancelled` event is published to Redis for SSE push (the auto-cancel timer for this booking is stopped if one exists; the SSE event is sufficient for the UI to clear the countdown display)
**And** a toast confirms "Booking cancelled successfully" (auto-dismiss 4 seconds)
**And** the audit trail records: actor, action, penalty amount, previous state (CONFIRMED/VOUCHERED), new state (CANCELLED), supplier cancellation reference, correlation_id, timestamp (NFR15)
**And** adapter failures during cancellation map to `RETRYABLE_ERROR` (with "Retry" button) or `NON_RETRYABLE_ERROR` (with explanation and supplier error code)
**And** cancellation server response time meets p95 <= 10 seconds (NFR4)

### Story 5.4: Booking Modification Request Routing

As an **agent**,
I want to submit a modification request for date or guest name changes,
So that I can adjust booking details when my client's plans change.

**Acceptance Criteria:**

**Given** I am viewing a booking detail with status CONFIRMED or VOUCHERED
**When** I click "Request Modification"
**Then** a form opens allowing me to select modification type: "Date Change" or "Guest Name Change" (FR30)
**And** for date change: new check-in and check-out date pickers are shown (validated: check-out > check-in, dates in the future)
**And** for guest name change: new guest name field is shown (validated: non-empty, Zod schema)
**Given** I submit the modification request
**When** the system checks supplier API support for the modification type
**Then** if the supplier supports the modification: the modification is executed via the adapter, the booking detail updates with new values, and a success toast is shown
**And** if the supplier supports date changes and the modification results in a price change, the system displays old and new prices and requires agent confirmation before finalizing; if the new price increases wallet exposure beyond available balance, the modification is blocked with a `WALLET_INSUFFICIENT` message
**And** if the supplier does NOT support the modification: a message is displayed — "This modification is not supported by the supplier. Please contact the hotel or supplier directly." with hotel contact information if available
**And** a failed or timed-out modification attempt leaves the booking in its original state with no data changes; the failed attempt is logged in the audit trail with error details
**And** the modification request (whether successful or not) is logged in the booking audit trail with: actor, modification type, requested values, outcome (success/unsupported/error), timestamp (FR30, NFR15)
**And** modification server response time meets p95 <= 10 seconds (NFR4)
**And** adapter failures during modification map to `RETRYABLE_ERROR` or `NON_RETRYABLE_ERROR` with preserved form data

### Story 5.5: Single Voucher Generation with Preview and Status Transition

As an **agent**,
I want to generate a voucher for a confirmed booking to commit it,
So that the booking is marked as committed and the auto-cancel timer stops.

**Acceptance Criteria:**

**Given** I am viewing a booking detail with status CONFIRMED (unvouchered)
**When** I click "Generate Voucher"
**Then** a voucher preview modal (max 640px) opens showing the voucher content: hotel name, booking reference, guest name, check-in/check-out dates, room type, and cancellation policy (FR31)
**And** a clear message states: "This commits the booking. Auto-cancellation will be stopped." (medium-stakes confirmation per UX spec)
**And** a "Cancel" button and a "Generate Voucher" (primary) button are shown
**Given** I confirm voucher generation
**When** the voucher is generated
**Then** the booking status transitions from CONFIRMED to VOUCHERED
**And** the auto-cancel timer for this booking is stopped (this is the commitment boundary)
**And** the voucher PDF is generated server-side via `@react-pdf/renderer` with: hotel details, booking reference (monospace), guest details, dates, room type, cancellation terms, and agent branding (logo, company name from profile) (FR31)
**And** the voucher PDF excludes supplier names, cost prices, and internal markup — client price only (FR16, NFR14)
**And** voucher PDF generation completes within 5 seconds (NFR5)
**And** a spinner with "Generating..." is shown during PDF generation
**And** a `voucher.generated` event is published to Redis for SSE push
**And** a success toast: "Voucher generated" (auto-dismiss 4 seconds)
**And** the voucher PDF download link appears on the booking detail page
**And** voucher generation uses an idempotency key tied to the booking ID to prevent duplicate generation on retry; a duplicate request returns the existing voucher without side effects
**And** if voucher PDF generation fails, the booking status remains CONFIRMED (no transition occurs), the auto-cancel timer continues, and the agent sees a `RETRYABLE_ERROR` with a "Retry" button; if the status transition succeeds but PDF generation fails, the status transition is rolled back
**And** voucher generation does not trigger a new wallet operation; for free-cancellation bookings booked without wallet reservation, the voucher commits the booking but no wallet hold is created; wallet impact occurs only if the agent later cancels within a penalty period (Story 5.3)
**And** the audit trail records: actor, action (voucher.generated), booking reference, previous state (CONFIRMED), new state (VOUCHERED), timestamp (NFR15)

### Story 5.6: Voucher PDF Download

As an **agent**,
I want to download voucher PDFs for my vouchered bookings,
So that I can share the voucher with my client via any channel.

**Acceptance Criteria:**

**Given** a booking has status VOUCHERED and a voucher has been generated
**When** I click the "Download Voucher" link on the booking detail page
**Then** the voucher PDF is downloaded to my device with filename format: `voucher-{apolles-booking-id}.pdf` (FR33)
**And** the PDF contains: hotel name, address, Apolles booking reference, hotel confirmation number (if available from supplier), guest name(s), check-in/check-out dates, room type, meal plan, cancellation terms, special requests, and agent branding (logo, company name)
**And** the PDF must NOT contain the supplier's internal API reference ID, supplier name, cost prices, markup information, or any identifier that reveals which supplier sourced the booking (FR16)
**And** the PDF is regenerated on download if the voucher template or agent branding has changed since last generation (not cached stale)
**And** if PDF download or regeneration fails, a toast error is shown with a "Retry" option
**Given** I am on the booking list page
**When** a booking has VOUCHERED status
**Then** a "Download" action is available in the row actions column for direct voucher download without navigating to the detail page

### Story 5.7: Voucher Queue Management UI

As an **agent**,
I want to add confirmed bookings to a voucher queue and manage the queue,
So that I can organize multiple bookings for batch voucher generation.

**Acceptance Criteria:**

**Given** I am on the Voucher Queue page (accessible from sidebar under Tools)
**When** the page loads
**Then** I see all bookings I have added to the voucher queue with: booking reference, hotel name, guest name, check-in date, auto-cancel countdown, HCN status indicator, and a "Remove" action per item (FR32)
**And** the queue persists across sessions (saved to my account) until items are vouchered or removed
**And** the queue supports up to 20 items (FR32)
**And** bookings that are no longer in CONFIRMED status (cancelled, auto-cancelled, or already vouchered) are automatically removed from the queue on page load with a visual indicator showing the reason (e.g., "Already vouchered", "Cancelled", "Auto-cancelled")
**Given** I am on a booking detail page with status CONFIRMED
**When** I click "Add to Voucher Queue"
**Then** the booking is added to my voucher queue with a success toast ("Added to voucher queue", auto-dismiss 4 seconds) — no modal or confirmation (low-stakes action)
**And** if the queue already has 20 items, the action is blocked with an inline message: "Voucher queue is full (20 items max). Generate vouchers or remove items to add more."
**Given** I click "Remove" on a queue item
**When** the item is removed
**Then** the booking is removed from the queue without affecting its booking status
**And** batch voucher queue management is desktop-only per UX spec; on mobile, the Voucher Queue page shows a message directing agents to use desktop for batch operations

### Story 5.8: Batch Voucher Generation

As an **agent**,
I want to generate vouchers for all queued bookings in one action,
So that I can efficiently commit multiple bookings at once.

**Acceptance Criteria:**

**Given** I have items in the voucher queue
**When** I click "Generate All Vouchers"
**Then** a confirmation message states: "This will commit {N} bookings. Auto-cancellation timers will be stopped for all." with item count
**And** on confirmation, vouchers are generated for all queued items as individual PDFs in a single batch action
**And** the batch operation uses an idempotency key for the overall batch request; individual voucher generation within the batch skips bookings that have already transitioned to VOUCHERED (idempotent per-booking)
**And** batch voucher generation for up to 10 vouchers completes within 15 seconds (NFR6); for 11-20 vouchers, proportional time with progress indicator
**And** a progress indicator shows generation progress (e.g., "Generating 3 of 10...")
**And** each booking transitions from CONFIRMED to VOUCHERED
**And** each voucher PDF follows the same content and visibility rules as single voucher generation (Story 5.5)
**And** batch voucher generation does not trigger any wallet operations; wallet impact is handled per-booking at cancellation time (Story 5.3)
**And** after batch generation completes, each successfully generated voucher shows a "Download" link inline in the batch results view, allowing direct download without navigating to the booking detail page
**And** the audit trail records a `voucher.batch-generated` event with the list of booking IDs, actor, and timestamp (NFR15)
**And** if any individual voucher generation fails within the batch, the successful ones still complete and the failed ones are reported with retry option

### Story 5.9: Booking Audit Trail Display

As an **agent**,
I want to view a chronological audit trail for each booking,
So that I can see the complete history of actions taken on the booking.

**Acceptance Criteria:**

**Given** I am viewing a booking detail page
**When** I expand the "Activity History" section (accordion)
**Then** I see a chronological timeline (newest at top) of all events for this booking (FR37)
**And** each entry shows: timestamp, event type icon, event description, and actor (system/agent/admin)
**And** event types include: booking.created, booking.price-checked (with price change indication if applicable), booking.confirmed, voucher.generated, booking.cancelled (with penalty amount), booking.modified (with change details), hcn.email-sent, hcn.status-changed, auto-cancel.warning-sent (48h/24h), auto-cancel.executed, admin.override (with reason), and admin.escalation
**And** the timeline follows the HCNTimeline component pattern from UX spec: ordered list (`<ol>`) with `aria-label="Booking activity timeline"`, each entry with `aria-label="[date]: [event description]"`
**And** timestamps display in the agent's configured timezone with format "Mar 10, 2026 at 14:30" and relative time for recent events ("2 hours ago")
**And** financial events (charges, refunds) show amounts in monospace font
**And** the audit trail is read-only — agents cannot edit or delete entries (append-only per architecture)
**And** audit trail entries are limited to the most recent 50 events by default with a "Show all" link if more exist
**And** entries are loaded with the booking detail (no separate API call for first 50) and the section defaults to collapsed (accordion)

## Epic 6: Auto-Cancellation System

Unvouchered bookings are automatically cancelled before the free cancellation deadline with a configurable safety buffer. Agents receive multi-touchpoint warnings at 48h and 24h. Failed cancellations retry with exponential backoff and escalate to admin. 99.9% reliability target.

### Story 6.1: Cancellation Deadline Timezone Normalization

As the **platform**,
I want all cancellation deadlines stored and compared in UTC with correct timezone handling,
So that no cancellation is missed due to timezone discrepancies between suppliers, agents, and the platform.

**Acceptance Criteria:**

**Given** a booking is confirmed with a cancellation deadline from the supplier
**When** the deadline is ingested from the supplier adapter
**Then** the cancellation deadline is normalized to UTC on ingestion regardless of the supplier's original timezone format (FR34)
**And** the safety buffer is applied against the UTC-normalized deadline
**And** the scheduled auto-cancellation execution time is stored as UTC
**Given** the agent views a booking with a cancellation deadline
**When** the deadline is displayed
**Then** it is converted from UTC to the agent's configured timezone for display
**And** the countdown timer calculates remaining time from current UTC to the UTC deadline (no timezone arithmetic at display time)
**Given** the platform has bookings across multiple timezones
**When** auto-cancellation jobs are evaluated
**Then** all comparisons use UTC timestamps — no local time comparisons anywhere in the cancellation pipeline
**And** a test suite validates correct behavior across DST transitions, half-hour timezone offsets (e.g., IST +5:30), and edge cases where supplier returns dates without timezone information (treated as hotel-local time, converted to UTC using hotel's known timezone)

### Story 6.2: Auto-Cancellation Job Scheduling and Execution

As the **platform**,
I want unvouchered bookings to be automatically cancelled before the free cancellation deadline,
So that agents are protected from penalties on bookings they haven't committed to.

**Acceptance Criteria:**

**Given** a booking is in CONFIRMED status (not vouchered)
**When** the booking is created or the cancellation deadline is known
**Then** an auto-cancellation job is scheduled via Inngest/Trigger.dev to execute at (cancellation_deadline - safety_buffer) (FR34)
**And** the safety buffer is configurable (default: 2-4 hours, stored as a platform setting)
**And** all cancellation deadlines are normalized to UTC on ingestion per Story 6.1; the safety buffer is applied against the UTC-normalized deadline (FR34)
**And** the scheduled job stores: booking ID, cancellation deadline (UTC), scheduled execution time (UTC), safety buffer applied, and job status
**Given** the scheduled execution time arrives
**When** the job executes
**Then** the system verifies the booking status is still CONFIRMED; if status is VOUCHERED, CANCELLED, or AUTO_CANCELLED, the job completes as a no-op with an audit entry specifying the skip reason and current status
**And** if still CONFIRMED: the adapter's `cancel()` method is called with an idempotency key tied to the auto-cancellation attempt
**And** on successful cancellation: the booking status transitions to AUTO_CANCELLED, a `booking.auto-cancelled` event is published to Redis for SSE push, and the audit trail records: actor (system), action (auto-cancel.executed), booking reference, cancellation deadline, safety buffer, correlation_id, timestamp (NFR15)
**Given** a booking with a non-refundable rate (no free cancellation period)
**When** the booking is created
**Then** no auto-cancellation job is scheduled — the booking remains in CONFIRMED status until the agent manually vouchers or cancels it
**Given** a booking whose cancellation deadline minus safety buffer is already in the past at scheduling time
**When** the auto-cancellation job is created
**Then** the job executes immediately (within 1 minute) and follows the standard CONFIRMED-check and cancel flow
**And** auto-cancellation system achieves 99.9%+ success rate on scheduled cancellations (NFR21)
**And** a `auto_cancel_execution_latency_ms` metric is emitted for observability

### Story 6.3: Auto-Cancellation Retry and Escalation

As the **platform**,
I want failed auto-cancellation attempts to retry and escalate to admin if all retries fail,
So that no booking silently misses its cancellation window.

**Acceptance Criteria:**

**Given** an auto-cancellation job fails (supplier API error, timeout, or transient failure)
**When** the failure is detected
**Then** the system retries with exponential backoff: retry 1 after 2 minutes, retry 2 after 10 minutes, retry 3 after 30 minutes — all within the safety buffer window (FR36)
**And** each retry attempt uses the same idempotency key as the original attempt
**And** each retry is logged in the audit trail: actor (system), action (auto-cancel.retry), attempt number, error details, next retry time (NFR15)
**Given** all 3 retries fail within the safety buffer window
**When** the final retry fails
**Then** the booking is flagged as "Auto-cancel failed — manual intervention required"
**And** an escalation is created for platform admin with: booking ID, hotel name, cancellation deadline, failure details, all retry timestamps and errors (FR36)
**And** an alert is delivered to admin within 5 minutes of the final failure via email and team messaging channel (NFR23)
**And** if the CRITICAL alert is not acknowledged by an admin within 15 minutes, the system escalates to on-call via a secondary notification channel (NFR23)
**And** the escalation severity is CRITICAL (auto-cancellation failure) per NFR23 alert categories
**And** if the remaining safety buffer time is insufficient for the next scheduled retry, the system skips remaining retries and escalates immediately to admin
**And** the audit trail records: actor (system), action (auto-cancel.escalated), booking reference, failure reason, all retry details, escalation timestamp (NFR15)
**And** the booking remains in CONFIRMED status (not auto-cancelled) with the escalation flag visible in both agent and admin views
**Given** a retry succeeds after an initial failure
**When** the cancellation is confirmed by the supplier
**Then** the booking transitions to AUTO_CANCELLED normally and any pending escalation is cleared

### Story 6.4: Auto-Cancellation Warning Notifications (48h and 24h)

As an **agent**,
I want to receive warnings before my unvouchered bookings are auto-cancelled,
So that I can generate a voucher to keep the booking if I intend to use it.

**Acceptance Criteria:**

**Given** a booking is in CONFIRMED status with a scheduled auto-cancellation
**When** the auto-cancellation is 48 hours away
**Then** the system sends an in-app notification: "Booking {reference} for {hotel} will be auto-cancelled in 48 hours. Generate a voucher to keep this booking." (FR35)
**And** the system sends an email notification to the agent's registered email with the same message, booking details (hotel, dates, guest), and a deep link to the booking detail page (FR35)
**And** the notification includes a direct "Generate Voucher" action link
**When** the auto-cancellation is 24 hours away
**Then** the system sends a second email notification (email-only at 24h, no in-app notification per FR35's specification) with urgency language: "URGENT: Booking {reference} will be auto-cancelled in 24 hours" (FR35)
**And** the notification dispatch checks the agent's auto-cancellation warning preference (defaults to enabled); when Epic 9 delivers FR60, this flag is user-configurable
**And** warning emails are dispatched through the platform email delivery system which supports 1,000+ emails per day (NFR29)
**And** warning job scheduling uses Inngest/Trigger.dev with the same reliability guarantees as the cancellation job
**And** if a warning notification fails to send (email delivery failure), the failure is logged but does not block the auto-cancellation process
**And** the audit trail records each warning sent: actor (system), action (auto-cancel.warning-sent), booking reference, warning type (48h/24h), delivery channel (in-app/email), timestamp (NFR15)
**And** if the agent vouchers the booking before a scheduled warning, the warning job is cancelled (no notification sent)

### Story 6.5: Auto-Cancel Countdown Display on Booking Cards

As an **agent**,
I want to see a visual countdown on my unvouchered bookings showing when they'll be auto-cancelled,
So that I have constant awareness of approaching deadlines.

**Acceptance Criteria:**

**Given** a booking is in CONFIRMED status with a scheduled auto-cancellation
**When** the booking card is displayed (in booking list or booking detail)
**Then** an AutoCancelCountdown component renders with progressive urgency states:
- `> 72 hours`: subtle info display, `--info` color, static text "Auto-cancels in 5 days"
- `24-72 hours`: amber warning, `--warning` color, "Auto-cancels in 2d 14h"
- `< 24 hours`: red urgent, `--error` color, bold text "Auto-cancels in 18h 32m"
- `< 6 hours`: red pulsing, `--error` + pulse animation, "AUTO-CANCEL IN 4h 12m"
- `< 1 hour`: critical alert, `--error` + persistent fixed banner, "CANCELS IN 47 MINUTES" (FR35)
**And** countdown updates are pushed via SSE subscription; fallback to calculated display from last known deadline timestamp if SSE connection drops (no HTTP polling)
**And** when the booking is vouchered, the countdown is replaced by a "Vouchered" StatusBadge immediately via SSE
**And** when the booking is auto-cancelled, the countdown is replaced by an "Auto-Cancelled" StatusBadge with the cancellation timestamp
**And** the countdown is accessible: `aria-live="polite"` for screen readers, updates announced at urgency transitions only (not every second)

## Epic 7: Quote & Itinerary Builder

Agents can build multi-city quotes from search results with 1-click hotel addition, organize hotel options per city, add notes, generate branded PDF quotes, and share with clients via email or download. The quote builder is the platform's primary differentiator — no B2B competitor offers multi-city quote PDF generation.

### Story 7.1: Quote Data Model and Server-Side State Persistence

As an **agent**,
I want my in-progress quotes to be saved server-side and persist across sessions,
So that I can build quotes over multiple searches without losing my work.

**Acceptance Criteria:**

**Given** I start building a quote (first "Add to Quote" action)
**When** rooms are added to the quote
**Then** the quote state is persisted server-side in the database via Server Components (not client-side store) per architecture spec
**And** the quote data model stores: quote ID, agent ID (tenant-scoped), client name (editable), status (IN_PROGRESS/DRAFT/SENT/DOWNLOADED), cities with hotel options, notes, creation timestamp, last modified timestamp
**And** each city entry stores: city/destination name, hotel options (2-4 per city), and per-city notes
**And** each hotel option stores: hotel name, room type, rate, cancellation policy, meal plan, images (URLs from supplier, cached server-side on addition — not fetched at PDF render time), check-in/check-out dates, and per-hotel notes
**And** each city entry also stores: search destination and guest configuration (adults, children with ages) from the original search — required for re-search (Story 7.6) and PDF display
**And** a quote supports up to 10 cities (FR11)
**And** each city supports 2-4 hotel options (FR12)
**And** the quote auto-saves on every change (no manual "save" required for in-progress quotes)
**And** the quote persists across sessions — if I close the browser and return, my in-progress quote is intact
**And** all quote read/write operations are tenant-scoped and enforced at the API layer via the centralized authorize() function — agents can only access their own quotes (NFR14)

### Story 7.2: Add to Quote from Search Results

As an **agent**,
I want to add hotel options to my quote directly from search results with one click,
So that I can build quotes without interrupting my search flow.

**Acceptance Criteria:**

**Given** I am viewing search results (from Epic 2)
**When** I click "Add to Quote" on a hotel card
**Then** a room selection step allows me to select 1 or more rooms for this hotel (minimum 1 required) (FR12)
**And** selected rooms are added to the in-progress quote under the appropriate city (determined by the search destination)
**And** a success toast appears: "Added to quote" (auto-dismiss 4 seconds) — no modal, no confirmation gate (low-stakes action per UX spec)
**And** the QuoteIndicator widget in the sidebar updates: shows client name (editable), cities count, rooms count, and "View Quote" shortcut
**And** if no in-progress quote exists, a new quote is created automatically
**And** if the current city already has 4 hotel options, the action is blocked with an inline message: "Maximum 4 options per city reached. Remove an option to add more."
**And** "Add to Quote" is also available from the room detail view (FR12)
**And** the added hotel option stores: the markup-applied client price (via centralized markup service), not the raw supplier price

### Story 7.3: Quote Builder Workspace — Multi-City Organization

As an **agent**,
I want to view and organize my quote with hotel options grouped by city,
So that I can present a well-structured itinerary to my client.

**Acceptance Criteria:**

**Given** I navigate to the Quote Builder page (from sidebar or QuoteIndicator widget)
**When** the page loads
**Then** I see my in-progress quote organized by city tabs, with hotel options listed under each city (FR12)
**And** each hotel option card shows: hotel name, star rating, room type, rate (client price only — no supplier name, cost, or markup), cancellation policy, meal plan, and a thumbnail image
**And** I can reorder hotel options within a city via drag-and-drop
**And** I can remove a hotel option with a "Remove" action (no confirmation — low-stakes)
**And** I can add per-city notes (free text, displayed in the PDF under the city section) (FR13)
**And** I can add per-hotel notes (free text, displayed in the PDF under the hotel option) (FR13)
**And** I can edit the client name for this quote
**And** the quote displays only the final client price — no supplier names, cost prices, or internal markup information (FR16)
**And** on desktop: side-by-side layout (list + preview); on tablet: stacked; on mobile: read-only preview with "Continue on desktop" message
**Given** I navigate to the Quote Builder with no active or in-progress quote
**When** the page loads
**Then** I see an empty state: "No active quote. Add hotels from search results to start building." with a "Go to Search" button

### Story 7.4: Quote PDF Generation and Preview

As an **agent**,
I want to generate a professional branded PDF quote from my organized hotel options,
So that I can present a polished itinerary to my client.

**Acceptance Criteria:**

**Given** I have a quote with at least one city and one hotel option
**When** I click "Preview PDF" or "Generate PDF"
**Then** a PDF preview pane opens showing the rendered quote document
**And** the PDF is generated server-side via `@react-pdf/renderer` as a React component (FR14)
**And** the PDF includes: agent branding (logo, company name, primary/secondary brand colors from profile), quote header/footer text, hotel details per city (name, star rating, images, room type, rate, cancellation terms, meal plan), per-city notes, per-hotel notes, and agent disclaimer text (FR14)
**And** the PDF uses the agent's selected quote template (from settings, or system default if not configured) with their brand colors
**And** the PDF displays only the final client price — no supplier names, cost prices, or markup information (FR16)
**And** PDF generation completes within 5 seconds for a multi-city quote with up to 12 hotel options (NFR5)
**And** a spinner with "Generating preview..." is shown during generation
**And** hotel images are fetched from the server-side cache (cached when added to the quote in Story 7.2); if an image is unavailable at render time, a placeholder is used and the PDF generates successfully without blocking
**And** if PDF generation fails, a `RETRYABLE_ERROR` is shown with a "Retry" button
**And** the preview is accurate — what the agent sees is what the client will receive

### Story 7.5: Quote Sharing — Email and Download

As an **agent**,
I want to send the quote PDF to my client via email or download it for sharing through other channels,
So that I can deliver the itinerary to my client however they prefer.

**Acceptance Criteria:**

**Given** I have generated a quote PDF preview
**When** I click "Send Quote" (primary action)
**Then** an email compose form opens with: recipient email (required, validated), subject (pre-filled with "Quote from {agent company name}"), and optional message body
**And** on send, the quote PDF is attached to the email and delivered via the platform email service (FR15)
**Precondition:** Email service provider selected and `src/lib/email.ts` implemented with send + attachment capability. If Epic 8 stories are implemented first, this may already exist.
**And** email delivery tracking captures sent/delivered/bounced status (NFR35); if the quote email bounces, the quote status is updated and the agent is notified within 1 hour
**And** the quote status transitions to SENT
**And** a success toast: "Quote sent" (auto-dismiss 4 seconds)
**When** I click "Download PDF" (secondary action)
**Then** the PDF is downloaded to my device with filename format: `quote-{quote-id}.pdf` (FR15)
**And** the quote status transitions to DOWNLOADED
**And** quote is auto-saved to Quotes History on send or download
**When** I click "Save Draft" (ghost action)
**Then** the quote is saved with DRAFT status without sending or downloading
**And** status transitions follow: IN_PROGRESS may transition to DRAFT, SENT, or DOWNLOADED; DRAFT may transition to SENT or DOWNLOADED; DOWNLOADED may transition to SENT; SENT is a terminal status (subsequent downloads do not change status); all transitions are logged in the audit trail
**And** email delivery failures show an error toast with "Retry" option
**And** the audit trail records: actor, action (quote.sent / quote.downloaded / quote.draft-saved), quote ID, recipient (if sent), timestamp

### Story 7.6: Quotes History and Re-Search

As an **agent**,
I want to view my past quotes and re-search from a previous quote,
So that I can reuse previous research for returning clients or updated requests.

**Acceptance Criteria:**

**Given** I navigate to the Quotes History page
**When** the page loads
**Then** I see a list of all my quotes with: client name, cities, status (Draft/Sent/Downloaded), date created, date last modified
**And** the list is paginated and searchable by client name
**And** clicking a quote opens it in the Quote Builder for viewing or editing
**Given** I view a past quote
**When** I click "Re-Search" on one or more hotel options
**Then** the system pre-fills a new search with: hotel destination (city), check-in/check-out dates, and number of guests from the original search parameters
**And** I can modify the pre-filled search before executing it
**And** results from the re-search can be added to a new in-progress quote

### Story 7.7: QuoteIndicator Sidebar Widget

As an **agent**,
I want a persistent sidebar widget showing my active quote status,
So that I always know what's in my current quote without navigating away from my workflow.

**Acceptance Criteria:**

**Given** I have an in-progress quote
**When** any page loads
**Then** the QuoteIndicator widget in the sidebar shows: client name (editable inline), number of cities, number of rooms, and a "View Quote" link to the quote builder
**And** when I add an item to the quote, the widget briefly highlights (animation) to confirm the addition
**Given** I have no active quote
**When** any page loads
**Then** the QuoteIndicator shows: "No active quote. Add hotels from search results to start."
**And** the widget is visible on all dashboard pages (search, bookings, HCN, etc.)

## Epic 8: HCN Verification

The system automatically sends HCN verification emails after booking confirmation. Agents can monitor HCN status per reservation, resend emails, update status manually, customize email templates, and view a dashboard of pending verifications.

### Story 8.1: Automated HCN Verification Email Dispatch

As the **platform**,
I want HCN verification emails sent automatically after booking confirmation,
So that hotel confirmation numbers are verified without manual agent effort.

**Acceptance Criteria:**

**Given** a booking is confirmed (status CONFIRMED, `booking.confirmed` event received)
**When** the confirmation event is processed
**Then** the system sends an HCN verification email to the hotel's reservation department email address (FR38)
**And** the email includes system-populated non-removable fields: hotel name, confirmation number (supplier reference), guest name, check-in/check-out dates, and room type (FR43)
**And** the email uses the agent's customized template (greeting, body text, closing) if configured, or a system default template
**And** the email is sent from the agent's configured sending email address (FR42), or a platform default if not configured
**And** the HCN status for this booking transitions from "Available" to "Email Sent"
**Given** the hotel's reservation email address is not available in the supplier data
**When** the booking.confirmed event is processed
**Then** the HCN status remains "Available" (no email sent), the agent is notified that manual verification is needed with a prompt to enter the hotel email manually, and the HCNTimeline shows "Hotel email not available — manual verification required"
**And** a `hcn.email-sent` event is published to Redis for SSE push to the client
**And** the audit trail records: actor (system), action (hcn.email-sent), booking reference, hotel email address, sending email address, timestamp (NFR15)
**And** email delivery tracking captures: sent, delivered, bounced status (NFR35)
**And** bounce notifications are surfaced to the agent within 1 hour (NFR35)
**And** emails are dispatched through the platform email service supporting 1,000+ emails/day (NFR29)

### Story 8.2: HCN Status State Machine and Manual Updates

As an **agent**,
I want to view and manually update the HCN status for each booking,
So that I can track verification progress and record outcomes.

**Acceptance Criteria:**

**Given** I am viewing a booking detail page
**When** I look at the HCN status section
**Then** I see the current HCN status displayed as a StatusBadge: Available (`--info`), Waiting (`--warning`), Email Sent (`--info`, Mail icon), Confirmed (`--success`, CheckCircle icon), Mismatch (`--error`, AlertTriangle icon), or Issue (`--error`, AlertTriangle icon) (FR39)
**Given** I click "Update Status" dropdown
**When** I select a new status
**Then** the HCN status transitions to the selected state if the transition is valid (FR40)
**And** valid manual transitions are enforced: Available → Waiting/Email Sent/Issue; Email Sent → Waiting/Confirmed/Mismatch/Issue; Waiting → Confirmed/Mismatch/Issue; Mismatch → Issue/Confirmed (after re-verification); Issue → Waiting/Confirmed; invalid transitions are rejected with an error message
**And** "Waiting" state semantics: agent has initiated manual outreach (phone, direct email) or is awaiting hotel response after email bounce — distinct from "Email Sent" which means the automated email was delivered
**And** I can add a note explaining the status change (free text)
**And** the status change is logged in the audit trail: actor (agent), action (hcn.status-changed), previous status, new status, note text, timestamp (NFR15)
**And** a `hcn.status-changed` event is published to Redis for SSE push
**And** the HCNTimeline component on the booking detail shows the new event entry
**Given** the HCN status is "Mismatch"
**When** I view the booking detail
**Then** a side-by-side comparison is displayed: "Your booking says: [X]" vs "Hotel says: [Y]" for each mismatched field per UX spec

### Story 8.3: HCN Email Resend and Template Preview

As an **agent**,
I want to resend HCN verification emails and preview my email template,
So that I can follow up with hotels that haven't responded and ensure my emails look correct.

**Acceptance Criteria:**

**Given** I am viewing a booking detail page with HCN status "Email Sent", "Waiting", or "Mismatch"
**When** I click "Resend HCN Email"
**Then** a new HCN verification email is sent to the hotel using the current template and booking details (FR41)
**And** the HCNTimeline shows a "Re-verification email sent" entry with RefreshCw icon
**And** the audit trail records: actor (agent), action (hcn.email-resent), booking reference, timestamp
**And** the email uses the agent's current template configuration (not a cached version from the original send)
**And** a toast confirms: "HCN email resent" (auto-dismiss 4 seconds)

### Story 8.4: HCN Email Template Customization

As an **agent**,
I want to customize my HCN verification email template,
So that my communications with hotels are professional and consistent with my brand.

**Acceptance Criteria:**

**Given** I navigate to Settings > HCN Email Configuration
**When** the page loads
**Then** I see the HCN email template editor with editable fields: greeting text, body text, and closing text (FR43)
**And** system-populated non-removable fields are clearly marked: hotel name, confirmation number, guest name, check-in/check-out dates, room type — these cannot be edited or removed (FR43)
**And** I can preview the template with sample data before saving (FR43)
**And** changes apply to all subsequently sent HCN emails (existing sent emails are not affected)
**Given** I navigate to Settings > HCN Email Configuration
**When** I edit the sending email address field
**Then** I can set my custom sending email address for HCN verification (FR42)
**And** the email address is validated (format validation + Zod schema)
**And** a confirmation email is sent to verify ownership of the address before it becomes active

### Story 8.5: HCN Pending Dashboard

As an **agent**,
I want to view a dashboard of all bookings with pending or unverified HCN statuses,
So that I can monitor verification progress across all my bookings at a glance.

**Acceptance Criteria:**

**Given** I navigate to the HCN Dashboard page (accessible from sidebar under Main section)
**When** the page loads
**Then** I see a filterable list of all my bookings with pending/unverified HCN statuses (FR44)
**And** the dashboard shows: booking reference, hotel name, guest name, dates, current HCN status (StatusBadge), time since last status change, and available actions
**And** the list is filterable by HCN status (Email Sent, Waiting, Mismatch, Issue)
**And** the sidebar nav badge shows the count of mismatches (uses `--error` for mismatches, `--warning` for attention-needed)
**And** clicking a row navigates to the booking detail page HCN section
**And** the dashboard loads within 2 seconds (NFR7)
**Given** there are no pending HCN verifications
**When** the page loads
**Then** the empty state shows: "No HCN verifications pending. Verifications are sent automatically when a booking is confirmed."

### Story 8.6: HCN Timeline Component for Booking Detail

As an **agent**,
I want to see a chronological timeline of HCN verification events per booking,
So that I can understand the full verification history and current state.

**Acceptance Criteria:**

**Given** I am viewing a booking detail page
**When** I view the HCN section
**Then** I see an HCNTimeline component showing a chronological timeline (newest at top) of all HCN events for this booking
**And** each entry shows: timestamp, event type icon, event description, and actor (system/agent/hotel)
**And** event types with icons: Email Sent (Mail), Hotel Responded (Reply), Mismatch Detected (AlertTriangle), Agent Action (User), Re-verification (RefreshCw), Confirmed (CheckCircle) per UX spec
**And** the current HCN status badge is displayed at the top of the timeline
**And** action buttons rendered below the timeline are implemented in Stories 8.2 (manual update, add note) and 8.3 (resend) — this story provides the timeline display component and SSE subscription only
**And** the timeline is an ordered list (`<ol>`) with `aria-label="HCN verification timeline"` per UX spec accessibility requirements
**And** each entry has `aria-label="[date]: [event description]"`
**And** status updates are pushed via SSE (`hcn.status-changed` events) — the timeline updates in real-time without page refresh

## Epic 9: Agent Settings & Customization

Agents can configure quote branding (template, colors, header/footer, disclaimer), set default markup percentage, manage notification preferences for all alert types, and configure HCN email settings. Settings UI only — pricing/markup logic lives in Epic 3's markup service.

### Story 9.1: Quote Template Selection and Brand Customization

As an **agent**,
I want to select a quote PDF template and customize my branding,
So that my quotes reflect my brand identity and look professional.

**Acceptance Criteria:**

**Given** I navigate to Settings > Quote Settings
**When** the page loads
**Then** I see a template gallery with 3-5 pre-built PDF templates displayed as thumbnail previews (FR59)
**And** I can select a template by clicking its thumbnail; the selected template is highlighted with the selection accent color
**And** a live preview panel shows the selected template rendered with my current branding settings and sample data
**And** I can customize: primary and secondary brand colors via hex code input or color picker (FR59)
**And** I can edit header text and footer text (free text fields)
**And** I can edit disclaimer text (free text, max 1000 characters) (FR59)
**And** I can set my default markup percentage (0-100%, 0.1% increments) which is saved and used by Epic 3's markup service (FR59)
**And** changes are saved with a "Save Settings" button; a success toast confirms "Settings saved"
**And** changes apply to all subsequently generated quotes (not retroactive to existing PDFs)
**And** settings forms are pre-filled from current saved values per UX spec
**And** quote settings configuration is desktop-only; on mobile, a message directs agents to use desktop

### Story 9.2: Agent Logo Upload and Preview

As an **agent**,
I want to upload my company logo for use in quotes and vouchers,
So that my generated documents carry my brand identity.

**Acceptance Criteria:**

**Given** I navigate to Settings > Profile or Settings > Quote Settings
**When** I click "Upload Logo"
**Then** a file picker opens accepting image formats (PNG, JPG, SVG) with a max file size of 2MB (FR58)
**And** SVG files are sanitized on upload to strip embedded scripts, event handlers, and `<foreignObject>` elements before storage (NFR17); content-type is validated against file magic bytes, not just file extension
**And** after upload, an immediate preview shows how the logo will appear in the quote PDF header
**And** the logo is stored securely and associated with my agent profile
**And** the logo is used in all subsequently generated quote PDFs and voucher PDFs (FR58)
**And** I can replace the logo by uploading a new one; the old logo is replaced immediately
**And** if no logo is uploaded, PDFs use the agent's company name text in place of a logo
**Note:** If Story 1.7 (Epic 1) already implements logo upload with the same functionality, this story embeds the existing logo-upload component in the Quote Settings page for contextual access rather than reimplementing it.

### Story 9.3: Notification Preferences Management

As an **agent**,
I want to independently toggle each notification type on or off,
So that I receive only the alerts that are relevant to my workflow.

**Acceptance Criteria:**

**Given** I navigate to Settings > Notifications
**When** the page loads
**Then** I see independent toggle switches for each notification type (FR60):
- Auto-cancellation warnings (in-app + email) — default: enabled
- HCN status updates (in-app + email) — default: enabled
- Booking confirmations (email) — default: enabled
- Wallet low-balance alerts (in-app + email) — default: enabled
**And** for wallet low-balance alerts: agent can configure a wallet low-balance threshold (absolute amount in their currency); when balance drops below threshold after a debit, a low-balance alert is dispatched per the agent's notification preference; default threshold: not set (no alerts until configured)
**And** each toggle clearly indicates the delivery channels (in-app, email, or both)
**And** toggling a notification type off immediately stops future notifications of that type
**And** toggling does not affect already-sent notifications
**And** changes are saved automatically on toggle (no "Save" button needed — each toggle is an independent server action)
**And** a success toast confirms each change: "Auto-cancellation warnings disabled" or "...enabled"
**And** the notification dispatch system (used by Epics 6, 8, and wallet features) checks these preferences before sending

## Epic 10: Platform Administration

Platform owner can monitor the entire platform: supplier API health, hotel mapping management, booking investigation across all agents, agent account management, auto-cancel escalation handling, booking status overrides, and supplier issue tracking.

### Story 10.1: Admin Dashboard with Platform-Wide Metrics

As the **platform owner**,
I want to see a dashboard with key platform metrics at a glance,
So that I can monitor overall platform health and activity.

**Acceptance Criteria:**

**Given** I am logged in as platform owner and navigate to the Admin Dashboard
**When** the page loads
**Then** I see platform-wide metrics: active agent count, total booking volume (today/week/month), supplier API health status summary, and hotel mapping stats (total mapped, pending review, low-confidence) (FR65)
**And** the dashboard loads within 2 seconds (NFR7)
**And** the admin route group is protected by role-based access — only platform owner role can access (NFR14)
**And** metrics are read from aggregated data, not computed on every page load
**And** the layout follows the admin shell layout from the architecture route structure

### Story 10.2: Supplier API Health Monitoring Dashboard

As the **platform owner**,
I want to monitor supplier API response times and availability,
So that I can identify degraded suppliers and take action before agents are affected.

**Acceptance Criteria:**

**Given** I navigate to Admin > Suppliers
**When** the page loads
**Then** I see per-supplier health metrics: average response time (last 5 minutes, last hour, last 24 hours), error rate percentage, current circuit breaker status (CLOSED/OPEN/HALF_OPEN), and availability status (FR66)
**And** the data is sourced from the `supplier_api_logs` table per architecture spec
**And** alert thresholds are displayed: alert when average response time exceeds 3 seconds (sustained over 5 minutes) or error rate exceeds 5% (sustained over 5 minutes) (NFR33)
**And** thresholds are adjustable per supplier (NFR33)
**And** active alerts are highlighted with `--error` color and sorted to the top
**And** I can view historical trends (last 24 hours) as a simple time-series chart
**And** the page auto-refreshes health data every 30 seconds

### Story 10.3: Hotel Mapping Management

As the **platform owner**,
I want to review and manage hotel mapping matches,
So that I can ensure search result deduplication accuracy across suppliers.

**Acceptance Criteria:**

**Given** I navigate to Admin > Mapping
**When** the page loads
**Then** I see a server-side paginated list (25/50/100 per page) of hotel mappings with server-side search by hotel name and filters: confidence level (high/medium/low), review status (pending/confirmed/rejected), and supplier (FR67)
**And** the list loads within 2 seconds (NFR7)
**And** low-confidence matches are highlighted for review
**And** for each mapping, I see: hotel names from each supplier, addresses, coordinates, confidence score, and current status
**Given** I review a mapping
**When** I click "Confirm" or "Reject"
**Then** the mapping status updates accordingly (FR67)
**And** I can manually override a mapping: force-merge two entries or force-split an incorrectly merged entry (FR67)
**And** manual overrides are logged in the audit trail: actor (admin), action (mapping.override), hotels involved, previous state, new state, timestamp (NFR15)
**And** mapping lookup performance remains sub-500ms after overrides (NFR27)

### Story 10.4: Cross-Tenant Booking Investigation

As the **platform owner**,
I want to investigate individual bookings across all agents,
So that I can provide support and resolve booking issues.

**Acceptance Criteria:**

**Given** I navigate to Admin > Bookings
**When** the page loads
**Then** I see a cross-tenant booking list with all bookings across all agents (FR68)
**And** I can search by booking reference, hotel name, guest name, or agent name
**And** I can filter by status, date range, supplier, and agent
**And** cross-tenant booking list loads within 2 seconds with server-side pagination (25/50/100 per page) (NFR7)
**And** clicking a booking shows full details including: supplier name, cost price, platform markup, agent markup, client price — full price visibility (FR10, FR68)
**And** the booking detail shows the complete audit trail
**And** all data access is logged for compliance

### Story 10.5: Booking Status Override

As the **platform owner**,
I want to override a booking's status when automated systems cannot resolve an issue,
So that I can manually correct booking states for support purposes.

**Acceptance Criteria:**

**Given** I am viewing a booking in the admin booking investigation view
**When** I click "Override Status"
**Then** I can select from allowed admin override transitions: CONFIRMED → CANCELLED (manual cancel), CONFIRMED → VOUCHERED (force voucher), AUTO_CANCELLED → CONFIRMED (reinstate); all other transitions are blocked with an error explaining why (FR71)
**And** a mandatory reason note field is required before the override can be executed (FR71)
**And** when an admin overrides status, the associated wallet operation follows the same rules as agent-initiated transitions: force-cancel triggers refund per Story 5.3 rules, force-voucher triggers wallet reservation per Story 5.5 rules; if the wallet operation fails, the override is blocked with an error
**And** the override is logged in the audit trail: actor (admin), action (admin.override), booking reference, previous status, new status, mandatory reason note, wallet impact, timestamp (NFR15)

### Story 10.6: Auto-Cancel Escalation and Agent Account Management

As the **platform owner**,
I want to manage escalated auto-cancellation failures and view agent accounts,
So that I can resolve urgent booking issues and monitor agent status.

**Acceptance Criteria:**

**Given** I navigate to Admin > Escalations
**When** the page loads
**Then** I see all failed auto-cancellation attempts and escalated booking issues (FR69)
**And** each escalation shows: booking ID, hotel name, cancellation deadline, failure details, retry history, and escalation timestamp
**And** I can mark escalations as resolved with a resolution note
**And** the page loads within 2 seconds (NFR7)
**Given** I navigate to Admin > Agents
**When** the page loads
**Then** I can view all agent accounts and their status across the platform (FR70)
**And** the list shows: agent name, email, agency (if applicable), status (Active/Inactive), registration date, last login

### Story 10.7: Supplier Issue Escalation Tracking

As the **platform owner**,
I want to track supplier issues by logging support tickets against bookings,
So that I can manage supplier resolution workflows and monitor open escalations.

**Acceptance Criteria:**

**Given** I am viewing a booking in the admin investigation view
**When** I click "Log Supplier Issue"
**Then** I can enter: supplier support ticket reference, issue description, and initial status (Open) (FR72)
**And** the escalation is saved against the booking
**Given** I navigate to Admin > Supplier Issues
**When** the page loads
**Then** I see a dashboard of all supplier escalations with filters: status (Open/Escalated/Resolved), supplier, date range (FR72)
**And** I can update escalation status (Open → Escalated → Resolved) with notes
**And** each status change is logged in the audit trail
**And** open escalation count is visible in the admin dashboard (Story 10.1)

## Epic 11: Agency & Team Features (Fast-Follow)

Super agents can invite and manage sub-agents, configure permissions, set agency markup, and view team activity. Sub-agents can set personal markup and request wallet top-ups when blocked by insufficient credit. All fast-follow features consolidated.

### Story 11.1: Sub-Agent Invitation and Account Creation

As a **super agent**,
I want to invite sub-agents to my agency,
So that my team can use the platform under my agency's umbrella.

**Acceptance Criteria:**

**Given** I am logged in as a super agent
**When** I navigate to Agency > Team Management
**Then** I see a list of my current sub-agents with: name, email, status (Active/Inactive), and last login date
**When** I click "Invite Sub-Agent"
**Then** a form opens requiring: email address and initial permission set
**And** on submit, an invitation email is sent to the specified address with a registration link
**And** if the email already has a pending invitation, the existing invitation is resent (not duplicated) and its 7-day expiry resets; if the email belongs to an existing account (in this agency or another), the invitation is blocked with a clear error message
**And** if invitation email delivery fails (bounce), the invitation status shows "Delivery Failed" with a "Resend" action; super agent is notified of the failure
**And** the invitation is valid for 7 days; expired invitations can be resent
**Given** a sub-agent clicks the invitation link
**When** they complete registration (name, password per NFR12 complexity requirements)
**Then** their account is created under my agency with the specified permissions
**And** their account is tenant-scoped to my agency (agencyId) per architecture
**And** the invitation and account creation are logged in the audit trail (NFR15)
**And** I can invite up to 15 sub-agents per the David persona spec (FR61)

### Story 11.2: Sub-Agent Permission Configuration

As a **super agent**,
I want to configure permissions for each sub-agent,
So that I can control what actions they can perform on the platform.

**Acceptance Criteria:**

**Given** I am viewing a sub-agent's profile in Team Management
**When** I click "Edit Permissions"
**Then** I can configure permission toggles for: search, booking, quote generation, voucher generation, cancellation, and wallet top-up (FR61)
**And** on permission change, all active database sessions for the sub-agent are deleted, forcing re-authentication on next request; if the sub-agent has an active SSE connection, a `session.revoked` event is pushed; the sub-agent sees "Your permissions have changed. Please log in again."
**And** the permission change is logged in the audit trail with: actor (super agent), action (agent.permission-changed), sub-agent ID, previous permissions, new permissions, timestamp (NFR15)
**And** I can deactivate a sub-agent account, which blocks all platform access immediately (FR63)
**And** I can reactivate a previously deactivated sub-agent account (FR63)

### Story 11.3: Agency-Level Markup Configuration

As a **super agent**,
I want to set an agency-level markup applied to all sub-agent pricing,
So that I earn a margin on my sub-agents' bookings.

**Acceptance Criteria:**

**Given** I navigate to Agency > Settings > Markup
**When** I set the agency markup percentage
**Then** the agency markup is applied on top of the platform markup for all sub-agents in my agency (FR52)
**And** the markup percentage supports 0-100% in 0.1% increments
**And** the markup service (Epic 3) calculates: supplier cost → platform markup → agency markup → sub-agent visible cost
**And** sub-agents see only their visible cost (after platform + agency markup) — they cannot see the agency markup percentage or the cost below their layer (NFR14)
**And** the change applies to all subsequent searches and bookings (not retroactive)
**And** the audit trail records: actor (super agent), action (markup.agency-updated), previous percentage, new percentage, timestamp (NFR15)

### Story 11.4: Sub-Agent Personal Markup

As a **sub-agent**,
I want to set my own personal markup on top of my visible cost,
So that I earn my margin when presenting prices to my clients.

**Acceptance Criteria:**

**Given** I am logged in as a sub-agent
**When** I navigate to Settings > Markup
**Then** I can set my personal markup percentage (0-100%, 0.1% increments) (FR53)
**And** the markup service calculates the full chain: supplier cost → platform markup → agency markup → sub-agent personal markup → final client price (FR54)
**And** each layer's calculation is independent and uses the output of the layer below as input
**And** rounding to 2 decimal places (half-up) at each layer
**And** margin accuracy validated to the cent across all active layers for 100% of booking transactions (FR54)
**And** co-located unit tests cover: 4-layer chain with round-half-up at each step, edge cases where rounding at intermediate layers could cause discrepancy, zero markup at any layer, maximum markup (100%) at any layer, and verification that `final_price >= supplier_cost` for all valid inputs
**And** I cannot see the agency markup, platform markup, or supplier cost — only my visible cost and my applied markup (NFR14)

### Story 11.5: Wallet Top-Up Request from Sub-Agent

As a **sub-agent**,
I want to request a wallet top-up from my super agent when blocked by insufficient credit,
So that I can proceed with a booking without waiting for my super agent to notice.

**Acceptance Criteria:**

**Given** I attempt to book a penalized rate and receive a `WALLET_INSUFFICIENT` error
**When** I click "Request Top-Up" on the insufficient balance screen
**Then** a request form opens allowing me to specify: requested amount (pre-filled with shortfall), booking details (hotel, dates, guest), and a note to the super agent (FR25)
**And** the request is submitted and the super agent is notified via in-app notification and email (FR25b)
**Given** the super agent receives the top-up request
**When** they view the request
**Then** they see: sub-agent name, requested amount, booking details, and the sub-agent's note
**And** they can approve (with optional amount adjustment) or reject (with a mandatory reason) (FR25b)
**Given** the super agent approves the request
**When** the approval is processed
**Then** the approved amount is deducted from the super agent's wallet and credited to the sub-agent's wallet as an atomic transfer transaction; both wallet mutations use the same idempotency key; if the super agent's wallet has insufficient balance, the approval fails with a `WALLET_INSUFFICIENT` error showing the super agent's shortfall
**And** the sub-agent receives an in-app notification: "Top-up approved — {amount} added to your wallet"
**And** the sub-agent can proceed with the booking
**Given** the super agent rejects the request
**When** the rejection is processed
**Then** the sub-agent receives an in-app notification: "Top-up request rejected — {reason}"
**And** the request and outcome are logged in the audit trail (NFR15)

### Story 11.6: Sub-Agent Activity Feed

As a **super agent**,
I want to view a filterable activity feed for all my sub-agents,
So that I have operational oversight of my team's platform usage.

**Acceptance Criteria:**

**Given** I navigate to Agency > Activity
**When** the page loads
**Then** I see an activity feed showing across all my sub-agents: searches performed (count per day), quotes generated (with client details), bookings made (with status and value), HCN statuses, and wallet usage (FR62)
**And** the feed is filterable by: sub-agent, date range, and activity type (FR62)
**And** the feed loads within 2 seconds (NFR7)
**And** clicking an activity item navigates to the relevant detail page (booking detail, quote detail, etc.)
**And** all data shown is scoped to my agency only — I cannot see other agencies' data (tenant isolation)
**And** the feed is read-only — I cannot modify sub-agent activities from this view
