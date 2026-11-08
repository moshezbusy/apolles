"use client";

import { useActionState, useState } from "react";
import {
  PASSWORDS_DIFFER_COPY,
  PASSWORD_MAX_LENGTH,
  PASSWORD_RULE_COPY,
  isValidPassword,
} from "@/lib/password-rule";
import { setPasswordAction, type SetPasswordState } from "./actions";
import { ExpiredLink } from "./expired-link";

const inputClass =
  "rounded-md border border-gray-300 px-3 py-2 text-base text-gray-900 focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600";

export function SetPasswordForm({ token, title }: { token: string; title: string }) {
  const [state, formAction, pending] = useActionState<SetPasswordState, FormData>(
    setPasswordAction,
    null,
  );
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");

  if (state && "status" in state) return <ExpiredLink />;

  // Same rule as the server, which checks again on submit.
  const ready = isValidPassword(password) && password === confirm;
  const showMismatch = confirm.length > 0 && password !== confirm;

  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
      <h1 className="text-2xl font-semibold text-gray-900">{title}</h1>

      {state && "error" in state ? (
        <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {state.error}
        </p>
      ) : null}

      <input type="hidden" name="token" value={token} />

      <label className="flex flex-col gap-1 text-sm font-medium text-gray-700">
        New password
        <input
          type="password"
          name="password"
          autoComplete="new-password"
          required
          maxLength={PASSWORD_MAX_LENGTH}
          aria-describedby="password-rule"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className={inputClass}
        />
      </label>
      <p id="password-rule" className="-mt-2 text-xs text-gray-500">
        {PASSWORD_RULE_COPY}
      </p>

      <label className="flex flex-col gap-1 text-sm font-medium text-gray-700">
        Confirm password
        <input
          type="password"
          name="confirm"
          autoComplete="new-password"
          required
          maxLength={PASSWORD_MAX_LENGTH}
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          className={inputClass}
        />
      </label>
      {showMismatch ? <p className="-mt-2 text-xs text-red-700">{PASSWORDS_DIFFER_COPY}</p> : null}

      <button
        type="submit"
        disabled={!ready || pending}
        className="rounded-md bg-blue-700 px-4 py-2 font-medium text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? "Saving…" : "Save password"}
      </button>
    </form>
  );
}
