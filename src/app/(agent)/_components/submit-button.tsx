"use client";

import type { ReactNode } from "react";
import { useFormStatus } from "react-dom";

// A submit button for a plain form with a server action (no client state of its own): while the
// action runs it is disabled and says what is happening, so a second click cannot send it twice.
export function SubmitButton({ className, pendingText, children }: { className: string; pendingText: string; children: ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} aria-busy={pending} className={className}>
      {pending ? pendingText : children}
    </button>
  );
}
