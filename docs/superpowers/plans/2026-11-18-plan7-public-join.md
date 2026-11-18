# Plan 7: Homepage, Join, Application received, and admin review (screens 01, 02, 03)

Owner decision 2026-11-17 (`docs/decisions/2026-11-17-build-all-mockup-screens.md`). Mockups:
`01-homepage.html`, `02-join.html`, `03-application-received.html`.

## Decisions (Claude)

- **Homepage** (`/`, public): the mockup's sections (hero, features, how it works, client quotes,
  FAQ, call to action). No real hotels or prices (search is for signed-in agents only); the product
  pictures are drawn with sample names. No supplier brand (GR1). Before: `/` redirected to /login.
- **Join** (`/join`, public): agency name, contact name, business email, phone, country, website or
  social page, IATA / TIDS / license (optional), notes (optional), terms box.
  - Zod strict; plain text without control characters; email checked and stored lowercase.
  - Limits: 5 applications per IP per hour and 3 per email per day (hashed key); a hidden
    honeypot field. Over a limit: a calm "Try again later".
  - An email that already has a user, or a pending application: "An application with this email
    already exists. Sign in or contact support." (as in the mockup).
  - Saved as `AgencyApplication` (status Pending). An email to the applicant ("Application
    received") and one to the admin alert address (no applicant details in it, only "a new
    application is waiting" and the link). Failures are logged by name only.
  - Then `/join/received` (screen 03). The email address is not put in the URL.
- **Admin review** (`/admin/applications`, admin only): the list (Pending first, paginated) and one
  application with Approve / Reject.
  - Approve = the existing `createAgency` (agency, agent user, set-password email), then the
    application's phone and email go on the agency profile; the application becomes Approved
    with the agency id. One click only: the row is locked and must still be Pending.
  - Reject = Rejected (no email: the admin writes to the applicant if needed).
  - Both audited (no applicant details in the audit row).
- **Not stored**: card details, documents. The license field is plain text.
