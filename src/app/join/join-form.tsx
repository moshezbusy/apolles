"use client";

import Link from "next/link";
import { useActionState } from "react";
import { alertError, btnPrimary, input, label } from "@/components/ui";
import type { JoinState } from "./actions";

type Action = (previous: JoinState, formData: FormData) => Promise<JoinState>;

export function JoinForm({ action, countries }: { action: Action; countries: { code: string; name: string }[] }) {
  const [state, formAction, pending] = useActionState<JoinState, FormData>(action, null);
  const v = state?.values ?? {};
  return (
    <form key={JSON.stringify(v)} action={formAction} className="flex flex-col gap-4" noValidate>
      {state ? (
        <p role="alert" className={alertError}>
          {state.error}
        </p>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <label className={label}>
          Agency name
          <input name="agencyName" required maxLength={100} defaultValue={v.agencyName ?? ""} autoComplete="organization" className={input} />
        </label>
        <label className={label}>
          Contact name
          <input name="contactName" required maxLength={100} defaultValue={v.contactName ?? ""} autoComplete="name" className={input} />
        </label>
        <label className={label}>
          Business email
          <input type="email" name="email" required maxLength={254} defaultValue={v.email ?? ""} autoComplete="email" className={input} />
        </label>
        <label className={label}>
          Phone
          <input type="tel" name="phone" required maxLength={30} defaultValue={v.phone ?? ""} autoComplete="tel" placeholder="+972 50 123 4567" className={input} />
        </label>
        <label className={label}>
          Country
          <select name="country" required defaultValue={v.country ?? ""} className={input}>
            <option value="">Select country</option>
            {countries.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className={label}>
          Website or social media page
          <input name="website" required maxLength={200} defaultValue={v.website ?? ""} className={input} />
        </label>
        <label className={label}>
          <span>
            IATA / TIDS / travel license <span className="font-normal text-muted">optional</span>
          </span>
          <input name="license" maxLength={100} defaultValue={v.license ?? ""} className={input} />
        </label>
      </div>
      <label className={label}>
        <span>
          Notes <span className="font-normal text-muted">optional</span>
        </span>
        <textarea name="notes" rows={3} maxLength={1000} defaultValue={v.notes ?? ""} className={input} />
      </label>
      {/* Not for people: left empty by everyone but bots. */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label>
          Company
          <input name="company" tabIndex={-1} autoComplete="off" defaultValue="" />
        </label>
      </div>
      <label className="flex items-start gap-2 text-[13px] text-ink">
        <input type="checkbox" name="terms" required defaultChecked={v.terms === "on"} className="mt-0.5 h-4 w-4 accent-brand" />
        <span>
          I agree to the{" "}
          <Link href="/terms" className="font-semibold text-brand underline">
            Terms of Use and Privacy Policy
          </Link>
          .
        </span>
      </label>
      <button type="submit" disabled={pending} className={btnPrimary}>
        {pending ? "Sending…" : "Apply for Access"}
      </button>
      <p className="text-center text-xs text-muted">We review every application. You will not be able to sign in until your agency is approved.</p>
    </form>
  );
}
