---
stepsCompleted:
  - step-01-document-discovery
  - step-02-prd-analysis
  - step-03-epic-coverage-validation
  - step-04-ux-alignment
  - step-05-epic-quality-review
  - step-06-final-assessment
filesSelected:
  prd: /Users/moshezafrani/developer 3/Apolles - Lean/_bmad-output/planning-artifacts/prd.md
  architecture: /Users/moshezafrani/developer 3/Apolles - Lean/_bmad-output/planning-artifacts/architecture.md
  epics: /Users/moshezafrani/developer 3/Apolles - Lean/_bmad-output/planning-artifacts/epics.md
  ux: /Users/moshezafrani/developer 3/Apolles - Lean/_bmad-output/planning-artifacts/ux-design-specification.md
---

# Implementation Readiness Assessment Report

**Date:** 2026-03-11
**Project:** Apolles

## Document Discovery

### PRD Files Found
- Whole: `prd.md` (47,322 bytes, modified Mar 11 15:04:54 2026)
- Sharded: None

### Architecture Files Found
- Whole: `architecture.md` (52,041 bytes, modified Mar 11 17:16:38 2026)
- Sharded: None

### Epics & Stories Files Found
- Whole: `epics.md` (59,319 bytes, modified Mar 11 18:58:43 2026)
- Sharded: None

### UX Design Files Found
- Whole: `ux-design-specification.md` (76,024 bytes, modified Mar 11 15:32:06 2026)
- Sharded: None

### Discovery Issues
- No duplicate whole/sharded format conflicts found
- No missing required document types

## PRD Analysis

### Functional Requirements

FR1: Agent can log in with email and password.
FR2: Agent can log out, ending their session.
FR3: Admin can create a new agent account with name, email, and initial password.
FR4: Admin can deactivate an agent account, preventing login.
FR5: Admin can view a list of all agent accounts with status (active/inactive).
FR6: Agent can search for hotels by destination (city name, free text), check-in date, check-out date, number of rooms (1 at MVP), adults per room, and children with ages.
FR7: System queries both TBO Holidays and Expedia Rapid APIs in parallel and returns combined results displaying: hotel name, star rating, image, starting price (with platform markup applied).
FR7a: Results from each supplier are displayed independently. The same physical hotel may appear more than once (once per supplier). No deduplication or merging in MVP. Each result carries a neutral source indicator (e.g., "Source A" / "Source B") so agents can distinguish origins without seeing supplier branding.
FR8: Agent can filter search results by price range and star rating.
FR9: Agent can sort search results by price or star rating.
FR10: If one supplier API fails or times out (5-second timeout), the system displays results from the responsive supplier(s), shows a visible indicator that one supplier is unavailable, and provides a "Retry" action for the failed supplier.
FR10a: If both suppliers fail, the system displays a clear error message and a "Retry All" action.
FR11: Agent can view a list of rooms for a selected hotel.
FR12: Each room displays: room name, bed type, cancellation policy (dates and penalty amounts), meal plan, refundability status, and total price (with markup applied).
FR13: Taxes and fees are shown as provided by each supplier. For Expedia rates, the legally mandated tax disclaimer text is displayed.
FR14: Agent can select a room/rate and proceed to booking. Booking is routed to whichever supplier returned the selected rate.
FR15: System performs a price recheck with the originating supplier (TBO or Expedia) before confirming the booking.
FR16: If the price changed since search, the system displays the updated price and lets the agent decide to proceed or cancel.
FR17: Agent can enter guest details: full name (required), email (optional), phone (optional), special requests (free text, optional).
FR17a: For Expedia bookings: system collects card details via PCI-certified hosted payment fields (e.g., Stripe Elements iframe). No raw card data touches Apolles servers. Tokenized payment reference is passed to Expedia. This is the only Expedia payment path at MVP - no alternative payment methods.
FR18: Agent can review a booking summary showing: hotel name, room type, dates, guest name(s), total price, and cancellation terms before confirming.
FR18a: For Expedia rates, the booking summary includes Expedia-mandated display elements: tax disclaimer text, cancellation policy, and payment processing country.
FR19: Agent can confirm or go back to edit from the booking summary.
FR20: System displays a booking confirmation with: supplier reference number (from TBO or Expedia), Apolles booking ID, hotel name, room type, dates, guest name(s), total price, and booking status.
FR21: Confirmation page provides a clear indication that the booking is confirmed.
FR21a: Every booking has exactly one status at any time. Status transitions are persisted with a timestamp.
FR21b: `price_changed` is a transient state. If the agent accepts the new price, the booking returns to `pending` and proceeds to supplier confirmation. If the agent abandons, no booking record is created.
FR21c: `confirmed` is the only status from which a voucher can be generated.
FR21d: `failed` bookings display the failure reason to the agent (e.g., "Rate no longer available", "Supplier error").
FR21e: Admin can view bookings in all statuses. Agents see only their own bookings in all statuses.
FR22: Agent can generate a PDF voucher for a confirmed booking.
FR23: Voucher displays: hotel name, hotel address, check-in/out dates, room type, guest name(s), confirmation number, and agent company name.
FR24: Agent can download the voucher as a PDF file.
FR25: One voucher per booking. No queue, no batch.
FR26: Agent can view a list of all their bookings.
FR27: Agent can filter reservations by status (confirmed, cancelled, completed) and date range.
FR28: Agent can sort reservations by date or status.
FR29: Agent can search reservations by guest name or booking reference number.
FR30: Agent can view full reservation details: hotel, dates, room, guest(s), reference numbers, current status, cancellation terms (what the penalty would be), and voucher download/generate button.
FR31: Admin can set a single platform-wide markup percentage.
FR32: System applies the markup to all supplier rates (TBO and Expedia) server-side before returning prices to agents.
FR33: Agent sees the marked-up price as their cost. Supplier cost and markup amount are hidden from agents.
FR34: Admin can view all bookings across all agents.
FR35: Admin can filter bookings by agent, date range, and status.
FR36: Admin can view full booking details for any booking (for support purposes).
FR37: System logs every supplier API call (TBO and Expedia) to the database: supplier name, endpoint/method, request timestamp, response latency, HTTP status, and error details (if any).
FR38: Admin can view recent supplier API logs with filtering by supplier, method, status, and date range.
FR39: Admin can identify failed or slow API calls for debugging per supplier.
FR40: Admin can list all agents with name, email, status, and date created.
FR41: Admin can create a new agent account.
FR42: Admin can deactivate an agent account.
FR43: System implements a common supplier interface with methods: `search()`, `priceCheck()`, `book()`, `cancel()`, `getBookingDetail()`.
FR44: TBO adapter implements this interface, handling TBO-specific API authentication (Basic Auth), request/response format translation, and error handling.
FR44a: Expedia adapter implements this interface, handling Expedia-specific API authentication (SHA-512 signature), request/response format translation, Expedia display requirement metadata, and error handling.
FR45: All supplier API calls are logged to the database (supplier, method, latency, status, error).
FR46: Each API call has a 5-second timeout per supplier.
FR47: Both adapters normalize supplier-specific data into a common Apolles data model for hotels, rooms, rates, and cancellation policies. No mapping layer, no deduplication layer, no merge logic. Each supplier's results retain their supplier context internally (hidden from agent).
FR48: Adding a third supplier requires implementing the same interface without changing core booking logic.
FR49: Every search result is a supplier-specific result. It is tied to: a specific supplier (TBO or Expedia), the supplier's own hotel identifier, and the supplier's rate context (room, rate plan, cancellation policy, price).
FR50: Booking always starts from a concrete supplier result. There is no path to initiate a booking from a merged or abstract hotel concept. The booking flow receives the supplier identifier and supplier-specific rate reference as input.
FR51: The normalized Apolles data model (hotel name, rooms, rates, cancellation policies) is a display and storage normalization - not a cross-supplier identity layer. Two results with the same hotel name from different suppliers are two separate result objects with no link between them.
FR52: The booking record stores: the originating supplier, the supplier's hotel ID, the supplier's booking reference, and the supplier-specific rate details at the time of booking. This supplier context is the source of truth for all post-booking operations (detail lookup, cancellation).

Total FRs: 61

### Non-Functional Requirements

NFR1: Combined search results from both suppliers returned in under 5 seconds for 95th percentile of queries. First supplier results displayed as soon as they arrive; second supplier results appended when ready (progressive loading).
NFR2: Price recheck / pre-book validation completes in under 3 seconds (per supplier).
NFR3: Booking confirmation response within 10 seconds (dependent on supplier API).
NFR4: Voucher PDF generation completes in under 5 seconds.
NFR5: All pages (dashboard, reservations list, admin views) load in under 2 seconds.
NFR6: System supports 20 concurrent agent sessions with no degradation in response times.
NFR7: Agent passwords stored using industry-standard one-way hashing (e.g., bcrypt) with appropriate cost factor.
NFR8: Session management with secure tokens, automatic timeout after 30 minutes of inactivity, secure cookie handling (HttpOnly, Secure, SameSite).
NFR9: HTTPS enforced on all endpoints. No plaintext HTTP.
NFR10: All supplier API credentials (TBO and Expedia) stored encrypted at rest, never displayed in any UI.
NFR10a: Payment card data for Expedia bookings handled exclusively through PCI-certified hosted payment fields. No raw cardholder data stored or transmitted by Apolles servers.
NFR11: Input validation and protection against OWASP Top 10 (SQL injection, XSS, CSRF).
NFR12: Role-based data access enforced at the API level - agents cannot access admin endpoints or other agents' data even via direct API calls.
NFR13: Platform availability 99%+ during business hours.
NFR14: Zero data loss on confirmed bookings. Database backups with recovery to within 1 hour of failure (RPO < 1 hour).
NFR15: When one supplier API is unavailable, the platform continues operating with the other supplier. Search returns results from the responsive supplier, displays which supplier is unavailable, and provides a retry action. All non-search features (reservations, admin, voucher download) remain functional regardless of supplier availability.
NFR16: All booking-related database operations use transactions to prevent partial writes.
NFR17: System supports scaling to 50 concurrent agents without re-architecture.
NFR18: Adding a new supplier integration requires no changes to core search or booking logic.
NFR19: Booking database supports 10,000+ bookings per year without query performance degradation.
NFR20: All supplier-specific data formats (TBO and Expedia) normalized into a common Apolles data model covering: room types, cancellation policies, tax breakdowns, meal plans. 100% of bookable fields mapped for both suppliers at launch.
NFR21: External API calls fail fast (5-second timeout per supplier) and display clear error to agent. No single supplier failure may degrade response times for the other supplier or non-search platform features.
NFR22: All external API interactions logged with request/response metadata for debugging, per supplier.

Total NFRs: 23

### Additional Requirements

- Constraint: Expedia B2B site review certification is a hard pre-launch gate for production Expedia bookings.
- Constraint: Expedia partner charge labels must use "affiliate booking charge" or "affiliate service charge," not "fee".
- Constraint: Supplier branding must be hidden in agent UI; neutral source indicators are required.
- Constraint: Dynamic legal disclaimers and supplier-specific tax text must be rendered based on sourcing supplier.
- Constraint: Expedia payment path is single-path tokenized hosted fields only at MVP.
- Constraint: Tenant data isolation is mandatory; agents cannot access each other's data.
- Assumption: No hotel mapping/deduplication in MVP; same hotel may appear multiple times across suppliers.
- Assumption: No wallet, no quote builder, no HCN automation, no full RBAC hierarchy in MVP.

### PRD Completeness Assessment

The PRD is complete and implementation-oriented for MVP scope, with explicit functional and non-functional requirements, clear in-scope/out-of-scope boundaries, and supplier-specific compliance obligations. It includes a consistent operating model (dual-supplier, no deduplication), detailed booking lifecycle semantics, and concrete constraints that can be traced into stories and architecture validation in subsequent steps.

## Epic Coverage Validation

### Coverage Matrix

| FR Number | PRD Requirement | Epic Coverage | Status |
| --- | --- | --- | --- |
| FR1 | Agent login with email/password | Epic 1 | Covered |
| FR2 | Agent logout | Epic 1 | Covered |
| FR3 | Admin creates agent account | Epic 1 | Covered |
| FR4 | Admin deactivates agent account | Epic 1 | Covered |
| FR5 | Admin views agent list | Epic 1 | Covered |
| FR6 | Hotel search inputs | Epic 2 | Covered |
| FR7 | Parallel TBO + Expedia search with markup | Epic 2 | Covered |
| FR7a | Supplier-specific results + neutral source indicator | Epic 3 | Covered |
| FR8 | Filter results by price and stars | Epic 3 | Covered |
| FR9 | Sort results by price and stars | Epic 3 | Covered |
| FR10 | Single-supplier failure handling with retry | Epic 2 | Covered |
| FR10a | Both suppliers fail handling | Epic 2 | Covered |
| FR11 | Room list for selected hotel | Epic 3 | Covered |
| FR12 | Room detail fields and total price | Epic 3 | Covered |
| FR13 | Supplier tax/fee display and Expedia disclaimer | Epic 3 | Covered |
| FR14 | Booking routed to originating supplier | Epic 4 | Covered |
| FR15 | Price recheck before booking | Epic 4 | Covered |
| FR16 | Price change decision flow | Epic 4 | Covered |
| FR17 | Guest details form | Epic 4 | Covered |
| FR17a | Expedia hosted payment tokenization path | Epic 4 | Covered |
| FR18 | Booking summary/review details | Epic 4 | Covered |
| FR18a | Expedia-mandated booking display elements | Epic 4 | Covered |
| FR19 | Confirm or edit from summary | Epic 4 | Covered |
| FR20 | Booking confirmation details and references | Epic 4 | Covered |
| FR21 | Clear confirmed indication | Epic 4 | Covered |
| FR21a | Single status per booking + timestamped transitions | Epic 4 (`FR21a-e`) | Covered |
| FR21b | `price_changed` transient lifecycle behavior | Epic 4 (`FR21a-e`) | Covered |
| FR21c | Voucher only from `confirmed` | Epic 4 (`FR21a-e`) | Covered |
| FR21d | Failed booking reason shown to agent | Epic 4 (`FR21a-e`) | Covered |
| FR21e | Admin sees all statuses, agent sees own statuses | Epic 4 (`FR21a-e`) | Covered |
| FR22 | Generate PDF voucher for confirmed booking | Epic 5 | Covered |
| FR23 | Voucher content requirements | Epic 5 | Covered |
| FR24 | Download voucher PDF | Epic 5 | Covered |
| FR25 | One voucher per booking, no queue/batch | Epic 5 | Covered |
| FR26 | Agent reservations list | Epic 5 | Covered |
| FR27 | Reservation filtering | Epic 5 | Covered |
| FR28 | Reservation sorting | Epic 5 | Covered |
| FR29 | Reservation search | Epic 5 | Covered |
| FR30 | Reservation detail page | Epic 5 | Covered |
| FR31 | Admin sets platform markup | Epic 6 | Covered |
| FR32 | Markup applied server-side before display | Epic 2 | Covered |
| FR33 | Agent sees marked-up price only | Epic 2 | Covered |
| FR34 | Admin sees all bookings | Epic 6 | Covered |
| FR35 | Admin filters bookings | Epic 6 | Covered |
| FR36 | Admin booking detail visibility | Epic 6 | Covered |
| FR37 | Supplier API logging | Epic 6 | Covered |
| FR38 | Admin supplier log view/filter | Epic 6 | Covered |
| FR39 | Admin identifies failed/slow supplier calls | Epic 6 | Covered |
| FR40 | Admin lists all agents | Epic 1 | Covered |
| FR41 | Admin creates agent | Epic 1 | Covered |
| FR42 | Admin deactivates agent | Epic 1 | Covered |
| FR43 | Common supplier interface | Epic 2 | Covered |
| FR44 | TBO adapter implementation | Epic 2 | Covered |
| FR44a | Expedia adapter implementation | Epic 2 | Covered |
| FR45 | Supplier API logging details | Epic 2 | Covered |
| FR46 | 5-second timeout per supplier call | Epic 2 | Covered |
| FR47 | Normalized model, no mapping/dedup/merge | Epic 2 | Covered |
| FR48 | Add supplier without core logic changes | Epic 2 | Covered |
| FR49 | Supplier-specific search result object | Epic 2 (`FR49-52`) | Covered |
| FR50 | Booking starts from concrete supplier result | Epic 2 (`FR49-52`) | Covered |
| FR51 | Normalization without cross-supplier identity linking | Epic 2 (`FR49-52`) | Covered |
| FR52 | Booking record stores supplier origin context | Epic 2 (`FR49-52`) and Epic 4 | Covered |

### Missing Requirements

- No uncovered FRs found.
- No epics-only FR entries found that are absent from the PRD; grouped epic map entries (`FR21a-e`, `FR49-52`) map cleanly to the corresponding individual PRD requirements.

### Coverage Statistics

- Total PRD FRs: 61
- FRs covered in epics: 61
- Coverage percentage: 100%

## UX Alignment Assessment

### UX Document Status

Found: `ux-design-specification.md` (whole document)

### Alignment Issues

- Minor mismatch (UX vs architecture): UX navigation pattern section lists separate admin nav items `Agents` and `Markup`, while page hierarchy and architecture define a single `Platform Settings` page that contains both sections.
- Minor mismatch (UX internal consistency): UX says no agent settings page at MVP in sidebar section, but later navigation pattern text includes `Settings` in agent navigation.
- Minor mismatch (PRD/architecture vs UX details): UX SearchForm includes nationality/residency fields as required; PRD FR6 does not explicitly list these fields, and architecture schema currently shows `nationality` but not explicit `residency` in search action example.

### Warnings

- No critical UX-PRD-architecture misalignment found for MVP core flow (search -> room details -> booking with recheck/payment -> confirmation -> voucher -> reservations -> admin ops).
- Architecture supports UX-critical behaviors: progressive loading, partial supplier failure handling, neutral source indicators, Expedia hosted payment step, price-change notice, and role-based supplier visibility.
- Recommend a quick alignment edit pass across PRD/UX/architecture wording for search input fields and nav labels to remove ambiguity before implementation starts.

## Epic Quality Review

### Best-Practice Validation Results

- Epic user-value focus: PASS. All 6 MVP epics describe user outcomes (agent booking workflow or admin operational visibility) rather than pure technical milestones.
- Epic independence: PASS. Recommended order is coherent (Epic 1 -> 2 -> 3 -> 4 -> 5 -> 6), and no epic requires a future epic to deliver its stated value.
- Story sizing and completeness: PASS with minor concerns. Stories are implementation-sized with testable acceptance criteria and explicit error paths in most cases.
- Forward dependencies: PASS. No blocking forward references detected inside epic story sequences.
- Database/entity timing: PASS. Foundational auth entities appear early (Epic 1), booking entities created when booking scope starts (Epic 4), and supporting entities are introduced near first use.
- Starter template requirement: PASS. Epic 1 Story 1 explicitly initializes from the architecture-selected starter template.

### Quality Findings by Severity

#### Critical Violations

- None found.

#### Major Issues

- None found.

#### Minor Concerns

- Epic 1 scope mixes user-facing value and foundation setup in one epic narrative; acceptable for greenfield MVP, but could reduce planning clarity if split into explicit user-value objective + enabling technical objective.
- Minor terminology drift across artifacts (`priceCheck` vs `recheckPrice`, and grouped FR references like `FR21a-e` / `FR49-52`); traceability remains intact, but consistent identifiers will reduce implementation ambiguity.

### Remediation Recommendations

1. Normalize requirement terminology and method names across PRD, epics, and architecture (`priceCheck`/`recheckPrice`, FR grouping notation).
2. Keep Epic 1 as-is for MVP speed, but add an explicit sentence in Epic 1 goal separating foundational enablers from immediate user-facing outcomes.
3. During story kickoff, add a lightweight dependency note per story (`depends on prior stories only`) to preserve current independence quality.

## Summary and Recommendations

### Overall Readiness Status

READY

### Critical Issues Requiring Immediate Action

- No critical blockers identified.
- All required planning artifacts are present.
- PRD functional coverage in epics is complete (100%).

### Recommended Next Steps

1. Run a short artifact consistency pass to align terminology and identifiers across `prd.md`, `epics.md`, `architecture.md`, and `ux-design-specification.md`.
2. Resolve minor UX navigation wording inconsistencies (`Settings` vs no settings in MVP, and combined vs separate admin settings labels).
3. Confirm search input contract fields (especially nationality/residency) in PRD and architecture action schemas before implementation starts.

### Final Note

This assessment identified 5 issues across 3 categories (UX alignment wording, cross-document terminology consistency, and minor epic framing clarity). No critical or major issues were found. You can proceed to implementation now, and it is recommended to close the minor consistency gaps first for smoother execution.
