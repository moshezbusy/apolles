"use client";

import Link from "next/link";
import { useActionState } from "react";
import { alertError, alertInfo, btnPrimary, input, label, link } from "@/components/ui";
import type { CreateAgencyState } from "./form-state";

type Action = (previous: CreateAgencyState, formData: FormData) => Promise<CreateAgencyState>;


export function CreateAgencyForm({ action }: { action: Action }) {
  const [state, formAction, pending] = useActionState<CreateAgencyState, FormData>(action, null);

  if (state?.created) {
    return (
      <div className="flex flex-col gap-4">
        <p role="alert" className={alertInfo}>
          {state.error}
        </p>
        <Link href="/admin/agencies" className={`self-start ${link}`}>
          Back to agencies
        </Link>
      </div>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-3.5" noValidate>
      {state?.error ? (
        <p role="alert" className={alertError}>
          {state.error}
        </p>
      ) : null}

      <label className={label}>
        Agency name
        <input type="text" name="name" required minLength={2} maxLength={100} className={input} />
      </label>
      <label className={label}>
        Country (2-letter code, e.g. IL)
        <input
          type="text"
          name="country"
          required
          minLength={2}
          maxLength={2}
          pattern="[A-Z]{2}"
          className={`${input} uppercase`}
        />
      </label>
      <label className={label}>
        Agent name
        <input type="text" name="agentName" required maxLength={100} className={input} />
      </label>
      <label className={label}>
        Agent email
        <input type="email" name="agentEmail" required maxLength={254} autoComplete="off" className={input} />
      </label>

      <button
        type="submit"
        disabled={pending}
        className={`w-full ${btnPrimary}`}
      >
        {pending ? "Creating…" : "Create agency"}
      </button>
    </form>
  );
}
