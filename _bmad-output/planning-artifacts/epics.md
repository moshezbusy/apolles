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
