"use client";

import { useId, useState, type ReactNode } from "react";
import { btnSecondary } from "@/components/ui";

// Results filters (screen 08). On a phone the form would fill the first screen before any
// hotel, so below lg it folds away behind a "Filters" button (plan 9). From lg up it is always
// shown, as before. One form either way: nothing is rendered twice.
export function FiltersPanel({ activeCount, children }: { activeCount: number; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <>
      <button type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)} className={`${btnSecondary} w-full justify-between lg:hidden`}>
        <span>
          Filters{activeCount > 0 ? <span className="font-normal text-muted"> · {activeCount} on</span> : null}
        </span>
        <span aria-hidden="true" className="text-[11px]">
          {open ? "▴" : "▾"}
        </span>
      </button>
      <div id={id} className={`${open ? "block" : "hidden"} lg:block`}>
        {children}
      </div>
    </>
  );
}

// "Sort by" applies at once (the other filters wait for "Apply filters"): it sends the filters
// form with what is in it now. Without JavaScript it waits for "Apply filters" like the rest.
export function SortSelect({ defaultValue, className, children }: { defaultValue: string; className: string; children: ReactNode }) {
  return (
    <select name="sort" defaultValue={defaultValue} className={className} onChange={(event) => event.currentTarget.form?.requestSubmit()}>
      {children}
    </select>
  );
}
