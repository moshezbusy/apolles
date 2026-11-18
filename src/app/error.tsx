"use client";

import { StatePanel } from "@/components/StatePanel";
import { btnPrimary } from "@/components/ui";

// Something failed outside the agent area (screen 24): the public pages, the client quote link,
// sign-in. The error's own message is never shown (it may hold internal details), and nothing
// links into the agent area (a client must not see it); the digest is a code for support.
export default function RootError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <StatePanel
      icon="!"
      tone="warn"
      title="Something went wrong"
      actions={
        <button type="button" onClick={reset} className={btnPrimary}>
          Try again
        </button>
      }
      footnote={error.digest ? `Error code: ${error.digest.slice(0, 12)}` : undefined}
    >
      Please try again in a minute.
    </StatePanel>
  );
}
