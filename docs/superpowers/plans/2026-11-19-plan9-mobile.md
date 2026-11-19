# Plan 9: every screen usable on a phone (agent and admin)

Owner, 19.11.2026, in chat: "fix it so every action is comfortable on mobile, for the agent and
the admin; go with what makes sense, no questions". UI only: no data, money or permission change.

## What is broken (390px screenshots of every page, local demo data)
- Agent header: below 1024px the menu is hidden, so a phone reaches only Search, the balance and
  the agency menu (no Quotes, Bookings, Clients, Reporting).
- Admin header: the tabs and Sign out do not fit; the page is 493px wide and slides sideways.
- Tables (bookings, clients, balance, reporting, admin lists, ledger, history, supplier log):
  columns squeeze to one word per line and the last ones (status, amount) hide behind a scroll.
- Hotel page (09): the rooms table is 820px wide; the price and "Book room" are off screen.
- Results (08): the filter form fills the first screen; the hotels start below it.
- Inputs are 14px: iPhone Safari zooms the page in on every field.

## Decisions (Claude)
- Phones get a "Menu" button in the header (agent below `lg`, admin below `md`) that opens a
  full-width panel with every link of the desktop menus, the agency's settings and Sign out. A
  `<details>` (works without JavaScript) inside a small client component that closes the panel
  when a link or button in it is used, or on Escape. The desktop header does not change.
- Tables become cards below `md` with CSS only: each row a card, each cell a block with its column
  name above the value (`data-label` on every `<td>`, shown with `::before`). The first cell is the
  card's title (no label). Desktop tables do not change. The rooms table on the hotel page too.
- Results filters: below `lg` a "Filters" button shows or hides the form (closed at first).
- Inputs and selects: 16px below `sm`, 14px from `sm` up (no iOS zoom).
- Not done: a native app, swipe gestures, a bottom tab bar.

Owner, same day, on the search form: dates as day/month/year; a tap anywhere on a date field
opens the calendar; the calendar in the system's look and colours; children picked straight by
age ("Add a child" → "7 years"), no "number of children" box; a tap anywhere outside closes an
open menu. More than one room: owner asked too; it changes search, booking, money and
cancellation (Expedia: one booking per room, TR6), so it is plan 10, not this one.

- Our own calendar (no new package): `src/components/date-picker/` with pure date helpers
  (`calendar.ts`), `DateField` (one date) and `DateRangeField` (check-in and check-out in one
  calendar: first tap check-in, second tap check-out, the nights between shaded, at most 28
  nights, today to 365 days, as the server checks). Shown as DD/MM/YYYY; the form still sends
  ISO `YYYY-MM-DD` in hidden inputs, so the server does not change. Weeks start on Sunday. Two
  months side by side from `md`, one on a phone. Arrow keys move, Enter picks, Escape closes.
  Used on every date field: search, quote "Add destination", the client cancel-by date on a quote,
  reporting From/To and the admin "Received on".
- Children: Adults select; "Children" select whose first option is "Add a child" and the others
  "Under 1", "1 year" … "17 years"; picking one adds a chip "Child 1 · 7 years ×" and the select
  goes back to "Add a child"; hidden at 6 children (the server's limit). The form still sends
  `childCount` and one `childAge` per child.
- Menus: `<details data-menu>` everywhere a menu opens (header menus, guests, Menu). One client
  component in the root layout closes an open menu on a tap outside it and on Escape, and a
  `data-menu="nav"` menu also when a link or button in it is used.

## Tasks (tests first)
1. `ui.ts`: responsive table classes (`table`, `thead`, `tbody`, new `tr`, `cell`, `td`) and 16px
   inputs. Test (`src/components/ui.test.ts`): the classes carry the phone rules; a source scan of
   `src/app` finds no `<td` without `data-label` and no `<table` whose rows lack `tr`/`roomRow`.
2. Every table: `data-label` on each `<td>` (the column's header text), `className={tr}` on body
   rows. Hotel rooms table: same, `md:min-w-[820px]` instead of `min-w-[820px]`.
3. `src/components/MobileMenu.tsx` (client): `MobileMenu({ className, children })`. Agent header:
   Menu with Search; Quotes (All quotes, New quote, Clients); Bookings (All, Upcoming stays,
   Completed, Cancelled); Reporting (Overview, Balance history); Agency settings, Balance & top-ups,
   Sign out; the agency menu is hidden below `lg`. Admin header: Menu with the four tabs and Sign
   out; inline tabs and Sign out hidden below `md`. Tests in `agent-pages.test.tsx` and
   `admin-pages.test.tsx`: the panel holds every link, the New quote and Sign out forms, and the
   current admin tab is marked.
4. `src/app/(agent)/search/[id]/filters-panel.tsx` (client): `FiltersPanel({ children })`. Test:
   renders a "Filters" button with `aria-expanded="false"` and the form wrapper `hidden lg:block`.
5. `src/components/MenuCloser.tsx` (client, root layout) with the pure rule
   `menusToClose(open: MenuLike[], target: NodeLike, kind: "pointer" | "click")` tested in
   `src/components/menu-closer.test.ts`: outside → closed; inside a plain menu → stays; a link or
   button inside a `nav` menu → closed on click.
6. Calendar: `calendar.ts` tests (`formatDmy("2026-12-03")` is `"03/12/2026"`; `monthGrid` of
   December 2026 starts on Tuesday 1 in a Sunday-first week, 6 rows; `dayState` disables days
   before min, after max and, for check-out, more than 28 nights after check-in). `DateField` and
   `DateRangeField` render the hidden ISO inputs and the DD/MM/YYYY text (static render tests),
   then replace every `type="date"` input listed above.
7. Children by age in `search-form.tsx`; `search-pages.test.tsx` checks "Add a child", the age
   options and the hidden `childCount`.
8. Check: the same screenshots again at 390px; no page wider than the screen; booking, cancelling,
   a quote and an admin top-up done on a phone-sized screen.

## Review focus
- A table cell with no `data-label` shows a value with no name on a phone (task 1's scan).
- The Menu panel stays open after a tap on a link (client navigation keeps the layout mounted).
- The panel taller than the screen must scroll inside itself (`max-h` + `overflow-y-auto`).
- The admin 2FA pages keep only Sign out: the Menu is in `AdminHeader`, which they do not use.
- Desktop (≥ 1024px) looks exactly as before.
