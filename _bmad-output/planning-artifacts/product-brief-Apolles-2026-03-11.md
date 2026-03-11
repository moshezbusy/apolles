---
stepsCompleted: [1, 2, 3, 4, 5, 6]
inputDocuments:
  - _bmad-output/planning-artifacts/product-brief-Apolles-2026-03-09.md
  - _bmad-output/planning-artifacts/prd.md
  - _bmad-output/planning-artifacts/epics.md
  - _bmad-output/planning-artifacts/architecture.md
date: 2026-03-11
author: Moshe
revision: lean-rewrite-v3-dual-supplier-alignment
previousBrief: product-brief-Apolles-2026-03-09.md
---

# Product Brief: Apolles (Lean MVP)

---

## Lean Scope Decision Summary

### What Was Cut and Why

| Original Feature | Decision | Rationale |
|---|---|---|
| Wallet system | Cut | Not needed. Agents pay through supplier's existing payment flow. |
| Wallet-gated booking | Cut | No wallet = no gate. |
| Auto-cancellation system | Cut | Massive complexity. Manual cancellation is fine at MVP scale. |
| Voucher queue / batch | Cut | One voucher per booking is enough. |
| HCN verification automation | Cut | Agents verify manually today. Build later when booking volume justifies it. |
| Quote / Itinerary PDF builder | Cut | Big build. Prove the booking flow first. |
| Vervotech hotel mapping / deduplication | Cut | No cross-supplier merging in MVP. Each supplier's results stand alone. Add mapping when deduplication is needed. |
| Hotel mapping management UI | Cut | No mapping = no UI for it. |
| Multi-layer cascading markup | Cut | One simple markup rule is enough for MVP. |
| Full RBAC | Cut | Two roles only: Agent and Admin. No hierarchy. |
| Agent self-registration | Cut | Moshe onboards agents manually. |
| SSE real-time updates | Cut | No features require push updates in MVP. |
| Circuit breaker | Cut | Simple 5-second timeout per supplier, no retry. Sufficient at low volume. |
| PDF invoice generation | Cut | Not needed for search-to-book flow. |
| Profile branding | Cut | No quotes = no branded PDFs. |
| Notification preferences | Cut | Hardcode sensible defaults. |
| Booking modification requests | Cut | Agents contact supplier directly. |
| Advanced admin dashboard | Cut | Replace with minimal admin. |
| Supplier escalation tracking | Cut | Moshe handles support manually. |
| Booking audit trail UI | Cut | Log to database. No UI needed at launch. |
| PCI DSS / SCA / 3D Secure | Scoped to hosted fields | Expedia payment via Stripe hosted payment fields (SAQ A-EP) in MVP. No raw card data on Apolles servers. |
| Multi-room booking | Deferred | One room per booking at MVP. |
| GDPR self-service UI | Cut | Handle manually if requested. |
| Destination autocomplete | Late MVP | Nice to have. Not required for first implementation. |
| Password reset | Late MVP | Moshe can reset passwords manually at first. |
| Booking cancellation action | Late MVP | Show cancellation terms clearly. Actual cancel button can follow shortly after core flow works. |
| Per-agent markup override | Late MVP | Platform markup only at first. Agent-level override can come soon after. |

### What Stays in MVP Core and Why

| Feature | Why It's Core |
|---|---|
| Login | Agents need access. |
| Hotel search form | This is how agents find hotels. |
| Search results | Must show hotels with prices and key info. |
| Room / rate details | Agents must see what they're booking before they book. |
| Booking form | Required to complete a booking with the supplier. |
| Booking summary / review | Agent must confirm details before committing. |
| Booking confirmation | Agent needs the reference number and confirmation. |
| Voucher generation | Agent needs a document to send the client. |
| Reservations list | Agent must see their bookings. |
| Reservation detail page | Full booking info and voucher download. |
| Minimal admin | Moshe needs basic visibility. |
| Supplier logs / error visibility | Moshe needs to debug supplier issues. |
| Dual supplier adapters | TBO Holidays and Expedia Rapid API both active from day one. Common adapter interface. |
| Simple platform markup | Platform needs to make money on bookings. |

---

## Executive Summary

Apolles is a B2B hotel booking platform for travel agents. The MVP delivers the shortest path from hotel search to confirmed booking: search, view rooms, book with guest details, get confirmation, generate a voucher, manage reservations.

The platform launches with two active suppliers from day one: TBO Holidays and Expedia Rapid API. Both are queried in parallel on every search. Results remain supplier-specific with neutral source indicators — no hotel mapping, no deduplication, no cross-supplier merging. Booking continues with the supplier that returned the selected rate. There is no wallet, no quote builder, and no HCN automation in the MVP.

Agents are onboarded manually by the platform owner. The product is built by a non-developer founder using vibe-coding tools. Every MVP feature exists because removing it would break the core search-to-book-to-voucher flow.

---

## Core Vision

### Problem Statement

Travel agents in the B2B hotel market use supplier portals with poor UX, slow workflows, and interfaces designed for suppliers — not agents. They search one portal at a time, deal with clunky booking flows, and lack a single modern tool for their daily work.

### Problem Impact

- **Poor UX**: Existing portals are outdated. Agents tolerate them because nothing better exists.
- **Fragmented workflow**: Searching, booking, and managing reservations are scattered across separate portals.
- **Manual tracking**: Booking management and client communication are handled through documents, messages, and memory.

### Why Existing Solutions Fall Short

- **Hotelbeds, TBO portal, RateHawk**: Functional but dated UX. Each shows only its own inventory.
- **Arbitrip**: Better UX but still single-supplier with limited workflow tools.
- No B2B platform offers a clean, modern agent-first booking experience.

### Proposed Solution

A clean hotel booking interface that connects to supplier APIs and gives agents a fast search-to-book experience.

1. **Search**: Destination, dates, rooms, guests. Results from TBO and Expedia in a modern interface.
2. **Room details**: Bed types, cancellation terms, meal plans, prices — clearly displayed.
3. **Book**: Enter guest names, review, confirm.
4. **Confirmation + voucher**: Reference number and downloadable PDF for the client.
5. **Manage reservations**: List bookings, view details, download vouchers.
6. **Admin**: Platform owner sees bookings, supplier errors, and agent accounts.

### Key Differentiators

- **Modern UX for B2B**: A clean, fast interface in a market where everything else looks like 2010.
- **Multi-supplier from day one**: Two suppliers active at launch. Adding more is additive, not a rewrite.
- **Speed to market**: Ship a working product fast. Layer features based on real feedback.

---

## Target Users

### Primary Users

**Yael — Freelance Travel Agent**
- Independent agent, works alone, 2-10 bookings per day.
- Uses 2-3 supplier portals daily with bad UX.
- Needs: one clean interface to search, book, get a voucher, and track reservations.
- Success: completes search-to-voucher in under 5 minutes.

**Moshe — Platform Owner / Admin**
- Founder and operator. Onboards agents manually. Monitors platform health.
- Needs: see all bookings, check supplier errors, manage agent accounts.

### Secondary Users

**End Client (Traveler)** — never logs in. Receives a voucher from the agent.

### User Journey (MVP)

1. Moshe creates an agent account for Yael.
2. Yael logs in.
3. Yael searches for a hotel (destination, dates, guests).
4. Results from both suppliers appear with neutral source indicators. She reviews hotels, prices, ratings.
5. She selects a hotel, views rooms with cancellation terms and meal plans.
6. She picks a room, enters guest name(s), reviews the summary.
7. She confirms. Confirmation page shows the reference number.
8. She generates a voucher PDF and sends it to the client.
9. She checks her reservations list later to track status.

---

## Success Metrics

### User Success

- Agents complete a full search-to-voucher flow within 5 minutes.
- Agents use Apolles instead of individual supplier portals.
- Booking flow has low drop-off (agents who start a booking finish it).

### Business Objectives

- **3 months**: 5-10 agents onboarded and actively booking.
- **6 months**: 20+ agents using Apolles as their primary booking tool.
- **Revenue**: Platform markup on supplier rates (10-15%).

### Key Performance Indicators

| KPI | Target | Timeframe |
|-----|--------|-----------|
| Agents onboarded | 5-10 | 3 months |
| Agents actively booking | 20+ | 6 months |
| Daily active agents | 50%+ of onboarded | Ongoing |
| Search-to-book time | < 5 minutes | Ongoing |
| Booking flow drop-off | < 20% | Ongoing |
| Platform uptime | 99%+ business hours | Ongoing |
| Supplier API error rate | < 5% | Ongoing |

---

## MVP Scope

### MVP Core (Day One)

These features are the minimum for a working search-to-book product. Nothing here is optional.

**1. Login**
- Email/password authentication
- Session management, logout
- Accounts created by admin (Moshe) — no self-registration

**2. Hotel Search**
- Search form: destination (city name, free text), check-in date, check-out date, rooms, adults per room, children with ages
- Query TBO Holidays and Expedia Rapid API in parallel
- Display results: hotel name, star rating, image, starting price (with markup), neutral source indicator (Source A / Source B)
- Results remain supplier-specific — no mapping, no dedup, no merging
- Client-side filter by: price range, star rating
- Sort by: price, star rating
- If one supplier fails: show results from the responsive supplier + retry action

**3. Room / Rate Details**
- Room list for a selected hotel
- Per room: room name, bed type, cancellation policy (dates and penalties), meal plan, refundability, price
- Taxes and fees shown clearly where the supplier provides them

**4. Booking Form**
- Select a room/rate — booking routed to the originating supplier
- Price recheck with originating supplier before confirming (rate may have changed)
- If price changed: show the updated price and let agent decide to proceed or cancel
- Guest details: full name (required), email, phone, special requests (free text)
- Expedia bookings: card capture via Stripe hosted payment fields (tokenized, SAQ A-EP). No raw card data on Apolles servers.
- TBO bookings: no payment step (credit-based)

**5. Booking Summary / Review**
- Review page showing: hotel, room, dates, guest name(s), total price, cancellation terms
- Agent confirms or goes back to edit

**6. Booking Confirmation**
- Confirmation page: supplier reference number, Apolles booking ID, booking details
- Clear confirmation status

**7. Voucher Generation**
- Generate a PDF voucher for a confirmed booking
- Voucher shows: hotel name, address, check-in/out dates, room type, guest name(s), confirmation number, agent company name
- Download as PDF
- One voucher per booking — no queue, no batch

**8. Reservations List**
- List all agent bookings
- Filter by: status (pending, confirmed, failed, cancelled), date range
- Sort by: date, status
- Search by guest name or booking reference

**9. Reservation Detail Page**
- Full booking info: hotel, dates, room, guest(s), reference numbers
- Current status
- Cancellation terms displayed (what the penalty would be)
- Voucher download or generate button

**10. Minimal Admin**
- **Bookings**: All bookings across all agents. Filter by agent, date, status.
- **Supplier logs**: Recent API calls — method, latency, status, errors. Enough to debug problems.
- **Agents**: List agents, create accounts, deactivate accounts.

**11. Dual Supplier Adapters**
- A common interface implemented by both TBO and Expedia: `search()`, `getRoomDetails()`, `recheckPrice()`, `book()`. Interface also defines `cancel()` and `getBookingDetail()` for forward compatibility (Late MVP).
- TBO adapter: Basic Auth, TBO API v1.4
- Expedia adapter: SHA-512 signature auth, Rapid API v3
- Both adapters normalize to a common Apolles data model
- All supplier API calls logged to the database (supplier, method, latency, status, error)
- 5-second timeout per call
- No merging, no deduplication, no unified hotel IDs. Each supplier's results are independent.
- Adding a third supplier means implementing the same interface — no core changes.

**12. Platform Markup**
- One platform-wide markup percentage set by Moshe
- Applied to all supplier rates before the agent sees them
- Agent sees the marked-up price as their cost
- Client price = agent's cost (no per-agent markup override at launch)
- Agents see neutral source indicators (Source A / Source B) — no supplier names
- Admin sees full supplier identity

### Late MVP / Phase 1.5

Features to add shortly after the core flow is working and stable. Not day-one blockers.

| Feature | Notes |
|---------|-------|
| **Password reset** | Email-based reset flow. Until then, Moshe resets passwords manually. |
| **Destination autocomplete** | Debounced autocomplete on the search destination field. Until then, agents type city names. |
| **Booking cancellation action** | Cancel button on reservation detail page with penalty display and confirmation. Cancellation terms are already visible in MVP Core — this adds the action. |
| **Per-agent markup override** | Let each agent set their own markup on top of the platform price. Adds one layer: supplier cost -> platform markup -> agent markup -> client price. |
| **Multi-room booking** | Support more than one room per booking. |

### Phase 2

Features that require the core product to be validated first.

| Feature | Why Phase 2 |
|---------|-------------|
| **Vervotech hotel mapping / deduplication** | Enables cross-supplier merging so the same hotel from different suppliers appears as one result. Not needed while results are supplier-specific. |
| **Unified hotel view** | Single hotel card with rates from multiple suppliers. Requires mapping. |
| **HCN verification automation** | Strong differentiator. Build when booking volume justifies the effort. |
| **Quote / Itinerary PDF builder** | Strong differentiator. Build when agents request it and the booking flow is stable. |
| **Wallet system** | If the business model shifts to prepaid credit. Not needed while existing supplier payment flows work. |
| **Agent self-registration** | When manual onboarding becomes a bottleneck. |
| **Booking modification requests** | When "contact supplier directly" becomes too frequent. |
| **Voucher queue / batch** | When agents handle enough volume to need batch workflows. |

### Future Ideas

Features that are not planned for any near-term phase. Build only if the product reaches a stage where they matter.

| Feature | Notes |
|---------|-------|
| Full RBAC (super agent / sub agent) | Only if agencies adopt the platform. |
| Agency team management | Depends on RBAC. |
| Auto-cancellation of unvouchered bookings | Complex system. Consider at significant booking volume. |
| AI conversational search | Long-term vision. |
| Agoda / TravelgateX / channel managers | Supplier expansion, commercially driven. |
| Advanced analytics / dashboards | When data volume justifies it. |
| White-label / multi-brand | Enterprise feature. |
| Mobile app | Web-responsive is sufficient for a long time. |
| Multi-currency | When international agents are onboarded. |
| Notification preferences | When notification volume warrants control. |
| Profile branding / logo | When quote builder exists. |
| Invoice generation | When bookkeeping becomes a need. |
| SSE real-time updates | When features require push. |
| Circuit breaker | When supplier volume creates reliability concerns. |
| Hotel mapping management UI | When mapping is active and needs admin oversight. |

---

## Technical Guidance (Lean)

This section provides minimal technical direction to keep the build simple.

**Stack**: Next.js App Router, TypeScript, Tailwind CSS, Prisma, PostgreSQL, NextAuth.js. Standard T3-stack setup.

**No heavy infrastructure at MVP**: No Redis, no Inngest, no SSE, no pub/sub, no job queues. Add infrastructure only when a specific feature requires it.

**Supplier adapters**: A TypeScript interface with two implementations at MVP: TBO Holidays (Basic Auth) and Expedia Rapid API (SHA-512 signature auth). The search service calls both in parallel via `Promise.allSettled()`. The booking flow calls the interface, not the supplier directly.

**Markup**: A single percentage value stored in the database. Applied server-side to all supplier rates before returning to the client. No calculation engine, no multi-layer chain.

**PDF voucher**: Server-side PDF generation (e.g., @react-pdf/renderer). One template. Renders hotel/guest/dates/confirmation info.

**Supplier logs**: A database table logging every supplier API call. Admin page reads from this table with basic filtering.

**Auth**: NextAuth.js with database sessions. Admin creates agent accounts directly. No registration flow, no email verification.

**Keep it simple**: If a decision feels like over-engineering for 5-10 agents, it probably is. Build the simplest version that works. Add complexity only when real usage demands it.
