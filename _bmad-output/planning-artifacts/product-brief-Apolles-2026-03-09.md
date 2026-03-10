---
stepsCompleted: [1, 2, 3, 4, 5]
inputDocuments:
  - api-docs/Expedia API.rtfd/TXT.rtf
  - api-docs/Agoda API .rtfd/TXT.rtf
  - api-docs/TBOH API Specifications (V1.4) 9.22.pdf
date: 2026-03-09
author: Moshe
---

# Product Brief: Apolles

<!-- Content will be appended sequentially through collaborative workflow steps -->

## Executive Summary

Apolles is a B2B hotel booking platform built for travel agents who need to search, compare, quote, and book hotels across multiple suppliers — all from a single modern interface. Today, travel agents waste significant time switching between outdated supplier portals (Hotelbeds, TBO Holidays, RateHawk, etc.), manually assembling hotel quotes in documents, and chasing hotels to verify confirmation numbers. Apolles solves this by aggregating supplier inventory into one fast search, providing a built-in quote/itinerary PDF builder for multi-city trips, automating hotel confirmation number (HCN) verification via email, and delivering a modern, intuitive user experience that the current market lacks. In a future phase, an AI-powered conversational search assistant will allow agents to find hotels using natural language prompts, further streamlining the discovery and booking workflow.

---

## Core Vision

### Problem Statement

Travel agents operating in the B2B hotel market face a fragmented, manual, and error-prone workflow. To find the best rates, they must search multiple supplier portals individually — each with its own interface, login, and search flow. Once they find suitable options, there is no tool to compile multi-city, multi-hotel quotes into a single professional document they can share with clients. After booking, agents must manually contact hotels to verify that the reservation details (dates, room type, guest names) match what the supplier confirmed — a process that is entirely manual and easy to neglect. When verification is missed, guests arrive to find no reservation or the wrong room — an event that occurs roughly once every 20-30 bookings.

### Problem Impact

- **Time waste**: Agents spend significant time per booking searching across portals, copy-pasting rates into manual quote documents, and sending individual verification emails to hotels.
- **Revenue risk**: Unverified or mismatched reservations damage client trust and can result in costly emergency rebookings or compensation.
- **Client experience**: Agents cannot present professional, branded quote documents — they rely on improvised Word/Excel files or plain text, reducing their perceived professionalism.
- **Missed bookings**: Slow search across multiple portals means agents may miss better rates or availability, directly impacting margins and client satisfaction.

### Why Existing Solutions Fall Short

Current platforms in the market — including Hotelbeds, TBO Holidays, RateHawk, and Arbitrip — each address only a piece of the problem:

- **No multi-supplier aggregation**: Most platforms show only their own inventory, forcing agents to search each one separately.
- **No quote/itinerary module**: None of the major platforms offer a built-in tool to compile multi-city, multi-hotel option quotes into a shareable PDF. Arbitrip has better UX than others but still lacks a quote module.
- **No HCN verification automation**: No existing platform automates the process of emailing hotels to verify confirmation numbers and reservation details. This remains entirely manual.
- **Outdated UX**: Most B2B hotel platforms look and feel dated, with cluttered interfaces and slow workflows that don't match modern expectations.
- **No AI-assisted search**: None offer conversational, natural-language hotel discovery — agents must always use structured search forms.

### Proposed Solution

Apolles addresses the full agent workflow end-to-end:

1. **Multi-supplier search engine**: The core booking platform search queries multiple supplier APIs in parallel, returning combined hotel results in a single unified view with clear rate comparison across suppliers.
2. **Quote/Itinerary PDF builder**: Agents can run searches across multiple cities and dates, select 2-4 hotel options per city, and generate a professional PDF quote document to share with clients. Once the client chooses, the agent books and sends separate hotel vouchers.
3. **HCN verification system**: Each reservation page includes an HCN status tracker (available, waiting, email sent, mismatch, issue). The system can automatically email the hotel's reservation department using details from the supplier data, requesting confirmation. Agents configure a dedicated sending email address and customizable email template in their settings.
4. **Modern UX**: A clean, fast, intuitive interface designed for the daily workflow of professional travel agents.
5. **AI-powered search assistant (Phase 2)**: A conversational chat interface where agents can describe what they need in natural language (e.g., "find me the best hotel in Rome for a family of 4 under $200/night"). The AI translates prompts into structured supplier queries, returns real results, and allows agents to book or add results directly to quotes — all from within the chat.

### Key Differentiators

- **Multi-supplier aggregation + quote builder**: No competitor combines fast multi-supplier search with a structured quote/itinerary PDF workflow. This is a genuine market gap.
- **HCN automation**: Automated hotel confirmation verification is not offered by any major B2B platform — this directly prevents the 1-in-20-30 reservation mismatch problem.
- **Agent-centric design**: Built around how travel agents actually work — search, compare, quote, book, verify — rather than forcing them to adapt to a supplier-centric interface.
- **Speed**: Parallel supplier queries designed to return results fast, eliminating the sequential search pattern agents endure today.
- **AI search assistant (Phase 2)**: Natural language hotel discovery integrated directly into the booking and quoting workflow — a capability no B2B hotel platform currently offers.

---

## Target Users

### Primary Users

#### Persona 1: Yael — Freelance Travel Agent

- **Role**: Independent freelance travel agent, one-person operation
- **Context**: Works from home or a small office, handles everything herself — search, quotes, bookings, client communication, and post-booking verification. She is both the super agent and only user on her account.
- **Volume**: 2-10 bookings per day, with peaks during holiday seasons. Sends multiple quote PDFs daily to clients comparing hotel options across destinations.
- **Current pain**: Juggles 3-4 supplier portals open in browser tabs, copies rates into Excel/Word to build quotes manually, and often forgets to verify HCNs with hotels because there's no time. Has had clients arrive at hotels with mismatched reservations.
- **Motivation**: Needs speed and efficiency — every minute saved on manual work means more clients served and more revenue.
- **Success moment**: Sends a professional multi-city quote PDF to a client within minutes of their request, books the chosen option in two clicks, and sees the HCN auto-verified without lifting a finger.

#### Persona 2: David — Agency Owner / Super Agent

- **Role**: Owner or manager of a small-to-medium travel agency (3-15 agents)
- **Context**: Manages a team of sub agents. Needs visibility into bookings, margins, and team activity. Controls what each agent can do — who can book, who can only quote, who sees pricing margins, who accesses the finance wallet.
- **Volume**: Agency handles 20-80+ bookings per day across all agents.
- **Current pain**: No centralized platform — each agent uses different supplier portals with different logins. No unified view of agency performance, margins, or booking status. Cannot control agent permissions or visibility into pricing.
- **Motivation**: Wants operational control, margin visibility, and a professional tool that makes his agency look modern to clients.
- **Success moment**: Opens his dashboard, sees all agent activity, booking margins, and HCN statuses across the agency. Onboards a new agent in minutes with the right permission set.

#### Persona 3: Noa — Sub Agent at an Agency

- **Role**: Travel agent working under an agency, reporting to a super agent
- **Context**: Handles day-to-day client requests — searching, quoting, and booking. Works within the permissions set by her agency owner. May not see internal margins or have access to financial features.
- **Volume**: 2-10 bookings per day, multiple quote requests.
- **Current pain**: Same fragmented search experience as freelancers, but also lacks autonomy — has to ask the manager for approvals or information that could be self-service with proper permissions.
- **Motivation**: Wants a fast, intuitive tool that lets her serve clients quickly without unnecessary friction or waiting on manager approvals for routine tasks.
- **Success moment**: Searches across all suppliers in one go, builds a beautiful quote, sends it to the client, and books — all within her permitted workflow, no bottlenecks.

### Secondary Users

#### Finance / Accounting Staff

- **Role**: At medium agencies, a dedicated person (or the owner wearing another hat) who manages wallet top-ups, reviews transaction history, invoices, and margin reports.
- **Interaction**: Does not search or book. Accesses financial reports, wallet balance, and payment history. Needs read-only or finance-scoped access.

#### The End Client (Traveler)

- **Role**: The traveler or corporate client who receives quote PDFs and hotel vouchers from the agent.
- **Interaction**: Never logs into Apolles. Receives professionally formatted quote PDFs via email/WhatsApp, reviews options, communicates preference back to the agent, and later receives booking vouchers. Their experience of Apolles is entirely through the documents the agent shares.

### User Journey

#### Discovery & Onboarding
1. Agent or agency owner discovers Apolles through industry word-of-mouth, online search, or trade events.
2. Signs up and configures their account — freelancers set up as a single super agent; agencies create their team structure with sub agents and permissions.
3. Connects supplier credentials (TBO, Expedia, Agoda, etc.) to enable multi-supplier search.

#### Core Daily Usage
1. Receives client request for hotels in one or more cities.
2. Runs searches across cities/dates — results from all connected suppliers appear in a single unified view.
3. Selects 2-4 hotel options per city, adds them to a quote.
4. Generates and sends a professional PDF quote/itinerary to the client.
5. Client responds with selection — agent books through Apolles.
6. System automatically sends HCN verification email to the hotel.
7. Agent monitors HCN status on the reservation page (confirmed / pending / mismatch).
8. Sends hotel voucher to the client (separate from the quote).

#### Success & Retention
- **Aha moment**: The first time an agent builds and sends a multi-city quote PDF in under 5 minutes — something that used to take 30+ minutes.
- **Long-term value**: HCN automation eliminates reservation mismatches. Speed gains compound as agents handle more volume. Agency owners gain operational visibility they never had before.

---

## Success Metrics

### User Success Metrics

- **HCN mismatch reduction**: Reduce reservation mismatches from ~1 in 20-30 bookings to near zero through automated HCN verification emails and status tracking.
- **Quote generation speed**: Agents can build and send a multi-city, multi-hotel PDF quote in under 5 minutes (vs. 30+ minutes manually).
- **Search efficiency**: Agents search once and see results from all connected suppliers — eliminating the need to search 3-4 portals individually.
- **Daily active usage**: Agents log in daily and use Apolles as their primary booking tool, replacing the multi-portal workflow.
- **AI search adoption (Phase 2)**: Agents actively use the AI chat to discover hotels via natural language prompts, reducing time spent on structured search forms.

### Business Objectives

- **12-month gross booking volume**: $1,000,000 in total hotel bookings processed through the platform within the first 12 months.
- **Agent acquisition**: 50 agents onboarded within the first 12 months (mix of freelancers and small-medium agency teams).
- **Markup revenue**: 10-15% markup on supplier rates, generating $100,000-$150,000 in gross revenue on the $1M booking target.
- **Agent retention**: Daily login rate as the primary health indicator — agents who log in daily are retained; drop-off in daily usage is an early churn signal.

### Key Performance Indicators

| KPI | Target | Timeframe | Measurement |
|-----|--------|-----------|-------------|
| Gross booking volume | $1,000,000 | 12 months | Total hotel booking value processed |
| Agents onboarded | 50 | 12 months | Registered and active agents |
| Markup revenue | $100K-$150K | 12 months | 10-15% of gross booking volume |
| Daily active agents | 70%+ of onboarded | Ongoing | Agents logging in daily |
| HCN mismatch rate | <1% of bookings | Ongoing | Bookings with confirmed HCN vs. mismatches |
| Quote PDF usage | 60%+ of agents | Ongoing | Agents who generate at least 1 quote PDF per week |
| Average search-to-book time | <5 minutes | Ongoing | Time from first search to completed booking |
| Agent churn rate | <10% monthly | Ongoing | Agents inactive for 14+ consecutive days |

---

## MVP Scope

### Core Features

**1. Multi-Supplier Hotel Search Engine (PULL-only)**
- Launch with Expedia Rapid API + TBO Holidays API (Agoda in Phase 2)
- Parallel real-time queries to both suppliers, unified search results view
- Standard structured search: destination (city/area), check-in/check-out dates, rooms, adults, children with ages
- Rate comparison across suppliers for the same hotel (powered by hotel mapping)
- Room-level details: bed types, cancellation policy, meal plans, refundability status
- Clean provider abstraction layer enabling future supplier/switch/channel manager additions without refactoring
- Full compliance with Expedia B2B display requirements (non-refundable flags, cancellation policies, check-in instructions, fee breakdowns, legally required tax disclaimers)

**2. Hotel Mapping Integration (Vervotech)**
- First-class system component — not an afterthought
- Cross-supplier hotel deduplication using Vervotech (or equivalent mapping service)
- Map Expedia property IDs to TBO hotel codes to identify same physical hotels
- Confidence scoring: high-confidence matches merge into one hotel card; low-confidence matches displayed separately to avoid incorrect merging
- Manual override capability for mapping corrections
- Foundation for adding future suppliers without duplicate results

**3. Quote / Itinerary PDF Builder**
- Multi-city, multi-hotel quote assembly from search results
- Agent selects 2-4 hotel options per city, adds to quote
- Professional branded PDF generation with hotel details, images, rates, and cancellation terms
- Send PDF to client via email (or download for WhatsApp/other sharing)
- Separate hotel voucher generation after booking is confirmed

**4. Booking Flow**
- Select room/rate from search results -> price check/pre-book validation -> book
- Collect guest details, payment info per Expedia/TBO requirements
- Booking confirmation with supplier reference number and Apolles internal booking ID
- Booking history with search/filter/status view
- Cancellation flow with penalty display and confirmation
- Multi-room booking support (per Expedia TR6 requirement)
- Designed from day one to pass Expedia B2B site review: SSL encryption, SCA compliance, proper price display with tax breakdowns, payment processing country, check-in instructions, downstream agent T&C acceptance

**5. HCN (Hotel Confirmation Number) Verification System**
- Per-reservation status tracker: Available / Waiting / Email Sent / Confirmed / Mismatch / Issue
- Automated email to hotel reservation department using supplier-provided hotel contact data
- Agent-configurable sending email address in account settings
- Customizable email template (editable by the agent)
- Dashboard view of all pending/unverified HCNs

**6. User Management (Simplified for Launch)**
- Single-user (freelancer) account model at launch — optimized for the Yael persona
- Agent registration, login, profile, and account settings
- Supplier credential configuration (connect Expedia/TBO API keys)
- HCN email settings and template management
- Foundation for RBAC expansion in fast-follow (super agent/sub agent hierarchy, permissions, team management)

**7. Finance Basics (Simplified for Launch)**
- Markup configuration on supplier rates (agent sets their margin, default 10-15%)
- Simple credit balance for supplier payments
- Basic transaction history (bookings, charges, top-ups)
- Foundation for full wallet system with top-up mechanisms and margin visibility controls in fast-follow

### Out of Scope for MVP

- **Full RBAC (super agent / sub agent hierarchy)** — fast-follow after launch; MVP serves single-user freelancers
- **Full wallet system with top-up flows** — fast-follow; MVP uses simple credit balance
- **AI-powered search assistant** — Phase 2
- **Agoda API integration** — Phase 2, first supplier addition post-launch
- **TravelgateX (switch) integration** — Phase 3
- **Direct channel manager connections (Omnibees, Dingus)** — Phase 3; clean provider abstraction in place but no speculative adapters built until commercial agreements and APIs exist
- **PUSH connectivity model** — deferred until channel manager connections require it
- **GDS connectivity** (Amadeus, Sabre) — not in scope
- **Advanced analytics / BI dashboards** — basic transaction history only for MVP
- **White-label / multi-brand support** — single brand (Apolles) for MVP
- **Mobile app** — web-only for MVP (responsive design)
- **Multi-currency wallet** — single currency for MVP

### MVP Success Criteria

- Agents can search Expedia + TBO simultaneously and see deduplicated results in under 5 seconds
- Agents can build and send a multi-city quote PDF in under 5 minutes
- HCN verification email is automatically sent within minutes of booking confirmation
- Platform passes Expedia B2B site review and TBO certification
- Hotel mapping achieves 95%+ accuracy with no false merges shown to agents
- 10 agents onboarded and actively booking within first 2 months of launch
- Zero critical UX issues in the booking flow (the highest-stakes user journey)

### Future Vision

**Fast-Follow (weeks after launch):**
- Full RBAC: super agent / sub agent hierarchy, permissions (book, quote-only, view margins, manage agents)
- Full wallet: top-up mechanisms, margin visibility controls tied to RBAC
- Agency-level accounts with team management and dashboards

**Phase 2: Expand Supplier Coverage + AI Search**
- Agoda API integration (3rd supplier)
- AI-powered conversational search assistant (natural language -> structured supplier queries)
- Enhanced analytics and reporting dashboard

**Phase 3: Connectivity Expansion**
- TravelgateX switch integration (access to hundreds of additional suppliers)
- Direct PULL connections to channel managers (Omnibees, Dingus) where commercially and technically feasible
- Apolles established as a recognized demand channel in channel manager ecosystems

**Phase 4: Platform Maturity**
- PUSH connectivity support for channel managers that require it
- Advanced revenue management tools (dynamic markup, competitor rate monitoring)
- Mobile app
- Multi-currency wallet and expanded payment options
- White-label capability for agency branding
- GDS connectivity if market demands it
