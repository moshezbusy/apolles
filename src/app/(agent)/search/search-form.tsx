"use client";

import { useActionState, useId, useState } from "react";
import { alertError, btnPrimary, input, label } from "@/components/ui";
import { DateRangeField } from "@/components/date-picker/DateRangeField";
import { DestinationPicker } from "./destination-picker";
import type { SearchFormState, SearchFormValues } from "./form-state";

// Search box (screens 07, 08, 09): destination, dates, one room, adults, and each child's age
// (SP1). The dates are our own calendar (plan 9: DD/MM/YYYY, the system's look); they are sent
// as ISO dates. Everything is checked again on the server.

type Action = (previous: SearchFormState, formData: FormData) => Promise<SearchFormState>;

const ADULTS = [1, 2, 3, 4, 5, 6, 7, 8];
const MAX_CHILDREN = 6;
const AGES = Array.from({ length: 18 }, (_, i) => i);

export function SearchForm({
  action,
  values,
  minDate,
  maxDate,
  compact = false,
  quoteId = null,
}: {
  action: Action;
  values: SearchFormValues;
  minDate: string;
  maxDate: string;
  compact?: boolean;
  quoteId?: string | null;
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
      {quoteId ? <input type="hidden" name="quote" value={quoteId} /> : null}
      <Fields shown={shown} minDate={minDate} maxDate={maxDate} pending={pending} compact={compact} />
    </form>
  );
}

export function ageText(age: string): string {
  return Number(age) === 1 ? "1 year" : `${Number(age)} years`;
}

function Fields({ shown, minDate, maxDate, pending, compact }: { shown: SearchFormValues; minDate: string; maxDate: string; pending: boolean; compact: boolean }) {
  const [adults, setAdults] = useState(Number(shown.adults) || 2);
  // Children are added straight by age (owner, 19.11): no "number of children" box, so no
  // child can be left without an age. Ages the server refused come back as "" and are dropped.
  const [ages, setAges] = useState<string[]>(shown.childAges.filter((a) => /^\d{1,2}$/.test(a)));
  const guests = adults + ages.length;

  return (
    <div className={`grid items-end gap-3 ${compact ? "lg:grid-cols-[1.6fr_1fr_1fr_1fr_auto]" : "md:grid-cols-2 lg:grid-cols-[1.6fr_1fr_1fr_1fr_auto]"}`}>
      <div className={label}>
        <span>Destination</span>
        <DestinationPicker defaultId={shown.destinationId} defaultLabel={shown.destinationLabel} />
      </div>
      <DateRangeField checkin={shown.checkin} checkout={shown.checkout} min={minDate} max={maxDate} />
      <details data-menu="plain" className="relative">
        <summary className={`${input} flex cursor-pointer list-none items-center justify-between`} aria-label="Rooms and guests">
          <span>
            1 room · {guests} {guests === 1 ? "guest" : "guests"}
          </span>
          <span aria-hidden="true" className="text-[11px] text-[#8a938e]">
            ▾
          </span>
        </summary>
        <div className="absolute right-0 z-40 mt-1.5 flex w-[min(300px,calc(100vw-40px))] flex-col gap-3 rounded-[11px] border border-[#e1e6e3] bg-white p-3.5 shadow-[0_15px_38px_rgba(19,47,39,0.14)]">
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
          <div className={label}>
            <span>Children</span>
            <input type="hidden" name="childCount" value={ages.length} />
            {ages.map((age, index) => (
              <div key={index} className="flex min-h-10 items-center justify-between rounded-lg border border-[#d9e1dc] bg-brand-soft px-3 text-sm font-semibold text-brand">
                <input type="hidden" name="childAge" value={age} />
                <span>
                  Child {index + 1} · {ageText(age)}
                </span>
                <button
                  type="button"
                  aria-label={`Remove child ${index + 1}`}
                  onClick={() => setAges((current) => current.filter((_, i) => i !== index))}
                  className="grid h-8 w-8 place-items-center rounded-full text-base text-brand hover:bg-white"
                >
                  ×
                </button>
              </div>
            ))}
            {ages.length < MAX_CHILDREN ? (
              <AddChild onAdd={(age) => setAges((current) => [...current, age].slice(0, MAX_CHILDREN))} />
            ) : (
              <p className="text-xs font-normal text-muted">Up to {MAX_CHILDREN} children.</p>
            )}
          </div>
          <p className="text-xs text-muted">One room per booking.</p>
        </div>
      </details>
      <button type="submit" disabled={pending} className={btnPrimary}>
        {pending ? "Searching…" : "Search"}
      </button>
    </div>
  );
}

// "Add a child" (owner's picture, 19.11): a button that opens the list of ages; a tap on an age
// adds the child and closes the list. Buttons, not a <select>: arrow keys on a closed select
// change its value in some browsers, which would add children nobody asked for.
function AddChild({ onAdd }: { onAdd: (age: string) => void }) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  return (
    <div>
      <button type="button" aria-expanded={open} aria-controls={listId} onClick={() => setOpen((o) => !o)} className={`${input} flex items-center justify-between text-left`}>
        Add a child
        <span aria-hidden="true" className="text-[11px] text-[#8a938e]">
          {open ? "▴" : "▾"}
        </span>
      </button>
      {open ? (
        <div id={listId} role="group" aria-label="Age of the child" className="mt-1.5 max-h-56 overflow-y-auto rounded-[11px] border border-[#e1e6e3] bg-white p-1.5 shadow-[0_10px_26px_rgba(19,47,39,0.12)]">
          {AGES.map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => {
                onAdd(String(n));
                setOpen(false);
              }}
              className="flex min-h-10 w-full items-center rounded-[7px] px-2.5 text-left text-sm font-normal text-ink hover:bg-[#f1f6f3] hover:text-brand"
            >
              {ageText(String(n))}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
