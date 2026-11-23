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


export function SetPasswordForm({ token, title, invitation = false }: { token: string; title: string; invitation?: boolean }) {
  const [state, formAction, pending] = useActionState<SetPasswordState, FormData>(
    setPasswordAction,
    null,
  );
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);

  if (state && "status" in state) return <ExpiredLink invitation={invitation} />;

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
          type={show ? "text" : "password"}
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
      <ul aria-label="Password rule" className="-mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {[
          { ok: password.length >= 8, text: "At least 8 characters" },
          { ok: /\p{L}/u.test(password) && /\p{Nd}/u.test(password), text: "Letters and numbers" },
        ].map((rule) => (
          <li key={rule.text} className={rule.ok ? "font-semibold text-brand" : "text-muted"}>
            {rule.ok ? "✓" : "○"} {rule.text}
          </li>
        ))}
      </ul>
      <label className="-mt-1 flex items-center gap-2 text-xs text-[#4d5a54]">
        <input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} className="h-4 w-4 accent-brand" />
        Show passwords
      </label>

      <label className={label}>
        Confirm password
        <input
          type={show ? "text" : "password"}
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
      <p className="text-center text-xs text-muted">Saving signs out every other device signed in to your account.</p>
    </form>
  );
}
