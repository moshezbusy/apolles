"use client";

import { useActionState, useState } from "react";
import {
  PASSWORDS_DIFFER_COPY,
  PASSWORD_MAX_LENGTH,
  PASSWORD_RULE_COPY,
  isValidPassword,
} from "@/lib/password-rule";
import { alertError, btnPrimary, hint, input, label } from "@/components/ui";
import { setPasswordAction, type SetPasswordState } from "./actions";
import { ExpiredLink } from "./expired-link";


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
    <form action={formAction} className="flex flex-col gap-3.5" noValidate>
      <h1 className="text-center font-serif text-[30px] font-medium leading-tight tracking-[-0.02em] text-ink">{title}</h1>

      {state && "error" in state ? (
        <p role="alert" className={alertError}>
          {state.error}
        </p>
      ) : null}

      <input type="hidden" name="token" value={token} />

      <label className={label}>
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
          className={input}
        />
      </label>
      <p id="password-rule" className={`-mt-2 ${hint}`}>
        {PASSWORD_RULE_COPY}
      </p>

      <label className={label}>
        Confirm password
        <input
          type="password"
          name="confirm"
          autoComplete="new-password"
          required
          maxLength={PASSWORD_MAX_LENGTH}
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          className={input}
        />
      </label>
      {showMismatch ? <p className="-mt-2 text-xs text-[#8a3f32]">{PASSWORDS_DIFFER_COPY}</p> : null}

      <button
        type="submit"
        disabled={!ready || pending}
        className={`w-full ${btnPrimary}`}
      >
        {pending ? "Saving…" : "Save password"}
      </button>
    </form>
  );
}
