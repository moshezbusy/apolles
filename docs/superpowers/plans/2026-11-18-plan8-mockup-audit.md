# Plan 8: Built screens against the mockups (04–13, 21–24)

An independent audit (18.11.2026) compared every built screen with its mockup in
`docs/design/mockups/pages/`. This is the list of gaps, split into batches. Each batch is one PR:
plan, tests first, review, CI. Tags: MONEY, SEC, EXP (Expedia display rules).

Left out on purpose (not gaps): card payments and card top-ups (owner 17.11: no card details),
pay later / "no voucher" (not phase 1), several rooms per booking (phase 2), ILS (USD only), map
view (phase 1 has none), price per night (BP5: never divided), guest nationality (Rapid takes none,
TR2). The approved spec could not be read by the audit agent (guardrail): confirm with the owner.

## 8a — quick and visible (one PR)
- Login (04): "Don't have an account? Apply for access" and "Join Apolles" links; footer Support /
  Terms / Privacy (AuthShell, also 05, 06).
- Forgot password (05): the "Check your email" page: link expires in 60 minutes, check spam, resend.
- Set password (06): Show buttons, a live checklist, "Other devices were signed out" after saving.
- Header: Quotes → New quote; Bookings menu (All, Upcoming stays, Completed, Cancelled); Support.
- 404 (24): "Your bookings and quotes are safe"; a root `error.tsx` with no technical details (SEC);
  a removed client link answers 404, with the agency's name when known.
- Voucher (21): the file name without "Apolles" (client document); "Room paid in advance. Do not
  charge the guest for it." (MONEY); status line "Confirmed · Paid", issued date, meal plan if known.
- Review (11): button "Book and pay USD X from balance"; "After this booking" balance; the free
  cancellation line next to the button (MONEY, EXP).
- Booking summary (12): "Payment · Paid from balance · Deducted on …" (MONEY).
- Bookings (13): In stay and Completed tabs; booked-date filter; "N bookings"; rows with booked date,
  nights, "Check-in in N days", "Free cancel until …" (EXP).

## 8b — guest details and booking pages (one PR)
- Guest details (10): progress steps; Title (Mr/Mrs/Ms); Special requests (sent to the supplier
  only if Rapid takes them; else a note for the agent's records — check the Rapid docs first);
  the cancellation table with the hotel's time zone (EXP); hotel policies; check-in/out times.
- Review (11): a price change asks "Continue at USD X" / "Back to room options" (MONEY); links to
  change room / edit guests; check-in/out times.
- Booking summary (12): the cancel dialog (Paid / Charge now / Returned to your balance, "final",
  Keep booking) (MONEY); hotel policies (EXP); cancellation table; "Booked by …"; Copy details.

## 8c — invoice and credit note (22) and booking emails (23) (one PR, MONEY)
- Invoice INV-… per booking and credit note CN-… after a cancellation (PDF), billed to the agency,
  "Paid from your Apolles balance", fees not included; links on 12 and in the emails.
- Emails: booking confirmed with guests, free-cancellation deadline, new balance; cancelled with
  the new balance; top-up received; low balance; "free cancellation ends soon" (EXP); "not approved".
- Email to client (from 12), in the agency's name, without the net price.

## 8d — search and results (one PR)
- Search (07): recent searches; "Needs attention" (client selected an option → Open quote).
- Results (08): "Add to quote" on cards; the best room line; "View N more room options"; area.
  (Not yet: the cards hold only the lowest price, not the rate behind it; the search query must
  keep the best rate's ids first. Room filters on the hotel page (09) are done, plan 8d-2.)
- Hotel (09): room filters (name, free cancellation, sort); photo gallery; registration number.
- Meal plan (08, 09, 10–13, 21): needs the rate's amenities from Rapid in the adapter (EXP: shown
  as the supplier gives it). Adapter change: own small plan.

## 8e — sign-in code on a new device (04, 23 #6) (SEC, own plan)
- Email a 6-digit code when an agent signs in from a new device (10 minutes, resend, rate limits).

## Owner questions
- Guest nationality: the mockups show it; Rapid does not take it (TR2). Keep it out?
- Account-ready email (#3): the mockup has a 7-day link; ours is 60 minutes (safer). Keep 60?
