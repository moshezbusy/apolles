"use client";

import { useActionState } from "react";
import { alertError, alertSuccess, btnPrimary } from "@/components/ui";
import type { DemoAccessState } from "./actions";

export function DemoAccessForm({ action }: { action: () => Promise<DemoAccessState> }) {
  const [state, formAction, pending] = useActionState<DemoAccessState, FormData>(async () => action(), null);
  return (
    <form action={formAction} className="flex flex-col gap-4">
      <button type="submit" disabled={pending} className={`${btnPrimary} self-start`}>
        {pending ? "Creating…" : "Create demo login"}
      </button>
      {state?.status === "ok" ? (
        <div role="status" className={`${alertSuccess} text-sm`}>
          <p>
            Sign in at <strong>/login</strong> with:
          </p>
          <p className="mt-2">
            Email: <strong className="font-mono">{state.email}</strong>
          </p>
          <p>
            Password: <strong className="font-mono">{state.password}</strong>
          </p>
          <p className="mt-2 text-xs">Shown once. Clicking again makes a new password and signs the demo agent out everywhere.</p>
        </div>
      ) : null}
      {state?.status === "error" ? (
        <p role="alert" className={alertError}>
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
