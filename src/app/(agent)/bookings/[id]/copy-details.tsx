"use client";

import { useState } from "react";
import { btnSecondary } from "@/components/ui";

// "Copy details" (mockup 12): a plain-text summary of the booking for the agent to paste to the
// client (no price). The text is made on the server; this only puts it on the clipboard.
export function CopyDetails({ text }: { text: string }) {
  const [done, setDone] = useState<"copied" | "failed" | null>(null);
  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        className={`${btnSecondary} self-start`}
        onClick={() => {
          navigator.clipboard.writeText(text).then(
            () => setDone("copied"),
            () => setDone("failed"),
          );
        }}
      >
        Copy details
      </button>
      {done ? (
        <p role="status" className="text-xs text-muted">
          {done === "copied" ? "Booking details copied, ready to paste to your client." : "Copying is not allowed in this browser. Open the voucher and copy from there."}
        </p>
      ) : null}
    </div>
  );
}
