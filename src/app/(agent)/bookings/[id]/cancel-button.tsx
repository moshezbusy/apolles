"use client";

import { useFormStatus } from "react-dom";
import { btnDanger } from "@/components/ui";

// The submit button of the cancel form (screen 12): disabled while the cancellation is being
// sent, so a second click sends nothing.
export function CancelButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={btnDanger}>
      {pending ? "Cancelling…" : "Cancel this booking"}
    </button>
  );
}
