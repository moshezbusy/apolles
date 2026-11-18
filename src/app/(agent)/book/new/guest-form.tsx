"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useActionState } from "react";
import { alertError, btnPrimary, input, label } from "@/components/ui";
import type { GuestPrefill } from "@/server/quotes/quote-booking";
import type { BookFormState } from "../form-state";

type Action = (previous: BookFormState, formData: FormData) => Promise<BookFormState>;

// Screen 10: a given and family name for every guest (lead guest first), and the lead guest's
// email and phone (TR4, TR5). The rate is passed on as ids only.
export function GuestForm({
  action,
  rate,
  guests,
  prefill,
}: {
  action: Action;
  rate: { s: string; p: string; r: string; b: string; stay?: string };
  guests: string[];
  prefill: GuestPrefill | null;
}) {
  const [state, formAction, pending] = useActionState<BookFormState, FormData>(action, null);
  // What the agent typed wins (after an error); else the chosen client and companions.
  const v = state?.values ?? fromPrefill(prefill);
  return (
    <form key={JSON.stringify(v)} action={formAction} noValidate className="flex flex-col gap-5">
      {state ? (
        <p role="alert" className={alertError}>
          {state.message}
        </p>
      ) : null}
      {Object.entries(rate).map(([key, value]) => (
        <input key={key} type="hidden" name={key} value={value} />
      ))}
      {guests.map((title, i) => (
        <fieldset key={i} className="grid gap-3 sm:grid-cols-2">
          <legend className="mb-2 text-sm font-bold text-ink">
            {title}
            {i === 0 ? <span className="ml-2 text-xs font-normal text-muted">Lead guest: the booking is in this name</span> : null}
          </legend>
          <label className={label}>
            Given name
            <input type="text" name={`given_${i}`} required maxLength={60} autoComplete="off" defaultValue={v[`given_${i}`] ?? ""} className={input} />
          </label>
          <label className={label}>
            Family name
            <input type="text" name={`family_${i}`} required maxLength={60} autoComplete="off" defaultValue={v[`family_${i}`] ?? ""} className={input} />
          </label>
        </fieldset>
      ))}
      <fieldset className="grid gap-3 sm:grid-cols-[1fr_110px_1fr]">
        <legend className="mb-2 text-sm font-bold text-ink">Lead guest contact</legend>
        <label className={label}>
          Email
          <input type="email" name="leadEmail" required maxLength={254} autoComplete="off" defaultValue={v.leadEmail ?? ""} className={input} />
        </label>
        <label className={label}>
          Country code
          <input type="text" inputMode="numeric" name="phoneCountry" required maxLength={4} placeholder="972" defaultValue={v.phoneCountry ?? ""} className={input} />
        </label>
        <label className={label}>
          Phone number
          <input type="tel" name="phoneNumber" required maxLength={20} placeholder="50 123 4567" defaultValue={v.phoneNumber ?? ""} className={input} />
        </label>
      </fieldset>
      {prefill ? (
        <input type="hidden" name="clientId" value={prefill.clientId} />
      ) : (
        <label className="flex items-center gap-2 text-sm text-ink">
          <input type="checkbox" name="saveClient" defaultChecked={v.saveClient === "on"} className="h-4 w-4 accent-brand" />
          Save the lead guest to Clients, so you can select them next time.
        </label>
      )}
      <p className="text-xs text-muted">The hotel receives the lead guest&apos;s name, email and phone. Use the guest&apos;s own details.</p>
      <button type="submit" disabled={pending} className={`${btnPrimary} self-start`}>
        {pending ? "Saving…" : "Continue to review"}
      </button>
    </form>
  );
}

function fromPrefill(prefill: GuestPrefill | null): Record<string, string> {
  if (!prefill) return {};
  const values: Record<string, string> = { leadEmail: prefill.leadEmail, phoneCountry: prefill.phoneCountry, phoneNumber: prefill.phoneNumber };
  prefill.guests.forEach((g, i) => {
    values[`given_${i}`] = g.givenName;
    values[`family_${i}`] = g.familyName;
  });
  return values;
}

// "Choose from clients": fills the guests from one of the agency's clients (read on the server).
export function ClientChooser({ clients, selected }: { clients: { id: string; firstName: string; lastName: string }[]; selected: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  return (
    <label className={`${label} mb-5 max-w-sm`}>
      Choose from clients
      <select
        value={selected}
        onChange={(e) => {
          const next = new URLSearchParams(params.toString());
          next.set("client", e.target.value || "none");
          router.replace(`${pathname}?${next.toString()}`, { scroll: false });
        }}
        className={input}
      >
        <option value="">New guest</option>
        {clients.map((c) => (
          <option key={c.id} value={c.id}>
            {c.firstName} {c.lastName}
          </option>
        ))}
      </select>
    </label>
  );
}
