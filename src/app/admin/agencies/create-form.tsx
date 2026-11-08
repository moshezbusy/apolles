"use client";

import Link from "next/link";
import { useActionState } from "react";
import type { CreateAgencyState } from "./form-state";

type Action = (previous: CreateAgencyState, formData: FormData) => Promise<CreateAgencyState>;

const inputClass =
  "rounded-md border border-gray-300 px-3 py-2 text-base text-gray-900 focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600";

export function CreateAgencyForm({ action }: { action: Action }) {
  const [state, formAction, pending] = useActionState<CreateAgencyState, FormData>(action, null);

  if (state?.created) {
    return (
      <div className="flex flex-col gap-4">
        <p role="alert" className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {state.error}
        </p>
        <Link href="/admin/agencies" className="self-start text-sm text-blue-700 hover:underline">
          Back to agencies
        </Link>
      </div>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
      {state?.error ? (
        <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {state.error}
        </p>
      ) : null}

      <label className="flex flex-col gap-1 text-sm font-medium text-gray-700">
        Agency name
        <input type="text" name="name" required minLength={2} maxLength={100} className={inputClass} />
      </label>
      <label className="flex flex-col gap-1 text-sm font-medium text-gray-700">
        Country (2-letter code, e.g. IL)
        <input
          type="text"
          name="country"
          required
          minLength={2}
          maxLength={2}
          pattern="[A-Z]{2}"
          className={`${inputClass} uppercase`}
        />
      </label>
      <label className="flex flex-col gap-1 text-sm font-medium text-gray-700">
        Agent name
        <input type="text" name="agentName" required maxLength={100} className={inputClass} />
      </label>
      <label className="flex flex-col gap-1 text-sm font-medium text-gray-700">
        Agent email
        <input type="email" name="agentEmail" required maxLength={254} autoComplete="off" className={inputClass} />
      </label>

      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-blue-700 px-4 py-2 font-medium text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? "Creating…" : "Create agency"}
      </button>
    </form>
  );
}
