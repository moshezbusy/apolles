"use client";

import { useActionState, useState } from "react";
import { alertError, alertSuccess, btnSecondary, hint } from "@/components/ui";
import type { SettingsFormState } from "./form-state";

type Action = (previous: SettingsFormState, formData: FormData) => Promise<SettingsFormState>;

export function LogoForm({ action, rule, maxBytes }: { action: Action; rule: string; maxBytes: number }) {
  const [state, formAction, pending] = useActionState<SettingsFormState, FormData>(action, null);
  const [tooLarge, setTooLarge] = useState(false);

  // Checked in the browser before sending: the server refuses bodies over 1 MB with a hard
  // error, and phone photos are often bigger. The server checks again on its side.
  function checkSize(event: React.FormEvent<HTMLFormElement>) {
    const file = new FormData(event.currentTarget).get("logo");
    const big = file instanceof Blob && file.size > maxBytes;
    setTooLarge(big);
    if (big) event.preventDefault();
  }

  return (
    <form action={formAction} onSubmit={checkSize} className="flex flex-col gap-3">
      {tooLarge ? (
        <p role="alert" className={alertError}>
          The file is too large. {rule}
        </p>
      ) : state ? (
        <p role={state.status === "error" ? "alert" : "status"} className={state.status === "error" ? alertError : alertSuccess}>
          {state.message}
        </p>
      ) : null}
      <label className="flex flex-col gap-1.5 text-xs font-semibold text-[#37413d]">
        Upload a logo
        <input
          type="file"
          name="logo"
          accept="image/png,image/jpeg"
          required
          aria-describedby="logo-rule"
          className="text-sm text-ink file:mr-3 file:rounded-lg file:border file:border-[#d9e1dc] file:bg-white file:px-3 file:py-2 file:text-sm file:font-bold file:text-brand hover:file:bg-brand-soft"
        />
      </label>
      <p id="logo-rule" className={hint}>
        {rule}
      </p>
      <button type="submit" disabled={pending} className={`self-start ${btnSecondary}`}>
        {pending ? "Uploading…" : "Upload logo"}
      </button>
    </form>
  );
}
