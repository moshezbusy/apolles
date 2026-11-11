# Plan 3: booking (screens 10, 11, 12, 13), wallet payment, cancellation

Spec: section 3 rows 7–13, section 4 (money), section 5 (booking states), section 6 (GR2, GR3,
AP1, BP3, BP4, BP7, ER2, TR1, TR3–TR5, TR7). CLAUDE.md: idempotency, PENDING_CONFIRMATION and
reconciliation, state machine with an audit row, scope by agencyId, never trust the client.

## Booking states (explicit state machine, `src/server/booking/states.ts`)

```
DRAFT ──book──▶ PENDING_CONFIRMATION ──supplier yes──▶ CONFIRMED ──cancel──▶ CANCEL_PENDING ──▶ CANCELLED
  │                    │      ▲                            │                       │
  └──expire──▶ EXPIRED │      └── timeout / no answer      └── supplier ──▶ CANCELLED_BY_SUPPLIER (admin, later)
                       └──supplier no──▶ FAILED                                    └── supplier no ──▶ CONFIRMED
```

- Every change goes through `transition()`: a conditional update ("only if the status is still
  X"), inside a DB transaction, plus one `BookingEvent` row (from, to, actor or system, reason).
- **Money, always in the same transaction-safe ledger calls** (`src/server/wallet/ledger.ts`),
  with idempotency keys derived from the booking id:
  - book: `placeHold` (`booking:<id>:hold`) *before* the supplier call. Insufficient balance →
    the booking stays DRAFT, and the page shows the shortfall.
  - confirmed: `captureHold` (`booking:<id>:capture`) → HOLD_RELEASE + CHARGE.
  - failed: `releaseHold` (`booking:<id>:release`).
  - cancelled: a REFUND credit (`booking:<id>:refund`) of total minus the supplier's cancel
    charge. It is written **only after** the supplier confirms the cancellation.
- **Idempotency:** one draft is one booking. The book action moves DRAFT → PENDING_CONFIRMATION
  with a conditional update first, so a double click or a retry finds it already moving and
  goes to the summary. The draft id is never re-used.
- **Supplier reference:** `affiliate_reference_id` = the Apolles reference (unique, TR1).
- **Timeout or unclear answer** (`SupplierOutcomeUnknown`, timeout): stay PENDING_CONFIRMATION,
  keep the hold, and enqueue `booking.reconcile`. The job looks the booking up at the supplier
  by affiliate reference:
  - found → CONFIRMED + capture;
  - definitely not found on two checks at least 10 minutes apart → FAILED + release;
  - anything else → retry later.
  It never books again.

## Screens

- **10 Guest details** `/book/new?s=&p=&r=&b=`:
  - the rate reference only; the price-check token never leaves the server;
  - a given and family name for every guest;
  - email and phone of the lead guest (TR4, TR5);
  - no "Choose from clients";
  - creates the DRAFT.
- **11 Review & book** `/book/[id]`:
  - a fresh price check on the server;
  - old price next to the new one when it changed;
  - the full price breakdown (BP5), fees at the property (BP4), the full cancellation policy
    (BP3), bed type with the request note (AP1), and the guests with children's ages (BP7);
  - the balance and, when it is short, the amount missing plus the bank transfer details;
  - one terms box with the agent terms and "Supplier Terms & Conditions" links (GR2, GR3);
  - Apolles support details (ER2);
  - one button: "Book and issue voucher".
- **12 Booking summary** `/bookings/[id]`:
  - the Apolles reference, the hotel confirmation number and the status;
  - a "waiting for the hotel" state, with the amount on hold;
  - the price, policies and guests;
  - Cancel, with today's cancellation charge shown first;
  - voucher and invoice come in plan 4.
- **13 Bookings list** `/bookings`:
  - status tabs (All, Upcoming, Pending, Cancelled);
  - search by reference, guest or hotel;
  - pages and a CSV export;
  - every query scoped by agency.

## Supplier adapter

`book`, `retrieveByAffiliateReference`, `retrieve`, `cancelRoom` in the Expedia adapter, built
from the official spec examples (fixtures), with the Test header on staging. The fake supplier
gets the same methods for development and the staging demo.

## Tasks

1. Prisma `Booking`, `BookingEvent`, `BookingStatus` + migration; `states.ts` with `transition()`.
2. Booking service:
   - `createDraft`, `prepareReview` (price check), `book`, `reconcile`, `cancel`;
   - tests for every money path: success, refusal, timeout, double click, insufficient
     balance, cancel with charge, cancel refused.
3. Supplier `book/retrieve/cancel`: Expedia adapter (fixtures), fake.
4. Screens 10, 11, 12, 13 + CSV route; Book room button enabled.
5. `booking.reconcile` job kind + handler.
6. e2e: search → book → summary → cancel (fake supplier), with the balance checked at each step.
7. Checks, security and differential review, PR.
