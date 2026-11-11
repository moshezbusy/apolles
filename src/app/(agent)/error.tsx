"use client";

import Link from "next/link";
import { StatePanel } from "@/components/StatePanel";
import { btnPrimary, btnSecondary } from "@/components/ui";

// Something failed in the agent area (screen 24). The error's own message is never shown (it
// may hold internal details); the digest is a short code support can find in the server log.
// During a booking the agent is sent to "My bookings" first, so nobody books twice.
export default function AgentError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <StatePanel
      icon="!"
      tone="warn"
      title="Something went wrong on our side"
      actions={
        <>
          <button type="button" onClick={reset} className={btnPrimary}>
            Try again
          </button>
          <Link href="/bookings" className={btnSecondary}>
            My bookings
          </Link>
        </>
      }
      footnote={error.digest ? `Error code: ${error.digest.slice(0, 12)} · give this code to support` : undefined}
    >
      Please try again in a minute. If you were booking, check My bookings before trying again, so you don&apos;t book twice.
    </StatePanel>
  );
}
