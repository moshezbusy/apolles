"use client";

import { useActionState, useState } from "react";
import { alertError, btnPrimary, input, label } from "@/components/ui";
import { DestinationPicker } from "./destination-picker";
import type { SearchFormState, SearchFormValues } from "./form-state";

// Search box (screens 07, 08, 09): destination, dates, one room, adults, and each child's age
// (SP1). The dates are the browser's own date picker: accessible, and it knows the agent's
// calendar. Everything is checked again on the server.

type Action = (previous: SearchFormState, formData: FormData) => Promise<SearchFormState>;

const DAY_MS = 86_400_000;
const ADULTS = [1, 2, 3, 4, 5, 6, 7, 8];
const CHILDREN = [0, 1, 2, 3, 4, 5, 6];
const AGES = Array.from({ length: 18 }, (_, i) => i);

function nights(checkin: string, checkout: string): number | null {
  const n = (Date.parse(`${checkout}T00:00:00Z`) - Date.parse(`${checkin}T00:00:00Z`)) / DAY_MS;
  return Number.isInteger(n) && n > 0 ? n : null;
}

export function SearchForm({
  action,
  values,
  minDate,
  maxDate,
  compact = false,
}: {
  action: Action;
  values: SearchFormValues;
  minDate: string;
  maxDate: string;
  compact?: boolean;
}) {
  const [state, formAction, pending] = useActionState<SearchFormState, FormData>(action, null);
  const shown = state?.values ?? values;
  return (
    <form key={JSON.stringify(shown)} action={formAction} noValidate className="flex flex-col gap-3">
      {state ? (
        <p role="alert" className={alertError}>
          {state.message}
        </p>
      ) : null}
      <Fields shown={shown} minDate={minDate} maxDate={maxDate} pending={pending} compact={compact} />
    </form>
  );
}

function Fields({ shown, minDate, maxDate, pending, compact }: { shown: SearchFormValues; minDate: string; maxDate: string; pending: boolean; compact: boolean }) {
  const [checkin, setCheckin] = useState(shown.checkin);
  const [checkout, setCheckout] = useState(shown.checkout);
  const [adults, setAdults] = useState(Number(shown.adults) || 2);
  const [ages, setAges] = useState<string[]>(shown.childAges);
  const stay = nights(checkin, checkout);
  const guests = adults + ages.length;

  return (
    <div className={`grid items-end gap-3 ${compact ? "lg:grid-cols-[1.6fr_1fr_1fr_1fr_auto]" : "md:grid-cols-2 lg:grid-cols-[1.6fr_1fr_1fr_1fr_auto]"}`}>
      <div className={label}>
        <span>Destination</span>
        <DestinationPicker defaultId={shown.destinationId} defaultLabel={shown.destinationLabel} />
      </div>
      <label className={label}>
        Check-in
        <input type="date" name="checkin" required min={minDate} max={maxDate} value={checkin} onChange={(e) => setCheckin(e.target.value)} className={input} />
      </label>
      <label className={label}>
        <span>
          Check-out {stay ? <span className="font-normal text-muted">· {stay} {stay === 1 ? "night" : "nights"}</span> : null}
        </span>
        <input type="date" name="checkout" required min={checkin || minDate} max={maxDate} value={checkout} onChange={(e) => setCheckout(e.target.value)} className={input} />
      </label>
      <details className="relative">
        <summary className={`${input} flex cursor-pointer list-none items-center justify-between`} aria-label="Rooms and guests">
          <span>
            1 room · {guests} {guests === 1 ? "guest" : "guests"}
          </span>
          <span aria-hidden="true" className="text-[11px] text-[#8a938e]">
            ▾
          </span>
        </summary>
        <div className="absolute right-0 z-40 mt-1.5 flex w-[280px] flex-col gap-3 rounded-[11px] border border-[#e1e6e3] bg-white p-3.5 shadow-[0_15px_38px_rgba(19,47,39,0.14)]">
          <label className={label}>
            Adults
            <select name="adults" value={adults} onChange={(e) => setAdults(Number(e.target.value))} className={input}>
              {ADULTS.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <label className={label}>
            Children
            <select
              name="childCount"
              value={ages.length}
              onChange={(e) => {
                const count = Number(e.target.value);
                setAges((current) => (count > current.length ? [...current, ...Array<string>(count - current.length).fill("")] : current.slice(0, count)));
              }}
              className={input}
            >
              {CHILDREN.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          {ages.map((age, index) => (
            <label key={index} className={label}>
              Age of child {index + 1}
              <select
                name="childAge"
                required
                value={age}
                onChange={(e) => setAges((current) => current.map((a, i) => (i === index ? e.target.value : a)))}
                className={input}
              >
                <option value="">Choose age</option>
                {AGES.map((n) => (
                  <option key={n} value={n}>
                    {n === 0 ? "Under 1" : n}
                  </option>
                ))}
              </select>
            </label>
          ))}
          <p className="text-xs text-muted">One room per booking.</p>
        </div>
      </details>
      <button type="submit" disabled={pending} className={btnPrimary}>
        {pending ? "Searching…" : "Search"}
      </button>
    </div>
  );
}
