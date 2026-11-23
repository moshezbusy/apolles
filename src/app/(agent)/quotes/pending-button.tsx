"use client";

import { createContext, useContext } from "react";
import { useFormStatus } from "react-dom";

// The pending state of a quote form's submit button: while the form's action runs, the button
// says what is happening ("Saving…") and cannot be clicked again. It reads the form's own status,
// and ActionForm's (a form ActionForm sends by hand, so the typed values stay).
const Pending = createContext(false);

export function FormPending({ value, children }: { value: boolean; children: React.ReactNode }) {
  return <Pending.Provider value={value}>{children}</Pending.Provider>;
}

export function PendingButton({
  children,
  pendingText,
  className,
  title,
  disabled,
  name,
  value,
}: {
  children: React.ReactNode;
  pendingText: string;
  className: string;
  title?: string;
  disabled?: boolean;
  name?: string;
  value?: string;
}) {
  const status = useFormStatus();
  const sentByHand = useContext(Pending);
  const pending = status.pending || sentByHand;
  return (
    <button type="submit" className={className} title={title} aria-label={title} disabled={disabled || pending} aria-busy={pending} name={name} value={value}>
      {pending ? pendingText : children}
    </button>
  );
}
