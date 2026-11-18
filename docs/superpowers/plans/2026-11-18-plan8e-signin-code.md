# Plan 8e: Sign-in code on a new device (mockups 04, 23 #6)

Mockup 04: "signing in from a new device asks for a code sent to your email". Agents only (admins
already use TOTP).

## Decisions (Claude)
- After a correct password, an agent on a device Apolles does not know gets a session that is
  **not yet verified**, and a 6-digit code by email ("Your Apolles sign-in code"). `requireAgent`
  sends an unverified session to `/login/verify`, as `requireAdmin` does for TOTP.
- The code: random, stored only as a hash with the session, valid 10 minutes, 5 wrong tries end the
  session (back to sign in). "Resend code" at most 3 times per 10 minutes.
- After the right code: the session is verified and the browser gets a **device cookie**
  (`apl_device`, httpOnly, secure, SameSite=Lax, 90 days; only its hash is stored). The same agent on
  that browser is not asked again for 90 days.
- A password reset or set (and an agency suspension) forgets every device of the user.
- Sessions that exist when this ships count as verified (the migration sets it), so nobody is cut off.
- Nothing about the code is logged; the email has no link, only the code and "if this was not you,
  change your password".
