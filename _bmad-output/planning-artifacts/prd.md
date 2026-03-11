---
stepsCompleted: [step-01-init, step-02-discovery, step-02b-vision, step-02c-executive-summary, step-03-success, step-04-journeys, step-05-domain, step-06-innovation, step-07-project-type, step-08-scoping, step-09-functional, step-10-nonfunctional, step-11-polish]
inputDocuments:
  - _bmad-output/planning-artifacts/product-brief-Apolles-2026-03-11.md
workflowType: 'prd'
classification:
  projectType: saas_b2b
  secondaryType: api_backend
  domain: traveltech
  complexity: medium
  projectContext: greenfield
  complianceNotes:
    - TBO API certification required
    - Expedia Rapid API B2B site review and certification required
    - Expedia B2B display requirements (tax disclaimers, cancellation policies, check-in instructions, payment processing country)
    - PCI DSS scope determination required for Expedia payment flows
    - SCA / 3D Secure required for Expedia bookings with European card payments
    - Supplier-specific display requirements (cancellation policies, tax breakdowns)
lastEdited: '2026-03-11'
editHistory:
  - date: '2026-03-11'
    changes: 'Full PRD rewrite to align with approved lean product brief (2026-03-11). Removed enterprise complexity, wallet, HCN automation, quote builder, hotel mapping, deduplication, RBAC hierarchy, self-registration, and all non-MVP requirements. Scope now reflects dual-supplier lean MVP (TBO + Expedia) with simple platform markup, no mapping, no dedup, and supplier-specific results.'
  - date: '2026-03-11'
    changes: 'Correction: Expedia Rapid API moved into MVP Core. MVP is dual-supplier from day one. No hotel mapping or deduplication in MVP — supplier results displayed independently. Expedia-specific compliance (B2B site review, PCI, SCA) now in MVP scope.'
  - date: '2026-03-11'
    changes: 'Tightening edits: (1) Added neutral source indicator for agent UX (supplier branding hidden, Source A/B labels for result disambiguation). (2) Narrowed Expedia payment to single path only (hosted fields + tokenization, no alternatives). (3) Added booking lifecycle state model (pending, price_changed, confirmed, failed, cancelled). (4) Added explicit price chain source of truth table (supplier base -> markup -> agent price -> confirmed amount -> voucher amount). (5) Made supplier-specific result model explicit (no UnifiedHotel entity, FR49-FR52).'
---

# Product Requirements Document - Apolles (Lean MVP)

**Author:** Moshe
**Date:** 2026-03-11

## PRD Rewrite Summary

This PRD is a complete rewrite aligned to the approved lean product brief dated 2026-03-11. The previous PRD described a multi-supplier enterprise platform with hotel mapping, deduplication, wallet systems, quote builders, HCN automation, cascading markup chains, and RBAC hierarchies. That scope has been decisively cut.

This PRD describes a lean MVP: a dual-supplier B2B hotel booking platform where travel agents search TBO Holidays and Expedia Rapid API, view rooms, book with guest details, get confirmation, generate a voucher, and manage reservations. Both suppliers are live from day one. Results from each supplier are displayed independently — no hotel mapping, no deduplication, no cross-supplier merging. Booking continues with whichever supplier returned the selected rate. One platform-wide markup. No wallet. No quote builder. No HCN automation.

**Key changes from previous PRD:**
- Removed Vervotech hotel mapping and deduplication (no cross-supplier merging in MVP)
- Removed wallet system and wallet-gated booking
- Removed auto-cancellation of unvouchered bookings
- Removed quote/itinerary PDF builder
- Removed HCN verification automation
- Removed multi-layer cascading markup (one platform-wide percentage only)
- Removed full RBAC (two roles only: Agent and Admin)
- Removed agent self-registration (manual onboarding)
- Removed voucher queue and batch operations
- Removed booking modification requests
- Removed advanced admin dashboard
- Kept both TBO and Expedia as MVP suppliers (Expedia is NOT deferred)
- Added Expedia-specific compliance requirements (B2B site review, PCI, SCA)

---

## Executive Summary

Apolles is a B2B hotel booking platform for travel agents. The MVP delivers the shortest path from hotel search to confirmed booking: search, view rooms, book with guest details, get confirmation, generate a voucher, manage reservations.

The platform launches with two suppliers from day one: TBO Holidays and Expedia Rapid API. Both are queried in parallel on every search. Results from each supplier are displayed independently — there is no hotel mapping, no deduplication, and no cross-supplier merging in MVP. The same physical hotel may appear twice (once from each supplier) and that is acceptable. When an agent selects a rate, booking continues with whichever supplier returned that rate.

There is no wallet, no quote builder, and no HCN automation. Agents are onboarded manually by the platform owner (Moshe). There is no public registration and no approval workflow. The product is built by a non-developer founder using vibe-coding tools. Every MVP feature exists because removing it would break the core search-to-book-to-voucher flow.

### What Makes This Special

Two things differentiate Apolles at MVP:

1. **Modern UX for B2B hotel booking** — A clean, fast interface in a market where every existing tool (Hotelbeds, TBO portal, RateHawk, Arbitrip) looks and feels like 2010. Agents get a responsive, well-designed booking experience that respects their time.

2. **Two suppliers in one search** — Agents search once and see results from both TBO and Expedia. No tab-switching between portals. Results are supplier-specific (not merged), but the convenience of one search across two inventories is immediate value. Each supplier is accessed through a common adapter interface, keeping the codebase clean.

The core insight: the B2B hotel distribution market is large and established, but tools are built for suppliers, not agents. Apolles is built around how agents actually work — and ships the simplest version that proves this thesis. The simplification comes from removing mapping and merging complexity, not from removing suppliers.

### Project Classification

- **Project Type:** B2B SaaS platform with API integration backend
- **Domain:** Travel Technology (B2B hotel distribution)
- **Complexity:** Medium — dual supplier integration (TBO + Expedia), Expedia B2B site review certification, standard auth, simple markup, PDF generation
- **Project Context:** Greenfield — building from scratch, no existing codebase

---

## Success Criteria

### User Success

- **Search-to-voucher speed**: Agents complete a full search-to-voucher flow within 5 minutes.
- **Tool replacement**: Agents use Apolles instead of separate TBO and Expedia portals for their daily booking work.
- **Booking flow confidence**: Agents complete bookings without confusion about pricing, cancellation policies, or room details. Clear display of cancellation terms and total cost at every step.
- **Low drop-off**: Agents who start a booking complete it. Target: less than 20% drop-off rate in the booking flow.

### Business Success

- **3-month milestone**: 5-10 agents onboarded and actively booking through Apolles.
- **6-month milestone**: 20+ agents using Apolles as their primary booking tool.
- **Revenue**: Platform markup on supplier rates (10-15%), generating revenue from day one.
- **Agent retention**: 50%+ of onboarded agents logging in daily during business hours.

### Technical Success

- **Search response time**: Combined search results from TBO and Expedia returned within 5 seconds for 95th percentile of queries. First supplier results displayed as soon as they arrive; second supplier results appended when ready.
- **Supplier integration stability**: Per-supplier API error rate below 5% under normal conditions for both TBO and Expedia.
- **Expedia B2B certification**: Pass Expedia site review before production launch. This is a hard gate — no production Expedia bookings until certification is complete.
- **Platform uptime**: 99%+ availability during business hours (when agents are actively booking).
- **Zero data loss**: No confirmed bookings or financial transactions lost under any single-point failure.

### Measurable Outcomes

| Metric | Target | Timeframe | How Measured |
|--------|--------|-----------|--------------|
| Agents onboarded | 5-10 | 3 months | Created accounts with at least 1 booking |
| Agents actively booking | 20+ | 6 months | Agents with bookings in the last 7 days |
| Daily active agents | 50%+ of onboarded | Ongoing | Agents logging in daily |
| Search-to-book time | < 5 minutes | Ongoing | Time from first search to booking confirmation |
| Booking flow drop-off | < 20% | Ongoing | Started bookings vs. completed bookings |
| Platform uptime | 99%+ | Ongoing | Business hours availability |
| Supplier API error rate | < 5% per supplier | Ongoing | Failed API calls / total calls, per supplier |
| Search response time | < 5 seconds (p95) | Ongoing | Time to return combined results from both suppliers |
| Expedia site review | Pass before launch | Pre-launch | Certification from Expedia team |

---

## Product Scope & Phased Development

### MVP Strategy

**MVP Approach:** Lean product MVP — deliver the minimum complete agent workflow (search -> view rooms -> book -> confirm -> voucher -> manage reservations) with two suppliers (TBO + Expedia) from day one. An agent can search both inventories in a single action and do their core hotel booking job on Apolles.

**Why this scope:** Travel agents won't adopt a tool that handles only search or only booking management. The flow must be complete from search to voucher. Two suppliers from day one means broader inventory and immediate value over any single-portal experience. The simplification comes from removing mapping and merging complexity — not from removing suppliers. Results from each supplier are displayed independently. No hotel mapping, no deduplication, no cross-supplier merging. The same hotel may appear twice and that is acceptable at MVP.

**Core User Journeys Supported at MVP:**
- Agent daily booking flow (search, book, confirm, voucher, manage)
- Admin operations (bookings, agents, supplier health)

**Resource Requirements:** Solo non-developer founder using vibe-coding tools. Standard T3-stack (Next.js, TypeScript, Tailwind, Prisma, PostgreSQL, NextAuth.js).

### MVP Core (Day One)

These features are the minimum for a working search-to-book product. Nothing here is optional.

| # | Feature | Rationale |
|---|---------|-----------|
| 1 | Login | Agents need access |
| 2 | Hotel search form | How agents find hotels |
| 3 | Search results | Must show hotels with prices and key info |
| 4 | Room / rate details | Agents must see what they're booking before they book |
| 5 | Booking form | Required to complete a booking with the supplier |
| 6 | Booking summary / review | Agent must confirm details before committing |
| 7 | Booking confirmation | Agent needs reference number and confirmation |
| 8 | Voucher generation | Agent needs a document to send the client |
| 9 | Reservations list | Agent must see their bookings |
| 10 | Reservation detail page | Full booking info and voucher download |
| 11 | Minimal admin | Moshe needs basic visibility |
| 12 | Supplier logs / error visibility | Moshe needs to debug supplier issues |
| 13 | Supplier adapters (TBO + Expedia) | Both suppliers live from day one behind a common interface |
| 14 | Platform markup | Platform needs to make money on bookings |

**Explicitly NOT in MVP:**
- Hotel mapping / deduplication
- Cross-supplier hotel merging or unified hotel view
- Best-rate merge across suppliers
- Advanced ranking logic across suppliers
- Wallet system
- Wallet-gated booking
- Auto-cancellation of unvouchered bookings
- Quote / itinerary PDF builder
- HCN verification automation
- Agent self-registration
- Registration approval workflow
- Full RBAC (super agent / sub agent hierarchy)
- Multi-layer cascading markup
- Booking approval workflow
- Agency team management
- Booking modification requests
- Advanced admin dashboard
- Invoice generation
- Notification preferences
- Profile branding
- SSE real-time updates
- Circuit breaker pattern
- Multi-room booking

### Late MVP / Phase 1.5

Features to add shortly after the core flow is working and stable. Not day-one blockers.

| Feature | Notes |
|---------|-------|
| **Password reset** | Email-based reset flow. Until then, Moshe resets passwords manually. |
| **Destination autocomplete** | Debounced autocomplete on the search destination field. Until then, agents type city names as free text. |
| **Booking cancellation action** | Cancel button on reservation detail page with penalty display and confirmation. Cancellation terms are already visible in MVP Core — this adds the action. |
| **Per-agent markup override** | Let each agent set their own markup on top of the platform price. Adds one layer: supplier cost -> platform markup -> agent markup -> client price. |
| **Multi-room booking** | Support more than one room per booking. |

### Phase 2

Features that require the core product to be validated first.

| Feature | Why Phase 2 |
|---------|-------------|
| **Vervotech hotel mapping / deduplication** | Merge the same physical hotel from TBO and Expedia into a single result with rate comparison. Not needed while supplier-specific results are acceptable. |
| **Unified hotel view across suppliers** | Single hotel card showing rates from multiple suppliers side by side. Requires hotel mapping. |
| **Best-rate merge / cross-supplier ranking** | Highlight the cheapest rate across suppliers for the same hotel. Requires mapping and deduplication. |
| **HCN verification automation** | Strong differentiator. Build when booking volume justifies the effort. |
| **Quote / itinerary PDF builder** | Strong differentiator. Build when agents request it and the booking flow is stable. |
| **Wallet system** | If the business model shifts to prepaid credit. Not needed while existing supplier payment flows work. |
| **Agent self-registration** | When manual onboarding becomes a bottleneck. |
| **Booking modification requests** | When "contact supplier directly" becomes too frequent. |
| **Voucher queue / batch** | When agents handle enough volume to need batch workflows. |

### Future Ideas (Out of Scope)

Features not planned for any near-term phase.

| Feature | Notes |
|---------|-------|
| Full RBAC (super agent / sub agent) | Only if agencies adopt the platform |
| Agency team management | Depends on RBAC |
| Auto-cancellation of unvouchered bookings | Complex system. Consider at significant booking volume. |
| AI conversational search | Long-term vision |
| Agoda / TravelgateX / channel managers | Supplier expansion, commercially driven |
| Advanced analytics / dashboards | When data volume justifies it |
| White-label / multi-brand | Enterprise feature |
| Mobile app | Web-responsive is sufficient for a long time |
| Multi-currency | When international agents are onboarded |
| Notification preferences | When notification volume warrants control |
| Profile branding / logo | When quote builder exists |
| Invoice generation | When bookkeeping becomes a need |
| SSE real-time updates | When features require push |
| Circuit breaker | When supplier volume creates reliability concerns |

### Risk Mitigation Strategy

**Technical Risks:**

| Risk | Severity | Mitigation |
|------|----------|------------|
| Supplier API latency / downtime (TBO or Expedia) | Medium | 5-second timeout per call per supplier. Simple retry (1 retry). If one supplier fails, show results from the other. Clear indicator of which supplier(s) are unavailable. |
| Expedia B2B site review rejection | High | Build to Expedia display requirements from day one. Submit early for feedback. Budget 4-6 weeks for the review cycle. |
| Supplier rate volatility | Medium | Price recheck before every booking. Clear communication of price changes to agent before confirmation. |
| PCI DSS scope for Expedia | Medium | Use tokenized payment via a PCI-certified gateway (e.g., Stripe hosted fields). Minimize card data handling. Target SAQ-A or SAQ A-EP. |
| PDF voucher generation issues | Low | Server-side generation with simple template. Fallback: display voucher info on-screen for manual copy. |

**Market Risks:**

| Risk | Severity | Mitigation |
|------|----------|------------|
| Agents won't switch from existing portals | High | Modern UX + two suppliers in one search is the differentiator. Target agents who already complain about portal UX. Get 5 agents using it and iterate on feedback. |
| Duplicate results confuse agents | Medium | Acceptable at MVP. Results are labeled by source context (without revealing supplier name). Phase 2 mapping eliminates duplicates. |

**Resource Risks:**

| Risk | Severity | Mitigation |
|------|----------|------------|
| Solo non-developer founder | High | Vibe-coding tools reduce implementation complexity. Lean scope means fewer features to build. Standard T3-stack has extensive community support and documentation. |
| TBO API onboarding takes longer than expected | Medium | Begin API certification immediately. Build against test endpoint in parallel. |
| Expedia partner approval takes longer than expected | Medium | Begin partner application immediately. Develop against Expedia test endpoint in parallel. If Expedia is delayed, launch TBO-only and add Expedia when approved — the adapter architecture supports this. |

---

## User Journeys

### Journey 1: Yael — Freelance Agent, Daily Booking Flow (Primary User, Happy Path)

**Opening Scene:** It's 8:30 AM. Yael, a freelance travel agent working from her home office in Tel Aviv, opens WhatsApp to find a message from a client. A couple wants a romantic week in Santorini. Before Apolles, Yael would open the TBO portal, then the Expedia partner portal — two cluttered interfaces, two logins, two separate searches. She'd compare results manually, copy hotel names and prices into a WhatsApp message, and hope she didn't make an error. Today, she opens Apolles.

**Rising Action:** Yael types "Santorini" in the search bar, selects dates, 2 adults, 1 room. Within a few seconds, results start appearing from both suppliers. She sees more options than either portal would show alone. Some hotels appear twice (one from each supplier) at different prices — she can compare easily. Clean layout. She filters by 4+ stars, sorts by price. She spots a great option and clicks in to see rooms: bed type, cancellation policy with clear dates and penalties, meal plan, refundability, total price with taxes shown. No guessing.

She picks a room with free cancellation until March 25. She clicks "Book." The system rechecks the price with the supplier that offered this rate — still the same. She enters the guest name, reviews the booking summary: hotel, room, dates, guest name, total price, cancellation terms. Everything is visible on one screen.

**Climax:** She confirms the booking. Confirmation page shows: supplier reference number, Apolles booking ID, hotel details, dates, room type. She clicks "Generate Voucher." A clean PDF appears: hotel name, address, check-in/out dates, room type, guest name, confirmation number. She sends it to the client via WhatsApp.

**Resolution:** By 8:45 AM — 15 minutes — Yael has searched two suppliers, booked, and sent the voucher. One search, one interface. No tab-switching between portals. No copy-pasting. She checks her reservations list later to confirm the status. She'll use Apolles again tomorrow.

---

### Journey 2: Yael — Price Change During Booking (Primary User, Edge Case)

**Opening Scene:** Yael found a hotel for a client at a great rate. She clicks "Book" and enters the guest details.

**Rising Action:** The system runs a price recheck with the supplier before confirming. The rate has increased by $30 per night — the original rate is no longer available.

**Climax:** Apolles displays the updated price clearly: "The price has changed since your search. New total: $X (was $Y)." Yael sees the difference and decides whether to proceed at the new price or go back to search for alternatives.

**Resolution:** Yael decides to proceed. She confirms at the new price. Booking completes normally. No surprise charges. No confusion. The system told her exactly what changed before she committed.

---

### Journey 3: Moshe — Platform Admin, Monitoring & Agent Management (Admin/Ops)

**Opening Scene:** Moshe is the platform owner. It's Monday morning. He opens the Apolles admin panel to check on the platform.

**Rising Action:** He checks the bookings section — sees all bookings across all agents. Filters by last 7 days. 18 bookings completed — some through TBO, some through Expedia. He checks the supplier logs — recent API calls to both suppliers with method, latency, status, and any errors. TBO had a few slow responses over the weekend. Expedia has been stable. He checks the agents section — 8 active agents. One hasn't logged in for a week; he makes a note to follow up.

**Climax:** An agent contacts him — a booking shows "confirmed" but the hotel says they don't have the reservation. Moshe opens the booking detail, sees the supplier reference number and which supplier handled the booking, checks the supplier log for that specific booking call. He contacts the supplier's support with the reference. The supplier confirms a system error on their side and reprocesses.

**Resolution:** Moshe resolves the issue within an hour. The supplier logs gave him everything he needed to debug. He has enough visibility to keep the platform running without a dedicated ops team.

---

### Journey Requirements Summary

| Journey | Key Capabilities Revealed |
|---------|--------------------------|
| **Yael - Daily Flow** | Dual-supplier hotel search, results display with filter/sort, room/rate details with cancellation terms, booking with the supplier that returned the rate, price recheck, booking confirmation, voucher PDF generation, reservations list |
| **Yael - Price Change** | Price recheck before booking, clear price change communication, agent decision point (proceed or cancel) |
| **Moshe - Admin** | All-bookings view with filters, per-supplier API logs with error visibility, agent account management (list, create, deactivate), booking investigation with supplier identification |

---

## Domain-Specific Requirements

### TBO API Integration Requirements

- **TBO API certification**: Must complete TBO's integration testing and certification process per their API specifications.
- **API flow**: HotelSearch -> PreBook (price recheck) -> Book -> BookingDetail -> Cancel. Payment mode: Limit (credit-based, via TBO's existing payment arrangement).
- **Authentication**: REST API with Basic Auth.
- **Display requirements**: Until TBO display requirements are confirmed during certification, display cancellation policies, tax breakdowns, and booking terms clearly on all relevant screens.

### Expedia Rapid API Integration Requirements

- **Expedia B2B site review**: Hard gate to production. Must pass site review covering: price display (tax breakdowns with legally mandated text), cancellation policy display, check-in instructions, SCA compliance, payment processing country display, downstream agent T&C acceptance, PCI compliance evidence. Failure = no production API key.
- **API flow**: Shopping -> Price Check -> Booking -> Management. REST with SHA-512 signature auth.
- **Expedia terms propagation**: Agents must agree to Expedia's Agent Terms and Conditions before accessing Expedia inventory. Link to agent agreement must be provided.
- **Tax disclaimer requirements**: Legally mandated text for Expedia taxes and fees: "The taxes are tax recovery charges paid to vendors (e.g. hotels); for details, please see our Terms of Use. Service fees are retained as compensation in servicing your booking and may include fees charged by vendors."
- **Partner charge labeling**: Apolles service charges must be labeled "affiliate booking charge" or "affiliate service charge" — never use the word "fee" for partner-imposed charges (Expedia requirement).
- **MVP payment path (single path only)**: Expedia bookings use one payment method at MVP: tokenized card capture via PCI-certified hosted payment fields (e.g., Stripe Elements). The agent enters card details in a hosted iframe that returns a token. Apolles passes the token to Expedia. No alternative payment orchestration paths in MVP (no direct card processing, no saved cards, no bank transfers, no Expedia virtual cards). This is the only Expedia payment flow.
- **PCI DSS scope**: Hosted payment fields keep Apolles out of full PCI scope. Target SAQ-A or SAQ A-EP. Apolles does not store, process, or transmit raw cardholder data. Apolles stores only: payment gateway token references, last-4 digits (for display), and transaction confirmation IDs.
- **SCA / 3D Secure**: For Expedia bookings involving European card payments, SCA (Strong Customer Authentication) may be required. When required: redirect to 3D Secure challenge. When exempt: process directly. Fallback: if exemption is rejected, escalate to full SCA flow.

### Supplier Visibility & Source Indicators

- **Supplier branding hidden from agents**: No supplier name (TBO, Expedia) is ever shown in the agent-facing UI. No supplier logos, no supplier-branded labels.
- **Neutral source indicator**: Because the same physical hotel may appear more than once (from different suppliers), agents need a way to distinguish result sources. Each result is labeled with a neutral source tag such as "Source A" / "Source B" (or equivalent non-branded indicator). The label is consistent per supplier within a search session — all TBO results share one label, all Expedia results share another — but the label itself does not reveal the supplier identity.
- **Admin sees full supplier identity**: Admin views (bookings, logs, booking detail) display the actual supplier name (TBO / Expedia) for every result and booking. This is admin-only data.
- **Cancellation policies**: Display dates and penalty amounts clearly on room details, booking summary, and reservation detail pages — for both suppliers.
- **Tax and fee display**: Show taxes and fees as provided by each supplier. For Expedia rates, include the legally mandated tax disclaimer text. For TBO, display as provided.
- **Dynamic legal text rendering**: The system must display the correct legal disclaimers and tax text based on the supplier sourcing each rate. Expedia rates show Expedia's mandated text. TBO rates show TBO-specific text (per TBO certification requirements). Voucher PDFs include the applicable supplier's legally mandated text even though the supplier identity is hidden from the agent.

### Data Handling

- **Agent PII**: Name, email, phone, company. Stored for account lifetime.
- **Traveler PII**: Guest name, email, phone, special requests. Stored for booking lifetime + 3 years (dispute resolution).
- **Booking data**: Hotel, dates, confirmation numbers, supplier reference, status, cancellation history. Stored for 7 years (financial record).
- **Payment card data (Expedia flows)**: Apolles does not store raw cardholder data. All card operations delegated to PCI-certified payment gateway using tokenization (hosted payment fields). Apolles stores only: payment gateway token references, last-4 digits (for display), and transaction confirmation IDs.
- **Data minimization**: Collect only data necessary for booking fulfillment. No passport numbers.
- **Data isolation**: Agent data is tenant-isolated. No agent can access another agent's bookings or data.

### Pricing Model

- **Single platform markup**: One percentage value set by Moshe. Applied server-side to all supplier rates (TBO and Expedia) before returning to the agent.
- **Agent sees marked-up price as their cost**: No visibility into supplier cost or platform margin.
- **Client price = agent's cost**: No per-agent markup override at MVP launch.
- **Supplier identity hidden**: Agent never knows which supplier provides the rate.

**Price chain (source of truth at each stage):**

| Stage | Amount | Source of Truth | Who Sees It |
|-------|--------|----------------|-------------|
| Supplier base amount | Raw rate returned by TBO or Expedia API | Supplier API response | Admin only |
| Platform markup | Percentage applied to supplier base amount | Admin-configured markup value | Admin only |
| Agent-visible price | Supplier base + platform markup | Calculated server-side, returned to client | Agent (shown as "total price") |
| Post-recheck price | Agent-visible price recalculated after price recheck with supplier | Supplier price recheck API response + markup | Agent (shown on price change screen if changed) |
| Confirmed booked amount | The agent-visible price at the moment of confirmed booking | Stored on the booking record at confirmation time | Agent (on confirmation page, reservation detail, voucher) |
| Voucher amount | Same as confirmed booked amount | Booking record | Agent + end client (on PDF voucher) |

**Rules:**
- The confirmed booked amount is immutable once the booking is confirmed. It does not change retroactively if the markup percentage is later adjusted.
- The voucher always shows the confirmed booked amount, never a recalculated value.
- If price recheck returns a different supplier base amount, the agent sees the updated agent-visible price and must explicitly accept before the booking proceeds.

---

## Innovation & Novel Patterns

### Detected Innovation Areas

**1. Modern UX for B2B hotel booking (Execution innovation)**

This is not a technology breakthrough — it's an execution gap. Every existing B2B hotel booking portal (Hotelbeds, TBO, RateHawk, Arbitrip) has a dated, supplier-centric UX. Apolles delivers a clean, modern, agent-first booking experience. The innovation is building what should exist but doesn't.

**2. Two suppliers, one search, no mapping complexity (Lean multi-supplier)**

Apolles queries TBO and Expedia in parallel and presents results in a single view — without the complexity of hotel mapping, deduplication, or cross-supplier merging. Results are supplier-specific and may include the same hotel twice. This is a deliberate tradeoff: agents get broader inventory from day one, while the platform avoids the most complex piece of multi-supplier integration (Vervotech mapping, confidence scoring, false merge prevention). The adapter pattern keeps each supplier behind a common interface.

### Market Context & Competitive Landscape

| Competitor | UX Quality | Multi-supplier | Agent Workflow Tools |
|------------|-----------|----------------|---------------------|
| TBO Portal | Poor | No (own inventory) | Minimal |
| Hotelbeds | Dated | No (own inventory) | Minimal |
| RateHawk | Functional | No (own inventory) | Basic |
| Arbitrip | Better | No (own inventory) | Limited |
| **Apolles MVP** | **Modern** | **Yes (TBO + Expedia, no dedup)** | **Core booking flow** |

The competitive gap at MVP is UX quality plus two suppliers in one search. No competitor offers both inventories in a single agent-facing interface. Hotel mapping and deduplication are Phase 2 enhancements; agent workflow tools (quotes, HCN) are also Phase 2.

### Validation Approach

| Innovation | Validation Method | Timeline |
|---|---|---|
| Modern UX | Do agents prefer Apolles over separate supplier portals? Measure retention and daily active usage. | MVP |
| Dual-supplier single search | Do agents value seeing TBO + Expedia in one view, even without deduplication? Measure search-to-book conversion and agent feedback on duplicates. | MVP |
| Adapter architecture | Does adding a third supplier require only implementing the interface? Validate when a third supplier is considered. | Phase 2+ |

---

## B2B SaaS Specific Requirements

### Multi-Tenancy Model

- **Tenant type**: Individual agent account only. No agency/team model at MVP.
- **Data isolation**: Complete. Agents cannot see other agents' bookings or data.
- **Platform-level access**: Moshe (admin) has cross-tenant visibility for operations and support.
- **Tenant provisioning**: Admin-only. Moshe creates agent accounts directly. No self-registration.

### Role Model (MVP)

Two roles only. No hierarchy.

| Permission | Admin (Moshe) | Agent |
|---|---|---|
| Search hotels | Yes | Yes |
| View room/rate details | Yes | Yes |
| Book reservations | Yes | Yes |
| View booking confirmation | Yes | Yes (own bookings) |
| Generate vouchers | Yes | Yes (own bookings) |
| View reservations list | Yes (all agents) | Yes (own bookings) |
| View reservation detail | Yes (all agents) | Yes (own bookings) |
| Download voucher PDF | Yes | Yes (own bookings) |
| View supplier identity (TBO/Expedia) | Yes | No (sees neutral source indicator only) |
| View supplier cost price | Yes | No |
| View platform markup | Yes | No |
| Set platform markup | Yes | No |
| View all bookings (all agents) | Yes | No |
| View supplier logs | Yes | No |
| Manage agent accounts | Yes | No |

### Business Model

- **No subscription tiers** — all agents get the same feature set.
- **Revenue model**: Platform markup on all supplier rates (10-15%).
- **No wallet**: TBO handles payment through existing credit arrangement. Expedia handles payment through their Merchant of Record model (card tokenization). Agents do not prepay or maintain a balance.
- **Manual onboarding**: Moshe creates accounts for agents he wants on the platform.

### Integration List

| Integration | Purpose | Phase |
|---|---|---|
| TBO Holidays API v1.4 | Hotel search, price recheck, booking, booking detail, cancellation | MVP Core |
| Expedia Rapid API v3 | Hotel search, price check, booking, management | MVP Core |
| Payment gateway (Stripe/similar) | Tokenized card payments for Expedia bookings (hosted fields, no raw card storage) | MVP Core |
| PDF generation (e.g., @react-pdf/renderer) | Voucher PDF generation | MVP Core |
| NextAuth.js | Authentication and session management | MVP Core |
| Vervotech Hotel Mapping API | Cross-supplier hotel deduplication | Phase 2 |
| Email service (SendGrid/SES) | Password reset emails | Late MVP |

---

## Functional Requirements

### Authentication & Accounts

- **FR1**: Agent can log in with email and password
- **FR2**: Agent can log out, ending their session
- **FR3**: Admin can create a new agent account with name, email, and initial password
- **FR4**: Admin can deactivate an agent account, preventing login
- **FR5**: Admin can view a list of all agent accounts with status (active/inactive)

### Hotel Search

- **FR6**: Agent can search for hotels by destination (city name, free text), check-in date, check-out date, number of rooms (1 at MVP), adults per room, and children with ages
- **FR7**: System queries both TBO Holidays and Expedia Rapid APIs in parallel and returns combined results displaying: hotel name, star rating, image, starting price (with platform markup applied)
- **FR7a**: Results from each supplier are displayed independently. The same physical hotel may appear more than once (once per supplier). No deduplication or merging in MVP. Each result carries a neutral source indicator (e.g., "Source A" / "Source B") so agents can distinguish origins without seeing supplier branding.
- **FR8**: Agent can filter search results by price range and star rating
- **FR9**: Agent can sort search results by price or star rating
- **FR10**: If one supplier API fails or times out (5-second timeout), the system displays results from the responsive supplier(s), shows a visible indicator that one supplier is unavailable, and provides a "Retry" action for the failed supplier
- **FR10a**: If both suppliers fail, the system displays a clear error message and a "Retry All" action

### Room / Rate Details

- **FR11**: Agent can view a list of rooms for a selected hotel
- **FR12**: Each room displays: room name, bed type, cancellation policy (dates and penalty amounts), meal plan, refundability status, and total price (with markup applied)
- **FR13**: Taxes and fees are shown as provided by each supplier. For Expedia rates, the legally mandated tax disclaimer text is displayed.

### Booking Flow

- **FR14**: Agent can select a room/rate and proceed to booking. Booking is routed to whichever supplier returned the selected rate.
- **FR15**: System performs a price recheck with the originating supplier (TBO or Expedia) before confirming the booking
- **FR16**: If the price changed since search, the system displays the updated price and lets the agent decide to proceed or cancel
- **FR17**: Agent can enter guest details: full name (required), email (optional), phone (optional), special requests (free text, optional)
- **FR17a**: For Expedia bookings: system collects card details via PCI-certified hosted payment fields (e.g., Stripe Elements iframe). No raw card data touches Apolles servers. Tokenized payment reference is passed to Expedia. This is the only Expedia payment path at MVP — no alternative payment methods.
- **FR18**: Agent can review a booking summary showing: hotel name, room type, dates, guest name(s), total price, and cancellation terms before confirming
- **FR18a**: For Expedia rates, the booking summary includes Expedia-mandated display elements: tax disclaimer text, cancellation policy, and payment processing country
- **FR19**: Agent can confirm or go back to edit from the booking summary

### Booking Confirmation

- **FR20**: System displays a booking confirmation with: supplier reference number (from TBO or Expedia), Apolles booking ID, hotel name, room type, dates, guest name(s), total price, and booking status
- **FR21**: Confirmation page provides a clear indication that the booking is confirmed

### Booking Lifecycle States

The MVP uses a minimal booking status model. All statuses are agent-visible unless noted.

| Status | Meaning | Agent-Visible | Transitions To |
|--------|---------|--------------|----------------|
| `pending` | Booking request initiated, awaiting supplier confirmation | Yes | `confirmed`, `failed` |
| `price_changed` | Price recheck returned a different amount; awaiting agent decision | Yes | `pending` (agent accepts new price), or agent abandons |
| `confirmed` | Supplier confirmed the booking; reference number assigned | Yes | `cancelled` |
| `failed` | Supplier rejected the booking or a system error occurred | Yes | (terminal) |
| `cancelled` | Booking was cancelled (by agent action or admin) | Yes | (terminal) |

**Status rules:**
- **FR21a**: Every booking has exactly one status at any time. Status transitions are persisted with a timestamp.
- **FR21b**: `price_changed` is a transient state. If the agent accepts the new price, the booking returns to `pending` and proceeds to supplier confirmation. If the agent abandons, no booking record is created.
- **FR21c**: `confirmed` is the only status from which a voucher can be generated.
- **FR21d**: `failed` bookings display the failure reason to the agent (e.g., "Rate no longer available", "Supplier error").
- **FR21e**: Admin can view bookings in all statuses. Agents see only their own bookings in all statuses.

### Voucher Generation

- **FR22**: Agent can generate a PDF voucher for a confirmed booking
- **FR23**: Voucher displays: hotel name, hotel address, check-in/out dates, room type, guest name(s), confirmation number, and agent company name
- **FR24**: Agent can download the voucher as a PDF file
- **FR25**: One voucher per booking. No queue, no batch.

### Reservations Management

- **FR26**: Agent can view a list of all their bookings
- **FR27**: Agent can filter reservations by status (confirmed, cancelled, completed) and date range
- **FR28**: Agent can sort reservations by date or status
- **FR29**: Agent can search reservations by guest name or booking reference number
- **FR30**: Agent can view full reservation details: hotel, dates, room, guest(s), reference numbers, current status, cancellation terms (what the penalty would be), and voucher download/generate button

### Platform Markup

- **FR31**: Admin can set a single platform-wide markup percentage
- **FR32**: System applies the markup to all supplier rates (TBO and Expedia) server-side before returning prices to agents
- **FR33**: Agent sees the marked-up price as their cost. Supplier cost and markup amount are hidden from agents.

### Admin — Bookings

- **FR34**: Admin can view all bookings across all agents
- **FR35**: Admin can filter bookings by agent, date range, and status
- **FR36**: Admin can view full booking details for any booking (for support purposes)

### Admin — Supplier Logs

- **FR37**: System logs every supplier API call (TBO and Expedia) to the database: supplier name, endpoint/method, request timestamp, response latency, HTTP status, and error details (if any)
- **FR38**: Admin can view recent supplier API logs with filtering by supplier, method, status, and date range
- **FR39**: Admin can identify failed or slow API calls for debugging per supplier

### Admin — Agent Management

- **FR40**: Admin can list all agents with name, email, status, and date created
- **FR41**: Admin can create a new agent account
- **FR42**: Admin can deactivate an agent account

### Supplier Adapter

- **FR43**: System implements a common supplier interface with methods: `search()`, `priceCheck()`, `book()`, `cancel()`, `getBookingDetail()`
- **FR44**: TBO adapter implements this interface, handling TBO-specific API authentication (Basic Auth), request/response format translation, and error handling
- **FR44a**: Expedia adapter implements this interface, handling Expedia-specific API authentication (SHA-512 signature), request/response format translation, Expedia display requirement metadata, and error handling
- **FR45**: All supplier API calls are logged to the database (supplier, method, latency, status, error)
- **FR46**: Each API call has a 5-second timeout per supplier
- **FR47**: Both adapters normalize supplier-specific data into a common Apolles data model for hotels, rooms, rates, and cancellation policies. No mapping layer, no deduplication layer, no merge logic. Each supplier's results retain their supplier context internally (hidden from agent).
- **FR48**: Adding a third supplier requires implementing the same interface without changing core booking logic

### Supplier-Specific Result Model (MVP Data Architecture)

The MVP has no `UnifiedHotel` entity. There is no concept of a canonical hotel that spans suppliers.

**Explicit data model constraints:**
- **FR49**: Every search result is a supplier-specific result. It is tied to: a specific supplier (TBO or Expedia), the supplier's own hotel identifier, and the supplier's rate context (room, rate plan, cancellation policy, price).
- **FR50**: Booking always starts from a concrete supplier result. There is no path to initiate a booking from a merged or abstract hotel concept. The booking flow receives the supplier identifier and supplier-specific rate reference as input.
- **FR51**: The normalized Apolles data model (hotel name, rooms, rates, cancellation policies) is a display and storage normalization — not a cross-supplier identity layer. Two results with the same hotel name from different suppliers are two separate result objects with no link between them.
- **FR52**: The booking record stores: the originating supplier, the supplier's hotel ID, the supplier's booking reference, and the supplier-specific rate details at the time of booking. This supplier context is the source of truth for all post-booking operations (detail lookup, cancellation).

**What this means for Phase 2:**
- Adding hotel mapping (Phase 2) introduces a `UnifiedHotel` entity that links supplier-specific hotel IDs via Vervotech. MVP data model and booking flow remain valid — mapping is additive.
- MVP results, bookings, and vouchers are not affected by the future addition of mapping.

---

## Non-Functional Requirements

### Performance

- **NFR1**: Combined search results from both suppliers returned in under 5 seconds for 95th percentile of queries. First supplier results displayed as soon as they arrive; second supplier results appended when ready (progressive loading).
- **NFR2**: Price recheck / pre-book validation completes in under 3 seconds (per supplier)
- **NFR3**: Booking confirmation response within 10 seconds (dependent on supplier API)
- **NFR4**: Voucher PDF generation completes in under 5 seconds
- **NFR5**: All pages (dashboard, reservations list, admin views) load in under 2 seconds
- **NFR6**: System supports 20 concurrent agent sessions with no degradation in response times

### Security

- **NFR7**: Agent passwords stored using industry-standard one-way hashing (e.g., bcrypt) with appropriate cost factor
- **NFR8**: Session management with secure tokens, automatic timeout after 30 minutes of inactivity, secure cookie handling (HttpOnly, Secure, SameSite)
- **NFR9**: HTTPS enforced on all endpoints. No plaintext HTTP.
- **NFR10**: All supplier API credentials (TBO and Expedia) stored encrypted at rest, never displayed in any UI
- **NFR10a**: Payment card data for Expedia bookings handled exclusively through PCI-certified hosted payment fields. No raw cardholder data stored or transmitted by Apolles servers.
- **NFR11**: Input validation and protection against OWASP Top 10 (SQL injection, XSS, CSRF)
- **NFR12**: Role-based data access enforced at the API level — agents cannot access admin endpoints or other agents' data even via direct API calls

### Reliability

- **NFR13**: Platform availability 99%+ during business hours
- **NFR14**: Zero data loss on confirmed bookings. Database backups with recovery to within 1 hour of failure (RPO < 1 hour).
- **NFR15**: When one supplier API is unavailable, the platform continues operating with the other supplier. Search returns results from the responsive supplier, displays which supplier is unavailable, and provides a retry action. All non-search features (reservations, admin, voucher download) remain functional regardless of supplier availability.
- **NFR16**: All booking-related database operations use transactions to prevent partial writes

### Scalability

- **NFR17**: System supports scaling to 50 concurrent agents without re-architecture
- **NFR18**: Adding a new supplier integration requires no changes to core search or booking logic
- **NFR19**: Booking database supports 10,000+ bookings per year without query performance degradation

### Integration

- **NFR20**: All supplier-specific data formats (TBO and Expedia) normalized into a common Apolles data model covering: room types, cancellation policies, tax breakdowns, meal plans. 100% of bookable fields mapped for both suppliers at launch.
- **NFR21**: External API calls fail fast (5-second timeout per supplier) and display clear error to agent. No single supplier failure may degrade response times for the other supplier or non-search platform features.
- **NFR22**: All external API interactions logged with request/response metadata for debugging, per supplier
