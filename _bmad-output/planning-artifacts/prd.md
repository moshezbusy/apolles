---
stepsCompleted: [step-01-init, step-02-discovery, step-02b-vision, step-02c-executive-summary, step-03-success, step-04-journeys, step-05-domain, step-06-innovation, step-07-project-type, step-08-scoping, step-09-functional, step-10-nonfunctional, step-11-polish]
inputDocuments:
  - _bmad-output/planning-artifacts/product-brief-Apolles-2026-03-09.md
workflowType: 'prd'
classification:
  projectType: saas_b2b
  secondaryType: api_backend
  domain: traveltech
  complexity: medium-high
  projectContext: greenfield
  complianceNotes:
    - PCI DSS required for payment card handling (Expedia MoR flows)
    - Expedia B2B site review certification required before go-live
    - Supplier-specific display requirements (tax disclaimers, cancellation policies)
    - GDPR compliance required for agent/traveler PII across EU jurisdictions
    - PSD2/SCA exemption logic required for European card payments
lastEdited: '2026-03-10'
editHistory:
  - date: '2026-03-10'
    changes: 'Validation-driven edit: Added GDPR/Data Privacy section, fixed 15 NFRs (measurability + implementation leakage), fixed 6 FRs (vague quantifiers + implementation terms), added 3 new FRs (FR25b, FR71, FR72), tightened 9 weakest FRs, added 2-month adoption milestone, added onboarding journey (Journey 0), fixed anti-pattern text'
---

# Product Requirements Document - Apolles

**Author:** Moshe
**Date:** 2026-03-09

## Executive Summary

Apolles is a B2B hotel booking platform that replaces the fragmented multi-portal workflow travel agents endure today with a single system for searching, comparing, quoting, booking, and verifying hotel reservations across multiple suppliers. The platform aggregates hotel inventory from supplier APIs (Expedia Rapid, TBO Holidays at launch; Agoda, TravelgateX, and direct channel manager connections in later phases) using a PULL-based connectivity model, presents deduplicated search results powered by hotel mapping (Vervotech), and provides workflow tools that no competitor offers: a multi-city quote/itinerary PDF builder and automated Hotel Confirmation Number (HCN) verification. The primary users are freelance travel agents and small-to-medium agency teams (3-15 agents) who currently search 3-4 supplier portals individually, assemble quotes manually in Word/Excel, and verify reservations with hotels by hand -- a process that results in roughly 1 in 20-30 bookings arriving at a hotel with a mismatched or missing reservation. Apolles targets $1M gross booking volume and 50 onboarded agents within 12 months, generating $100K-$150K in revenue through a 10-15% markup on supplier rates. In Phase 2, an AI-powered conversational search assistant will allow agents to discover hotels using natural language prompts, translating requests into structured supplier queries and feeding results directly into the quote and booking flow -- a capability no B2B hotel platform currently offers, and the long-term strategic moat for the product.

### What Makes This Special

Three capabilities that no competitor combines today, plus a Phase 2 differentiator that changes the category:

1. **Multi-supplier aggregation with intelligent hotel mapping** -- Parallel real-time queries to multiple supplier APIs, with Vervotech-powered deduplication that merges the same physical hotel across suppliers into a single result card with rate comparison. Confidence scoring prevents false merges. Agents search once instead of switching between 3-4 portals.

2. **Quote/Itinerary PDF builder** -- Agents select 2-4 hotel options per city across multiple destinations, generate a professional branded PDF, and send it to clients within minutes. This replaces the 30+ minute manual process of copying rates into documents. No major B2B hotel platform offers this.

3. **Automated HCN verification** -- Each reservation includes a status tracker and automated email to the hotel's reservation department, verifying confirmation numbers and booking details. Agent-configurable sending email and editable templates. This directly prevents the 1-in-20-30 mismatch problem that damages agent credibility and causes costly emergency rebookings.

4. **AI conversational search (Phase 2)** -- Natural language hotel discovery integrated into the booking and quoting workflow. Agents describe what they need ("family-friendly hotel in Rome, pool, under $200/night, near the Colosseum"), and the AI translates this into structured supplier queries, returns real bookable results, and enables direct quote/booking actions from the chat. This is the long-term moat: once agents search by conversation, structured search forms become the fallback rather than the primary interaction method.

The core insight: the B2B hotel distribution market is large and established, but tools are built for suppliers, not agents. Every incumbent (Hotelbeds, TBO, RateHawk, Arbitrip) is a single-supplier portal with no aggregation, no quote module, no HCN automation, and no AI search. Apolles is built around how agents actually work.

### Project Classification

- **Project Type:** B2B SaaS platform with significant API integration backend (multi-supplier orchestration)
- **Domain:** Travel Technology (B2B hotel distribution)
- **Complexity:** Medium-High -- PCI DSS compliance, Expedia B2B site review certification, real-time multi-API orchestration, hotel mapping/deduplication, supplier-specific display requirements
- **Project Context:** Greenfield -- building from scratch, no existing codebase

## Success Criteria

### User Success

- **Search efficiency**: Agents search once and see deduplicated results from Expedia + TBO in a single view -- eliminating the need to search multiple portals individually. Target: combined search results returned in under 5 seconds.
- **Quote generation speed**: Agents build and send a multi-city, multi-hotel PDF quote in under 5 minutes (vs. 30+ minutes manually). This is the "aha moment" -- the first time it happens, the agent knows Apolles is different.
- **HCN mismatch elimination**: Reduce reservation mismatches from ~1 in 20-30 bookings to <1% of bookings through automated HCN verification emails and status tracking. Agents stop worrying about guests arriving to wrong rooms or missing reservations.
- **Daily tool replacement**: Agents use Apolles as their primary booking tool, replacing the multi-portal workflow. Success = agents open Apolles first thing in the morning and don't need another tool for hotel bookings.
- **Booking flow confidence**: Agents complete bookings without confusion about pricing, cancellation policies, or payment terms -- enabled by clear Expedia-compliant display of all relevant information.

### Business Success

- **12-month gross booking volume**: $1,000,000 in total hotel bookings processed through the platform.
- **Agent acquisition**: 50 agents onboarded within 12 months (mix of freelancers and small agency teams).
- **Markup revenue**: 10-15% markup on supplier rates, generating $100,000-$150,000 in gross revenue.
- **Agent retention**: 70%+ of onboarded agents logging in daily. Drop in daily usage is the primary churn signal.
- **Time to first booking**: New agent completes their first real booking within 24 hours of account setup.
- **Quote adoption**: 60%+ of active agents generate at least 1 quote PDF per week.

### Technical Success

- **Search response time**: Combined deduplicated results from Expedia + TBO returned in under 5 seconds for 95th percentile of queries.
- **Hotel mapping accuracy**: 99.9%+ accuracy using Vervotech (industry standard), with zero false merges shown to agents. Low-confidence matches displayed separately rather than incorrectly merged. 98%+ coverage of overlapping hotel inventory between Expedia and TBO mapped within 30 days of launch.
- **Expedia B2B certification**: Submit for Expedia site review within 2 weeks of feature completion. Pass review within 4 weeks of submission. This is a hard launch gate -- no production bookings until Expedia enables the production API key.
- **TBO integration certification**: Complete TBO API integration and testing certification per their requirements.
- **Platform reliability**: 99.5%+ uptime during business hours (when agents are actively booking). Zero data loss on bookings or financial transactions.
- **HCN email delivery**: Verification emails sent within 5 minutes of booking confirmation. 95%+ successful delivery rate (dependent on hotel email server availability).
- **PCI compliance**: Achieve PCI DSS compliance attestation (AOC) before handling any payment card data through Expedia flows.

### Measurable Outcomes

| Metric | Target | Timeframe | How Measured |
|--------|--------|-----------|--------------|
| Gross booking volume | $1,000,000 | 12 months | Total hotel booking value processed |
| Agents onboarded (early milestone) | 10 | 2 months | Registered and completed first booking |
| Agents onboarded | 50 | 12 months | Registered and completed first booking |
| Markup revenue | $100K-$150K | 12 months | 10-15% of gross booking volume |
| Daily active agents | 70%+ of onboarded | Ongoing | Agents logging in daily |
| HCN mismatch rate | <1% of bookings | Ongoing | Bookings with confirmed HCN vs. mismatches |
| Quote PDF usage | 60%+ of agents | Ongoing | Agents generating 1+ quote PDF per week |
| Search-to-book time | <5 minutes | Ongoing | Time from first search to completed booking |
| Search response time | <5 seconds (p95) | Ongoing | Time to return deduplicated results |
| Hotel mapping accuracy | 99.9%+ | Ongoing | Vervotech mapping with zero false merges |
| Expedia site review | Pass within 4 weeks | Pre-launch | Certification from Expedia team |
| Platform uptime | 99.5%+ | Ongoing | Business hours availability |
| Agent churn rate | <10% monthly | Ongoing | Agents inactive for 14+ consecutive days |

## Product Scope & Phased Development

### MVP Summary

**MVP Approach:** Platform MVP -- deliver the minimum complete agent workflow (search → compare → quote → book → verify → manage) with just enough infrastructure to support it. An agent can do their entire daily hotel booking job on Apolles from day one.

**Why platform MVP, not feature MVP:** Travel agents won't adopt a tool that handles only search, or only quotes. The switching cost from their existing workflow is high -- they need a complete replacement to justify changing. A partial tool means they still keep old portals open.

**Core User Journeys Supported at MVP:**
- Yael's daily booking flow (search, quote, book, HCN verify) -- Journey 1
- Yael's HCN mismatch recovery -- Journey 2
- Moshe's platform admin operations (basic) -- Journey 5

**Resource Requirements:** Full-stack team with backend (API integration, booking engine, wallet/financial logic, auto-cancellation scheduling), frontend (search UI, booking flow, quote builder, booking management, profile/settings), DevOps (supplier API monitoring, scheduled jobs, email delivery), and design (agent-facing UX that passes Expedia review).

### MVP Feature Set (Phase 1)

| # | Feature | Rationale |
|---|---------|-----------|
| 1 | Multi-supplier search (Expedia + TBO, PULL) | Core value proposition -- the reason agents switch |
| 2 | Hotel mapping (Vervotech) | Required for deduplication -- without it, search shows duplicates |
| 3 | Quote/Itinerary PDF builder | Key differentiator -- no competitor has this |
| 4 | Booking flow (Expedia B2B compliant) | Must pass Expedia site review to go live |
| 5 | HCN verification system | Key differentiator -- prevents mismatch disasters |
| 6 | Wallet with payment gateway | Required for booking -- wallet-gated booking is core business logic |
| 7 | Wallet-gated booking logic | Protects platform and agents from unintended charges |
| 8 | Auto-cancellation of unvouchered bookings | Protects platform from holding uncommitted inventory |
| 9 | Voucher generation (single + queue with batch) | Commitment signal, client deliverable, required for booking lifecycle |
| 10 | Booking management area | Agents need to view, cancel, modify, and track bookings |
| 11 | Profile/settings (basic) | Logo upload, company details, HCN email config, quote branding |
| 12 | Single-user accounts (freelancer model) | Simplified user management for launch |
| 13 | Basic transaction history | Agents need to see what they've spent |
| 14 | Basic invoicing | Agents need transaction records |
| 15 | Platform admin dashboard (basic) | Moshe needs to monitor API health, mapping, and support agents |

**Explicitly NOT in MVP (deferred):**
- Full RBAC (super agent / sub agent) -- Fast-follow
- Multi-layer markup chain (agency + sub-agent markups) -- Fast-follow
- Booking approval workflow -- Fast-follow
- Agency team management -- Fast-follow
- Advanced analytics -- Growth phase
- AI conversational search -- Phase 2
- Agoda integration -- Phase 2
- TravelgateX / channel manager connections -- Phase 3

**MVP Launch: Single-layer markup only.** Markup chain at launch: Supplier cost → Platform markup → Agent's single markup → Client price. Cascading multi-layer markup (super agent + sub agent) ships with RBAC in fast-follow.

### Post-MVP Roadmap

**Fast-Follow (2-4 weeks after MVP launch):**

| Feature | Rationale |
|---------|-----------|
| Full RBAC (super/sub agent hierarchy) | Enables agency onboarding -- David's journey |
| Multi-layer cascading markup | Agencies need sub-agent markup independence |
| Booking approval workflow | Super agents control sub-agent booking authority |
| Agency team management (invite, permissions) | Required for multi-user agencies |
| Agency dashboard (team activity, performance) | Super agent oversight |
| Wallet top-up request flow for sub-agents | Sub-agents need to request credit from super agent |

**Phase 2 (Growth):**

| Feature | Rationale |
|---------|-----------|
| Agoda API integration | 3rd supplier, expanded inventory |
| AI conversational search assistant | Strategic differentiator, long-term moat |
| Advanced analytics & reporting | Agent performance insights, exportable reports |
| Enhanced invoicing & accounting | Full financial management |
| Advanced profile/branding options | More template customization, multiple quote layouts |

**Phase 3 (Expansion):**

| Feature | Rationale |
|---------|-----------|
| TravelgateX switch integration | Access to hundreds of additional suppliers |
| Direct channel manager PULL connections | Omnibees, Dingus where commercially feasible |
| Advanced revenue management | Dynamic markup, competitor rate monitoring |

**Phase 4 (Maturity):**

| Feature | Rationale |
|---------|-----------|
| PUSH connectivity support | Channel managers that require it |
| Mobile app | Agent mobility |
| Multi-currency wallet | International agent support |
| White-label capability | Agency branding |
| GDS connectivity | If market demands |

### Risk Mitigation Strategy

**Technical Risks:**

| Risk | Severity | Mitigation |
|------|----------|------------|
| Auto-cancellation system failure | Critical | Redundant scheduling, dead-letter queue, safety buffer, admin escalation. Most technically critical subsystem -- build and test first. |
| Expedia site review rejection | High | Build to Expedia requirements from day one using their checklist. Submit early for feedback. Budget 4-6 weeks for review cycle. |
| Supplier API latency / downtime | Medium | Progressive loading (show available results first), circuit breaker pattern, graceful degradation messaging |
| Hotel mapping accuracy | Medium | Zero false merge policy, confidence scoring, manual override. Start with Vervotech's 99.9%+ accuracy and add manual correction layer. |
| Wallet race conditions | Medium | Atomic balance checks with database-level locking, reservation-based holds |
| PCI compliance failure | Medium | Use payment tokenization where possible; minimize card data handling; engage PCI compliance assessor early |
| HCN email deliverability | Medium | Monitor delivery rates; provide manual resend; allow agents to copy email content and send from own email as fallback |
| Supplier credential management | Low | Encrypt stored credentials; never display full keys in UI; audit access logs |
| Markup chain calculation errors | Low | Automated margin validation; audit trail for all markup changes; clear display of effective markup at each layer |

**Market Risks:**

| Risk | Severity | Mitigation |
|------|----------|------------|
| Agents won't switch from existing tools | High | Quote PDF builder and HCN automation are immediate differentiators agents can't get elsewhere. Target pain points, not features. |
| Two suppliers (Expedia + TBO) isn't enough inventory | Medium | Vervotech maps 400+ suppliers -- Expedia and TBO together cover significant global inventory. Agoda in Phase 2 adds substantial coverage. |
| Agents find the platform too complex | Medium | Launch with single-user freelancer model (simplest persona). Add team complexity in fast-follow only after freelancers validate the core. |

**Resource Risks:**

| Risk | Severity | Mitigation |
|------|----------|------------|
| Fewer developers than planned | High | MVP feature list is tightly coupled -- hard to cut individual features. Fallback: delay fast-follow features, extend MVP timeline rather than cut core features. |
| Expedia partner approval takes too long | Medium | Begin partner application immediately. Develop against test endpoint in parallel. TBO has simpler onboarding -- could launch TBO-only first if Expedia is delayed. |
| Vervotech integration takes longer than expected | Medium | Fallback: launch without deduplication (show all results from both suppliers). Add deduplication as it becomes available. Degraded experience but functional. |

## User Journeys

### Journey 0: Yael -- First-Time Agent Onboarding (Primary User, Onboarding Path)

**Opening Scene:** Yael has been using Hotelbeds and the Expedia partner portal for two years. A colleague mentions Apolles -- "one search across all your suppliers." She's skeptical but visits the registration page.

**Rising Action:** She enters her name, email, company name, and Israeli travel agent license number. Email verification link arrives within seconds. She logs in for the first time: a brief setup wizard asks her to (1) upload her agency logo, (2) configure her sending email address for hotel verifications, and (3) set her default markup percentage. Three steps, under 2 minutes.

**Climax:** She runs her first search -- "Santorini, 2 adults, 5 nights." Within 4 seconds, deduplicated results from multiple suppliers appear. She sees rate comparisons she's never had in one view before. She adds three hotels to a quote, generates a PDF, and sends it to a test email address. The branded document looks better than anything she's built manually. She tops up her wallet with a small test amount and books a free-cancellation room to see the full flow. Booking confirmed, HCN email sent automatically. From registration to first booking: 22 minutes.

**Resolution:** Yael's first session showed her what previously took four browser tabs and a Word document. She'll be back tomorrow with real client requests. The 2-month adoption milestone (BS5) hinges on this experience: 10 agents like Yael completing first booking within 24 hours of registration.

---

### Journey 1: Yael -- Freelance Agent, Daily Booking Flow (Primary User, Happy Path)

**Opening Scene:** It's 8:30 AM. Yael, a freelance travel agent working from her home office in Tel Aviv, opens WhatsApp to find three new messages from clients. A couple wants a romantic week in Santorini. A family of six needs two rooms in Barcelona for a school holiday. A corporate client needs three nights in London near Canary Wharf. Before Apolles, Yael would open four browser tabs -- Hotelbeds, TBO, Expedia partner portal, RateHawk -- and search each one individually for each request. By the time she finished the third client, the first client's rates might have changed. She'd copy-paste hotel names and prices into a Word document, format it as best she could, and email it. Today, she opens Apolles.

**Rising Action:** Yael starts with the Santorini request. She types "Santorini" in the search bar, selects dates, 2 adults, 1 room. Within 4 seconds, deduplicated results from Expedia and TBO appear side by side -- the same hotel showing rates from both suppliers, the cheaper option highlighted. She spots three great options: a boutique hotel with caldera views, a mid-range resort with a pool, and a luxury suite. She clicks "Add to Quote" on each.

She switches to Barcelona. New search: 2 rooms, 2 adults + 2 children (ages 8, 11). Results load. She picks four family-friendly options and adds them to the same quote. Then London -- 1 room, 1 adult, 3 nights. Three business hotels near Canary Wharf added.

She opens the Quote Builder. Three cities, ten hotel options, all organized. She adjusts the order, adds a brief note per city ("Santorini -- romantic options with sea views"), and clicks "Generate PDF." A professional branded document appears. She downloads it and sends it via WhatsApp to the couple.

**Climax:** The couple responds within an hour -- they want the boutique hotel. Yael clicks directly from the quote into the booking flow. Price check confirms the rate hasn't changed. She enters guest details, reviews the cancellation policy (clearly displayed with the free cancellation deadline), and confirms the booking. Booking confirmed -- supplier reference number displayed. Within 3 minutes, the system automatically sends an HCN verification email to the hotel's reservation department.

**Resolution:** By 10:30 AM, Yael has sent quotes for all three clients and booked the Santorini hotel. Her HCN dashboard shows "Email Sent" for the new booking. By afternoon, it updates to "Confirmed" -- the hotel verified the reservation details match. Yael didn't chase anyone. She didn't copy-paste into Word. She didn't worry about the reservation being wrong. She served three clients in the time it used to take to serve one.

---

### Journey 2: Yael -- HCN Mismatch Recovery (Primary User, Edge Case)

**Opening Scene:** It's Thursday afternoon. Yael checks her HCN dashboard and sees one reservation flagged "Mismatch" -- a hotel in Rome she booked two days ago for a client flying out Saturday. The hotel responded to the verification email saying the dates in their system are one day off from what the supplier confirmed.

**Rising Action:** Yael clicks into the reservation. She sees the full details: her booking says check-in March 15, the hotel says March 16 in their system. The HCN status shows the mismatch details. She contacts the supplier's support to correct the dates. She updates the HCN status to "Issue -- contacting supplier."

**Climax:** The supplier confirms the correction. Yael triggers a new HCN verification email from the reservation page. The hotel responds confirming the dates now match.

**Resolution:** Without HCN automation, Yael would never have known about this mismatch. Her client would have arrived in Rome on Saturday evening to be told their reservation starts Sunday. Instead, the system caught it 48 hours before travel. The client never knew there was a problem. This is the moment Yael tells every agent she knows about Apolles.

---

### Journey 3: David -- Agency Owner Onboarding His Team (Secondary User, Admin Path)

*Note: This journey covers the fast-follow RBAC features. At MVP launch, David uses Apolles as a single-user like Yael. This journey documents the near-term experience once team management ships.*

**Opening Scene:** David runs a 10-person travel agency in Haifa. He's been using Apolles himself for two weeks as a solo user and loves the quote builder. Now he wants his team on it. He logs in and navigates to the team management section (available in fast-follow).

**Rising Action:** David clicks "Invite Agent" and adds Noa, his junior agent. He configures her permissions: she can search and create quotes, but cannot book without his approval. She cannot see supplier cost prices or margins -- only the client-facing markup price. He invites three more agents with booking permissions and two senior agents with full access including margin visibility.

Each agent receives an email invitation, creates their account, and starts using Apolles immediately. David opens his dashboard -- he sees all agents' activity: searches, quotes sent, bookings made, HCN statuses.

**Climax:** David notices one agent has been quoting hotels but not booking -- her conversion rate is low. He pulls up her quote history and sees she's been quoting high-end properties to budget-conscious clients. He coaches her. He also notices the agency's total booking volume for the week and calculates margin -- visible in one dashboard instead of spread across four supplier portals.

**Resolution:** David has operational visibility he never had before. He manages permissions, monitors performance, and controls margins from a single screen. His agency looks professional -- every agent sends the same branded quote PDFs. The HCN dashboard across all agents means no booking falls through the cracks.

---

### Journey 4: Noa -- Sub Agent, Restricted Permissions (Secondary User, Constrained Path)

**Opening Scene:** Noa is a junior agent at David's agency. She received her Apolles invitation, set up her account, and sees a clean dashboard. She doesn't see a "Wallet" or "Finance" section -- David hasn't granted her those permissions. She sees: Search, Quotes, My Bookings, and HCN Status.

**Rising Action:** A client asks Noa for hotel options in Prague. She searches -- same fast experience as Yael. Results show the client-facing price (with David's markup already applied), not the supplier cost. She picks four options, builds a quote, and sends the PDF to the client.

The client picks a hotel. Noa clicks "Book" but sees a message: "Booking requires approval from your agency administrator." She clicks "Request Approval." David gets a notification, reviews the booking details and margin, and approves it with one click.

**Climax:** The booking is confirmed. HCN verification email is sent automatically. Noa sees the confirmation and sends the voucher to the client. She didn't need to ask David for rates, didn't need access to supplier portals, and didn't need to wait for David to do the search for her.

**Resolution:** Noa works efficiently within her boundaries. She handles the client-facing workflow end to end, while David maintains control over financial decisions. No friction, no bottlenecks for routine work.

---

### Journey 5: Moshe -- Platform Admin, Monitoring & Operations (Admin/Ops)

**Opening Scene:** Moshe is the platform operator. It's Monday morning and he checks the Apolles admin dashboard. He sees: 47 active agents, 312 bookings last week, supplier API health status, hotel mapping coverage stats.

**Rising Action:** He notices the Expedia API response times have increased -- averaging 3.8 seconds instead of the usual 2 seconds. He checks the API health monitor and sees Expedia had intermittent slowdowns over the weekend. TBO is normal. No bookings failed, but search times were slower. He makes a note to monitor.

He checks the hotel mapping dashboard. Vervotech flagged 15 new hotels added by Expedia that don't yet have TBO matches. 8 were auto-matched with high confidence. 7 are low-confidence and displayed as separate entries to agents. He reviews the 7, manually confirms 4 matches and marks 3 as genuinely different properties.

**Climax:** An agent contacts support -- a booking shows "confirmed" in Apolles but the hotel says they have no reservation. Moshe pulls up the booking, checks the supplier confirmation number, and contacts TBO's B2B support with the reference. TBO confirms a system error on their side and reprocesses the booking. Moshe updates the booking status and notifies the agent.

**Resolution:** Moshe keeps the platform healthy. He monitors supplier reliability, maintains mapping accuracy, and resolves edge cases that agents can't handle themselves. As the platform grows, these operations will scale into a dedicated team.

---

### Journey Requirements Summary

| Journey | Key Capabilities Revealed |
|---------|--------------------------|
| **Yael - Onboarding** | Self-service registration, profile setup wizard (logo, email, markup), first search, first quote PDF, wallet top-up, first booking within 24h |
| **Yael - Daily Flow** | Multi-supplier search, result deduplication, quote builder (multi-city), booking flow with price check, HCN auto-email, voucher generation |
| **Yael - HCN Mismatch** | HCN status tracking with mismatch detection, manual status updates, re-send verification, reservation detail display |
| **David - Team Onboarding** | Agent invitation flow, permission configuration, activity dashboard, margin visibility controls, team management |
| **Noa - Restricted Agent** | Permission-gated UI (hide/show sections), markup-only pricing display, booking approval workflow, notification system |
| **Moshe - Platform Admin** | API health monitoring, hotel mapping management (manual overrides), booking investigation tools, supplier support escalation, platform metrics dashboard |

## Domain-Specific Requirements

### Compliance & Regulatory

- **PCI DSS compliance**: Required for handling payment card data in Expedia flows where Expedia is Merchant of Record. Must provide Attestation of Compliance (AOC). All card data transmitted over SSL, cardholder data storage per PCI Security Standards Council requirements.
- **Expedia B2B launch requirements**: Hard gate to production. Must pass site review covering: price display (tax breakdowns with legally mandated text), cancellation policy display, check-in instructions, SCA compliance, payment processing country display, downstream agent T&C acceptance, PCI compliance evidence. Failure = no production API key.
- **TBO API certification**: Must complete TBO's integration testing and certification process per their API specifications.
- **Expedia terms propagation**: Downstream agents must agree to Expedia's Agent Terms and Conditions before accessing Expedia inventory. Link to agent agreement must be provided in the booking flow.
- **Tax disclaimer requirements**: Legally mandated text for Expedia taxes and fees: "The taxes are tax recovery charges paid to vendors (e.g. hotels); for details, please see our Terms of Use. Service fees are retained as compensation in servicing your booking and may include fees charged by vendors."
- **Partner charge labeling**: Apolles service charges must be labeled "affiliate booking charge" or "affiliate service charge" -- never use the word "fee" for partner-imposed charges (Expedia requirement).

### Data Privacy & GDPR

The platform collects and processes personal data across multiple categories and jurisdictions. European agents and travelers trigger GDPR obligations; Israeli agents are covered by the Israeli Privacy Protection Law.

**Data Categories Processed:**

| Category | Examples | Subjects | Retention |
|---|---|---|---|
| Agent PII | Name, email, phone, company, tax ID, address | Travel agents | Account lifetime + 7 years (tax/audit) |
| Traveler PII | Guest name, email, phone, travel dates, special requests | End travelers | Booking lifetime + 3 years (dispute resolution) |
| Financial data | Wallet balances, transaction history, invoices, markup config | Agents | 7 years (tax/audit compliance) |
| Booking data | Hotel, dates, confirmation numbers, HCN status, cancellation history | Agents + travelers | 7 years (financial record) |
| Authentication data | Hashed passwords, session tokens, login history | Agents | Account lifetime + 90 days post-deletion |

**Privacy Requirements:**

- **Privacy policy**: Platform must display a publicly accessible privacy policy detailing data collection, processing purposes, legal basis, retention periods, and data subject rights. Privacy policy link required in registration flow and site footer.
- **Consent management**: Traveler data collected on behalf of agents for booking fulfillment (legitimate interest / contractual necessity). Agents consent to data processing during registration. Marketing communications require explicit opt-in consent with unsubscribe capability.
- **Right to erasure**: Agents can request account deletion. System must anonymize PII within 30 days while preserving financial records (anonymized) for tax compliance. Traveler PII anonymized when retention period expires.
- **Right to access**: Agents can export their personal data and booking history in machine-readable format (JSON or CSV) within 30 days of request.
- **Data minimization**: Collect only data necessary for booking fulfillment. Guest special requests stored as free text, not structured sensitive categories. No collection of passport numbers, payment card numbers (tokenized via payment gateway), or health data.
- **Data processing agreements (DPAs)**: Required with all third parties that process personal data on Apolles' behalf: Expedia (booking data), TBO (booking data), Vervotech (hotel IDs only -- no PII), email service provider (guest names/emails for HCN), payment gateway (tokenized card data). DPAs must be executed before production launch.
- **Data breach notification**: If a breach involving personal data is detected, notify affected data subjects within 72 hours per GDPR Article 33. Maintain an incident response procedure documenting detection, containment, notification, and remediation steps.
- **Cross-border data transfers**: If personal data is transferred outside the EEA (e.g., to Israeli servers or US-based suppliers), ensure adequate protection via Standard Contractual Clauses (SCCs) or equivalent mechanism.
- **Data isolation**: Agent data is tenant-isolated (see Multi-Tenancy Model). No agent can access another agent's PII, traveler data, or financial records.

**PCI DSS Scope Boundary:**

- Apolles does not store, process, or transmit raw cardholder data. All payment card operations are delegated to a PCI-certified payment gateway (e.g., Stripe) using tokenized payment methods (hosted payment fields / redirect).
- PCI scope: SAQ-A or SAQ A-EP (depending on gateway integration model). Final SAQ type determined during architecture.
- Apolles stores only: payment gateway token references, last-4 digits of card (for display), and transaction confirmation IDs.

**PSD2 / SCA Exemption Logic:**

- For Expedia bookings involving European card payments, the system must determine whether SCA (3D Secure) is required or exempt based on: transaction value (low-value exemption: < EUR 30), trusted beneficiary status, and transaction risk analysis (TRA) score from the payment gateway.
- When SCA is required: redirect agent to 3D Secure challenge flow, handle success/failure/timeout, and display clear status to the agent.
- When SCA is exempt: process payment directly without 3D Secure challenge.
- Fallback: if exemption is rejected by the issuing bank, automatically escalate to full SCA flow.

**TBO Display & Certification Requirements:**

- TBO's site review requirements (if any) must be documented during integration onboarding. Request TBO's compliance checklist during API certification and add specific display requirements to this section.
- Until TBO display requirements are confirmed: apply Expedia-equivalent display standards (tax breakdowns, cancellation policy, booking terms) as a floor.

**Supplier-Specific Legal Text Rendering:**

- The platform must dynamically render the correct legal disclaimers, tax text, and cancellation policy format based on the supplier sourcing each rate.
- Expedia rates: display Expedia's legally mandated tax disclaimer text (see above).
- TBO rates: display TBO-specific disclaimers (to be documented during TBO certification).
- Quote PDFs and vouchers must include the applicable supplier's legally mandated text even though the supplier identity is hidden from the agent.

### Multi-Layer Pricing & Data Visibility Architecture

A foundational domain requirement that affects every screen in the platform. Different roles see different data about the same search results and bookings.

**Markup Chain (cascading, each layer only sees their cost and above):**

| Layer | Price | Who Sets | Who Sees |
|-------|-------|----------|----------|
| 1. Supplier cost | Base rate from Expedia/TBO | Supplier | Platform owner only |
| 2. + Platform markup | Apolles' margin (10-15%) | Platform owner (Moshe) | Platform owner only |
| 3. + Super agent markup | Agency margin | Super agent (David) | Super agent + platform owner |
| 4. + Sub agent markup | Personal margin | Sub agent (Noa) | Sub agent + super agent + platform owner |
| 5. Client price | Final price on PDF/voucher | N/A (calculated) | Everyone including end client |

**Data Visibility Rules:**

| Data Element | Platform Owner | Super Agent | Sub Agent | End Client (PDF) |
|---|---|---|---|---|
| Supplier name (Expedia/TBO) | Visible | Hidden | Hidden | Hidden |
| Supplier cost price | Visible | Hidden | Hidden | Hidden |
| Platform markup amount | Visible | Hidden | Hidden | Hidden |
| Super agent cost (platform price) | Visible | Visible (as "cost") | Hidden | Hidden |
| Super agent markup amount | Visible | Visible | Hidden | Hidden |
| Sub agent cost (agency price) | Visible | Visible | Visible (as "cost") | Hidden |
| Sub agent markup amount | Visible | Visible | Visible | Hidden |
| Final client price | Visible | Visible | Visible | Visible |
| Hotel mapping confidence | Visible | Hidden | Hidden | Hidden |
| API response metadata | Visible | Hidden | Hidden | Hidden |

**Key Principles:**
- Each role sees a price that appears to them as "the cost" -- they never know about markup layers below them
- Super agents can see sub agent final prices (oversight) but sub agents cannot see super agent costs
- Supplier identity is strictly platform-internal -- agents never know which supplier provides the rate
- Quote PDF and hotel voucher show only hotel name, dates, room details, and final client price -- zero internal pricing or supplier information
- Markup chain is multiplicative: each layer applies their percentage on top of their visible cost

### Technical Constraints

- **Real-time multi-API orchestration**: Parallel PULL queries to multiple supplier APIs with different response formats, error handling, and timeout behaviors. Must handle partial failures gracefully (e.g., Expedia returns results but TBO times out -- show Expedia results, indicate TBO unavailable).
- **Hotel mapping dependency**: Core search experience depends on Vervotech mapping accuracy and availability. If Vervotech is down, search still works but deduplication is degraded -- must handle gracefully.
- **Supplier rate volatility**: Hotel rates change frequently. Price displayed at search time may differ at booking time. Price check/pre-book validation is mandatory before every booking. Must clearly communicate price changes to the agent before confirmation.
- **SCA (Strong Customer Authentication)**: Required for Expedia bookings involving European card payments. Must implement 3D Secure or equivalent authentication flow as mandated by PSD2 regulation.
- **Supplier API rate limits**: Expedia monitors anomalous API traffic and will throttle or block. Must implement intelligent query management -- cache results where appropriate, avoid redundant calls, respect rate limit headers.
- **Data format normalization**: Each supplier returns different data structures for the same concepts (room types, cancellation policies, tax breakdowns, meal plans). Must normalize into a unified Apolles data model.

*For the complete integration inventory and risk mitigation tables, see the Integration List and Risk Mitigation Strategy sections below.*

## Innovation & Novel Patterns

### Detected Innovation Areas

**1. Multi-supplier aggregation with intelligent deduplication (Novel combination)**
While supplier aggregation exists in B2C (Google Hotels, Trivago), no B2B agent-facing platform aggregates across multiple wholesale supplier APIs with real-time hotel mapping and deduplication. The innovation is the combination: PULL-based multi-API orchestration + Vervotech mapping + unified result presentation with the supplier identity completely hidden from agents. This is not a price comparison site -- it's a unified inventory layer.

**2. AI conversational search for B2B hotel booking (Phase 2 -- Category-defining)**
Natural language search that translates agent requests into structured supplier API queries, returns real bookable results, and feeds directly into quote/booking workflows. This combines LLM capabilities with real-time supplier API integration -- the AI doesn't just recommend, it returns live inventory with actual rates. No B2B hotel platform has this. The closest analogies are consumer-facing AI travel assistants, but none connect to wholesale supplier APIs or integrate into agent booking workflows.

**3. Cascading multi-layer markup with role-based visibility (Novel architecture)**
The four-layer markup chain (supplier → platform → super agent → sub agent) with strict visibility boundaries at each level is architecturally novel for this domain. Each participant in the chain sees a different "cost" without knowing about layers below them. This creates a self-service B2B distribution model where agencies and sub-agents can set their own margins independently.

**4. Automated HCN verification as a first-class feature (Workflow automation)**
HCN verification is a manual process across the entire industry. Building it as an automated, status-tracked, template-driven system with a dedicated dashboard is a workflow automation innovation. Simple in concept, but nobody has productized it.

### Market Context & Competitive Landscape

- **Hotelbeds/TBO/RateHawk**: Single-supplier portals, no aggregation, no quote builder, no HCN automation, no AI search
- **Arbitrip**: Better UX but single-supplier approach, no quote module
- **TravelgateX**: Switch/connectivity platform (B2B2B), not an agent-facing tool -- provides the plumbing, not the workflow
- **Google Hotels/Trivago**: B2C comparison, not B2B agent workflow
- **Consumer AI assistants (Kayak, Google Gemini)**: Not connected to wholesale supplier APIs, no booking capability through B2B channels

The competitive gap: nobody has combined aggregation + agent workflow tools + AI search in a single B2B platform.

### Validation Approach

| Innovation | Validation Method | Timeline |
|---|---|---|
| Multi-supplier aggregation | MVP launch with 2 suppliers -- do agents actually prefer one search over separate portals? Measure search-to-book conversion rate vs. industry baseline | MVP |
| AI conversational search | Prototype with 5-10 agents, measure task completion rate vs. structured search, measure quote generation speed improvement | Phase 2 |
| Cascading markup chain | Super agent adoption -- do agencies actually use the markup layering? Track how many agencies set up sub-agent markups vs. flat pricing | Fast-follow |
| HCN automation | Track mismatch detection rate -- if system catches mismatches that would have been missed, agents have immediate proof of value | MVP |

### Innovation Risk & Fallbacks

| Innovation Risk | Fallback |
|---|---|
| Multi-supplier search is too slow (API latency) | Progressive loading -- show fastest supplier results first, add second supplier results as they arrive |
| AI search produces poor results | AI search is Phase 2; by then we have search data to train on. Structured search remains the primary interface, AI is additive |
| Cascading markup is too complex for agents | Default to simple single-layer markup. Multi-layer is opt-in for agencies that need it |
| HCN emails get blocked by hotel spam filters | Manual resend, copy-to-clipboard fallback, agent can send from their own email |

## B2B SaaS Specific Requirements

### Multi-Tenancy Model

- **Tenant types**: Individual agent account (freelancer) or agency account (with sub-users)
- **Data isolation**: Complete -- agents cannot see other agents' bookings, quotes, clients, or financial data
- **Agency-level sharing**: Within an agency, sub-agents share agency-level data per their RBAC permissions (set by super agent). Super agent can view all sub-agent activity.
- **Platform-level access**: Platform owner (Moshe) has cross-tenant visibility for operations, support, and analytics
- **Tenant provisioning**: Self-service registration for freelancers. Agency setup by super agent with invitation flow for sub-agents (fast-follow).

### RBAC Permission Matrix

| Permission | Platform Owner | Super Agent | Sub Agent |
|---|---|---|---|
| Search hotels | Yes | Yes | Yes |
| View search results with supplier names | Yes | No | No |
| Create quotes | Yes | Yes | Yes |
| Book reservations | Yes | Yes | Configurable (direct or approval-required) |
| Cancel/modify bookings | Yes | Yes (own + sub-agents') | Yes (own only) |
| Generate vouchers | Yes | Yes | Yes |
| View supplier cost price | Yes | No | No |
| View platform markup | Yes | No | No |
| Set agency markup | N/A | Yes | No |
| Set personal markup | N/A | Yes | Yes |
| View sub-agent margins | N/A | Yes | No |
| Access wallet / top-up | Yes | Yes | Configurable |
| Request wallet top-up | N/A | N/A | Yes (sends notification to super agent with booking details) |
| View transaction history | Yes | Yes (agency-wide) | Yes (own only) |
| Manage agents (invite, permissions) | Yes (all) | Yes (own agency) | No |
| View analytics | Yes (platform-wide) | Yes (agency-wide) | Yes (own only) |
| Configure profile / branding | Yes | Yes (agency-level) | Yes (personal only) |
| HCN dashboard | Yes (all bookings) | Yes (agency bookings) | Yes (own bookings) |
| API health / mapping management | Yes | No | No |

### Business Model & Pricing

- **No subscription tiers** -- all agents get the same feature set
- **Revenue model**: Markup on supplier rates at every layer of the chain
- **Wallet-based payments**: Agents must maintain wallet credit to book non-refundable reservations
- **Self-service**: Sign up, get access, start searching/quoting immediately. Booking requires wallet credit for non-refundable rates.

### Wallet & Booking Business Rules

**Wallet-Gated Booking (Critical Business Logic):**

| Agent Wallet Status | Free Cancellation Rate | Non-Refundable / Penalized Rate |
|---|---|---|
| Has sufficient credit | Booking allowed | Booking allowed |
| Insufficient / zero credit | Booking allowed | Booking BLOCKED |

- Wallet balance check occurs at booking confirmation, after price check. Required balance is the full booking cost (including all markup layers applicable to that agent's view).
- **Atomic wallet reservation**: Prevent race conditions where two simultaneous bookings both pass the balance check but combined exceed available credit. Database-level locking or reservation-based holds required.
- **Proactive wallet visibility**: Wallet status indicators in search results and rate selection -- not just at booking. Rates requiring wallet credit the agent lacks are visually flagged (e.g., "Requires $X wallet credit").
- **Sub-agent without wallet access**: "Request Wallet Top-Up" action sends notification to super agent with booking details and required amount.

**Partial Refundability Rules:**
- Some rates have mixed cancellation policies (e.g., free cancellation until Date X, then 1-night penalty).
- Wallet gate applies to the **potential penalty amount**, not the full booking cost. If wallet balance covers the maximum possible penalty, booking is allowed.
- If cancellation policy changes after booking (supplier-initiated), system re-evaluates against new policy and alerts the agent if wallet balance no longer covers the updated penalty.

**Auto-Cancellation of Unvouchered Bookings (Critical Business Logic):**

- A booking in "Confirmed" status without a generated voucher is uncommitted inventory.
- **Safety buffer**: Auto-cancellation triggers **2-4 hours BEFORE** the actual supplier cancellation deadline. All deadlines normalized to UTC.
- **Multi-touchpoint warnings**:
  - In-app notification at 48 hours before auto-cancellation
  - Email notification at 48 hours and again at 24 hours
  - Visual countdown on booking card (e.g., "Auto-cancels in 1 day 6 hours unless vouchered")
- **Redundant scheduling**: Auto-cancellation must NOT rely on a single cron job. Required: primary scheduled job, dead-letter queue for failed attempts with automatic retry, admin alerting if cancellation fails after retries, manual admin override for emergency intervention.
- **Supplier API failure during auto-cancel**: Retries with exponential backoff. If all retries fail before real deadline, escalate to admin with critical alert. Booking flagged "Auto-cancel failed -- manual intervention required."
- **Voucher generation = commitment signal**: Once the agent generates the voucher, the booking is committed and will NOT be auto-cancelled.

**Booking Status Lifecycle:**

```
Search -> Price Check -> Book -> Confirmed (unvouchered)
                                    |
                          +---------+---------+
                          |                   |
                   Generate Voucher     Auto-Cancel Timer
                          |                   |
                      Vouchered          Warning (48h, 24h)
                     (committed)         + Visual Countdown
                          |                   |
                     Active Booking    Auto-Cancelled (with safety buffer)
                          |            OR "Auto-cancel failed" (escalated)
                 +--------+--------+
                 |                 |
            Completed        Cancelled/Modified
           (checked out)     (agent-initiated)
```

### Voucher Queue & Batch Operations

- **Voucher Queue** (formerly "Cart"): Agent adds multiple confirmed bookings to a voucher queue during a session. Named to reflect that these are live confirmed bookings awaiting voucher generation -- NOT an e-commerce cart for unbooked items.
- **Batch voucher generation**: Generate vouchers for all queue items with a single click -- individual vouchers per booking, one batch action.
- **Queue persistence**: Survives session (saved to account) until items are vouchered or auto-cancelled.
- **Queue items are live bookings**: Adding to the voucher queue means the booking is already confirmed with the supplier. The queue organizes voucher generation, not unbooked holds.
- **Queue status indicators**: Each item shows auto-cancel countdown, HCN status, and voucher readiness.

### Agent Profile & Settings Area

- **Company/agent details**: Business name, contact information, address, tax ID
- **Logo upload**: Used in quote PDFs and vouchers for branded output. Immediate preview on upload.
- **Quote settings**: Default quote template, branding colors/layout, disclaimer text, default markup percentage
- **HCN email settings**: Configurable sending email address, editable email templates
- **Notification preferences**: Auto-cancellation warnings, HCN status updates, booking confirmations
- **Supplier credentials**: API key configuration for connected suppliers (if applicable)

### Booking Management Area

Full post-booking lifecycle management:

- **Booking list**: All bookings with search, filter (by status, date, hotel, client, voucher status), and sort
- **Booking detail view**: Full reservation details, supplier reference number, HCN status, voucher status, auto-cancel countdown (if unvouchered), cancellation policy, price breakdown (per role visibility rules)
- **Visual indicators per booking card**: Voucher status (vouchered/unvouchered), auto-cancel countdown, HCN verification status, wallet impact
- **Actions per booking**:
  - Generate voucher (changes status to "vouchered"/committed, stops auto-cancel timer)
  - Add to voucher queue (for batch voucher generation)
  - Request modification (date change, guest name change -- subject to supplier support)
  - Cancel booking (with cancellation penalty display and confirmation)
  - Resend HCN verification email
  - Download voucher PDF
  - View booking history / audit trail

### Integration List

| Integration | Purpose | MVP / Post-MVP |
|---|---|---|
| Expedia Rapid API v3 | Hotel search, booking, management. REST with SHA-512 signature auth. Shopping → Price Check → Booking → Management flow. | MVP |
| TBO Holidays API v1.4 | Hotel search, booking, management. REST with Basic Auth. HotelSearch → PreBook → Book → BookingDetail → Cancel flow. Payment modes: Limit (wallet/credit) and credit card. | MVP |
| Vervotech Hotel Mapping API | Cross-supplier hotel deduplication. 400+ suppliers, <24h mapping for integrated suppliers, 99.9%+ accuracy. | MVP |
| Email service (SendGrid/SES) | HCN verification, booking confirmations, auto-cancel warnings, notifications | MVP |
| PDF generation engine | Quote PDFs, hotel vouchers, batch voucher generation | MVP |
| Payment gateway (Stripe/similar) | Wallet top-ups, credit card processing | MVP |
| Accounting/invoicing system | Transaction records, invoice generation for agents | MVP (basic) |
| Analytics platform | Agent-facing analytics, platform-wide metrics for admin | MVP (basic), Growth (advanced) |
| Agoda API | 3rd supplier, expanded inventory | Phase 2 |
| TravelgateX | Switch connectivity to hundreds of additional suppliers | Phase 3 |

### Implementation Considerations

- **Wallet balance checks must be atomic**: Database-level locking or reservation-based holds to prevent race conditions on simultaneous bookings.
- **Auto-cancellation must be bulletproof**: Redundant scheduling, retry with exponential backoff, dead-letter queue, admin escalation. A missed auto-cancellation is a financial liability -- highest-reliability requirement.
- **All cancellation deadlines normalized to UTC**: Suppliers and hotels may express deadlines in different time zones. Normalize on ingestion and apply safety buffer.
- **Voucher generation is the commitment boundary**: Most important status transition in the system. Must be clearly communicated to agents and consistently enforced.
- **Voucher queue items are live bookings**: UX must make this absolutely clear -- agents must understand "adding to queue" doesn't mean "holding" an unbooked room.
- **Progressive feature rollout**: Launch with single-user accounts (freelancer). Agency/team features (RBAC, sub-agent markup, approval workflows) ship in fast-follow. Multi-tenancy architecture must support both from day one even if agency features are disabled at launch.
- **Accounting and analytics are basic at launch**: Transaction history and simple booking reports. Advanced dashboards, exportable reports, and BI integration in growth phase.

## Functional Requirements

### Hotel Search & Discovery

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

### Quote & Itinerary Management

- **FR11**: Agent can add hotel options from search results to a quote across 2 or more cities/destinations (up to 10 cities per quote)
- **FR12**: Agent can select 2-4 hotel options per city and organize them within a quote
- **FR13**: Agent can add notes per city or per hotel option within a quote
- **FR14**: Agent can generate a branded PDF quote/itinerary document with hotel details, images, rates, cancellation terms, and agent branding (logo, company name)
- **FR15**: Agent can send the quote PDF via email or download it for sharing through other channels (WhatsApp, etc.)
- **FR16**: Quote PDF displays only the final client price -- no supplier names, cost prices, or internal markup information

### Booking Flow

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

### Booking Management

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

### HCN Verification

- **FR38**: System automatically sends an HCN verification email to the hotel reservation department after booking confirmation
- **FR39**: Agent can view per-reservation HCN status: Available / Waiting / Email Sent / Confirmed / Mismatch / Issue
- **FR40**: Agent can manually update HCN status and add notes
- **FR41**: Agent can resend HCN verification emails from the booking detail view
- **FR42**: Agent can configure their sending email address for HCN verification in account settings
- **FR43**: Agent can customize the HCN verification email body text, greeting, and closing. The email must always include system-populated, non-removable fields: hotel name, confirmation number, guest name, check-in/check-out dates, and room type. Agent can preview the template before saving.
- **FR44**: Agent can view a dashboard of all bookings with pending/unverified HCN statuses

### Wallet & Finance

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

### User Management & Profile

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

### Platform Administration

- **FR65**: Platform owner can view a dashboard with platform-wide metrics: active agents, booking volume, supplier API health, hotel mapping stats
- **FR66**: Platform owner can monitor supplier API response times and availability status
- **FR67**: Platform owner can manage hotel mapping: review low-confidence matches, manually confirm or reject merges, override mappings
- **FR68**: Platform owner can investigate individual bookings across all agents for support purposes
- **FR69**: Platform owner can view and manage failed auto-cancellation attempts and escalated booking issues
- **FR70**: Platform owner can view all agent accounts and their status across the platform
- **FR71**: Platform owner can override a booking's status (e.g., mark as manually cancelled, force voucher generation) with a mandatory reason note logged in the audit trail
- **FR72**: Platform owner can escalate supplier issues by logging a supplier support ticket reference against a booking, tracking resolution status (Open / Escalated / Resolved), and viewing all open escalations in a filtered dashboard view

## Non-Functional Requirements

### Performance

- **NFR1**: Combined search results from all connected suppliers returned in under 5 seconds for 95th percentile of queries
- **NFR2**: Progressive result loading -- first supplier results displayed within 2 seconds; additional supplier results appended as they arrive
- **NFR3**: Price check / pre-book validation completes in under 3 seconds
- **NFR4**: Booking confirmation response within 10 seconds (dependent on supplier API)
- **NFR5**: Quote PDF generation completes in under 5 seconds for a multi-city quote with up to 12 hotel options
- **NFR6**: Batch voucher generation (up to 10 vouchers) completes in under 15 seconds
- **NFR7**: Dashboard and booking list pages load in under 2 seconds
- **NFR8**: System supports 50 concurrent agent sessions with no degradation in response times
- **NFR9**: Hotel mapping lookups (Vervotech) add no more than 500ms to search response time

### Security

- **NFR10**: PCI DSS compliance -- cardholder data encrypted in transit (TLS 1.2+) and at rest (AES-256). No storage of full card numbers where avoidable; use tokenization.
- **NFR11**: Supplier API credentials stored encrypted at rest, never displayed in full in any UI
- **NFR12**: Agent authentication via industry-standard one-way password hashing with appropriate computational cost factor. Minimum password complexity: 12+ characters, at least one uppercase letter, one lowercase letter, one digit, and one special character. Passwords checked against common breach lists on registration and change.
- **NFR13**: Session management with secure tokens, automatic timeout after 30 minutes of inactivity, secure cookie handling (HttpOnly, Secure, SameSite=Strict). Session invalidated on password change. Maximum 3 concurrent sessions per agent.
- **NFR14**: Role-based data access enforced at the API level -- not just UI-hidden. Sub-agents cannot access supplier names or cost prices even via direct API calls.
- **NFR15**: All financial transactions (wallet top-ups, booking charges, refunds) logged in an immutable audit trail
- **NFR16**: HTTPS enforced on all endpoints. No plaintext HTTP.
- **NFR17**: Input validation and protection against OWASP Top 10 vulnerabilities (SQL injection, XSS, CSRF, etc.)
- **NFR18**: SCA (Strong Customer Authentication) / 3D Secure support for European card payments per PSD2

### Reliability

- **NFR19**: Platform availability 99.5%+ during business hours (06:00-23:00 in agent's configured time zone)
- **NFR20**: Zero data loss on confirmed bookings, financial transactions, and wallet balances under any single-point failure scenario. Data durability and recovery mechanisms must ensure recovery to within 1 minute of failure (RPO < 1 minute). Recovery time objective (RTO) under 4 hours for full platform restoration.
- **NFR21**: Auto-cancellation system reliability: 99.9%+ success rate on scheduled cancellations. Failed cancellations retry and escalate within the safety buffer window.
- **NFR22**: When an individual supplier API is unavailable, the platform continues operating with available suppliers. Specifically: search returns results from responsive suppliers within the 5-second target, displays which supplier(s) are unavailable, and provides a retry action. Booking management, wallet, quote builder, and HCN features remain fully functional regardless of supplier availability. No user-facing errors or blank screens from a single supplier outage.
- **NFR23**: Scheduled job monitoring with alerting for failures (auto-cancellation, HCN emails, mapping syncs). Alerts delivered within 5 minutes of failure detection via email and team messaging channel. Escalation to on-call within 15 minutes if unacknowledged. Alert categories: auto-cancellation failure (Critical), HCN email delivery failure (High), mapping sync failure (Medium).
- **NFR24**: All wallet operations must be fully atomic -- no partial updates, no lost credits, no double-spending under any concurrent access scenario. A booking charge that fails mid-operation must roll back completely, restoring the original balance.

### Scalability

- **NFR25**: System supports scaling to 500 concurrent agents without significant re-architecture. Response time SLAs (NFR1-NFR9) must be maintained at 500-agent load.
- **NFR26**: Adding a new supplier integration requires no changes to core search or booking logic. New supplier onboarding effort must not exceed 2 developer-weeks for a standard PULL-model hotel supplier with documented API.
- **NFR27**: Hotel mapping lookups across 2M+ hotel records from all suppliers must complete in sub-second times (< 500ms p95). Mapping data must be queryable by supplier hotel ID, Apolles canonical ID, or geographic coordinates.
- **NFR28**: Booking and transaction database designed for 100K+ bookings per year without query performance degradation
- **NFR29**: Email delivery system supports 1,000+ emails per day (HCN verification, notifications, auto-cancel warnings)

### Integration

- **NFR30**: All supplier-specific data formats normalized into a unified Apolles data model. Normalization must cover: room types, cancellation policies, tax breakdowns, meal plans, and hotel amenities. Completeness target: 100% of bookable fields mapped for Expedia and TBO at MVP launch.
- **NFR31**: External API calls must fail fast when a supplier is unresponsive (timeout within 5 seconds) and recover automatically when the supplier becomes available again, preventing cascading timeouts across the platform. No single supplier failure may degrade response times for other suppliers or platform features.
- **NFR32**: All external API interactions logged with request/response metadata for debugging and support
- **NFR33**: Supplier API health monitoring with alerting thresholds: alert when average response time exceeds 3 seconds (sustained over 5 minutes) or error rate exceeds 5% (sustained over 5 minutes). Thresholds adjustable per supplier.
- **NFR34**: Vervotech mapping data synchronized at least once per 24 hours with incremental updates
- **NFR35**: Email delivery tracking for HCN verification emails -- delivery status (sent, delivered, bounced) and open tracking. Bounce notifications surfaced to agent within 1 hour. Delivery success rate target: 95%+ for non-bounced addresses.
- **NFR36**: Payment gateway integration supports tokenized card storage (no raw card data stored on Apolles infrastructure) and recurring wallet top-ups. Tokenization success rate: 99.9%+. Stored tokens valid for at least 12 months before re-authentication required.
