"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { type ReactNode, useActionState, useEffect, useRef } from "react";
import { alertError, btnPrimary, input, label, link } from "@/components/ui";
import type { GuestPrefill } from "@/server/quotes/quote-booking";
import { type BookFormState, guestField } from "../form-state";

type Action = (previous: BookFormState, formData: FormData) => Promise<BookFormState>;

const REQUESTS = [
  { id: "EARLY_CHECKIN", label: "Early check-in" },
  { id: "LATE_CHECKOUT", label: "Late check-out" },
  { id: "HIGH_FLOOR", label: "High floor" },
  { id: "HONEYMOON", label: "Honeymoon" },
];

// The guest form's id: "Choose from clients" (outside the form) looks at what was typed in it.
const FORM_ID = "guest-details";

// A wrong field (mockup 10): a red border and its message under it. Built from `input` with its
// border colour swapped, so the two border colours never compete in one class list.
const invalidInput = input.replace("border-[#d9e1dc]", "border-[#c9786b] ring-2 ring-[#c9786b]/15");
const fieldMessage = "text-[11px] font-semibold text-[#a0493b]";

// One room of the form: its heading ("Room 1 · 2 adults, 1 child"; none when the booking is one
// room) and a label for each of its guests, adults first.
export type GuestFormRoom = { heading: string | null; guests: string[] };

// The class and the accessibility attributes of a field, by whether it is marked wrong.
function fieldClass(errors: Record<string, string>, name: string): string {
  return errors[name] ? invalidInput : input;
}
function describedBy(errors: Record<string, string>, name: string): string | undefined {
  return errors[name] ? `${name}-error` : undefined;
}

// Screen 10: a given and family name for every guest of every room (lead guest first; each
// room's first adult is its main guest, TR5), and the lead guest's email and phone (TR4). One
// contact and one special request for the whole booking. `hidden`: the rate as ids only (a new
// booking) or the draft's id ("Edit guest details" on the review page). A wrong field is marked
// with its own message, and the first one gets the focus.
export function GuestForm({
  action,
  hidden,
  rooms,
  prefill,
  initial,
  back,
  submitLabel = "Continue to review",
}: {
  action: Action;
  hidden: Record<string, string>;
  rooms: GuestFormRoom[];
  prefill: GuestPrefill | null;
  // The draft's own details, when they are being edited (no "Save to Clients" then).
  initial?: Record<string, string> | null;
  back: { href: string; label: string };
  submitLabel?: string;
}) {
  const [state, formAction, pending] = useActionState<BookFormState, FormData>(action, null);
  const formRef = useRef<HTMLFormElement>(null);
  // What the agent typed wins (after an error); else the draft, or the chosen client and companions.
  const v = state?.values ?? initial ?? fromPrefill(prefill, rooms);
  const errors = state?.fields ?? {};
  useEffect(() => {
    const wrong = state?.fields;
    if (!wrong) return;
    const first = Array.from(formRef.current?.querySelectorAll<HTMLInputElement>("input[name]") ?? []).find((el) => el.name in wrong);
    first?.focus();
  }, [state]);
  return (
    <form id={FORM_ID} ref={formRef} key={JSON.stringify(v)} action={formAction} noValidate className="flex flex-col gap-5">
      {state ? (
        <p role="alert" className={alertError}>
          {state.message}
        </p>
      ) : null}
      {Object.entries(hidden).map(([key, value]) => (
        <input key={key} type="hidden" name={key} value={value} />
      ))}
      {rooms.map((room, r) =>
        room.heading ? (
          <section key={r} aria-labelledby={`room-${r}`} className={`flex flex-col gap-4 ${r > 0 ? "border-t border-line pt-4" : ""}`}>
            <h2 id={`room-${r}`} className="text-base font-bold text-ink">
              {room.heading}
            </h2>
            <RoomGuests room={room} r={r} v={v} errors={errors} />
          </section>
        ) : (
          <RoomGuests key={r} room={room} r={r} v={v} errors={errors} />
        ),
      )}
      <fieldset className="grid gap-3 sm:grid-cols-[1fr_110px_1fr]">
        <legend className="mb-2 text-sm font-bold text-ink">Lead guest contact</legend>
        <label className={label}>
          Email
          <input type="email" required maxLength={254} autoComplete="off" defaultValue={v.leadEmail ?? ""} name="leadEmail" className={fieldClass(errors, "leadEmail")} aria-invalid={errors.leadEmail ? true : undefined} aria-describedby={describedBy(errors, "leadEmail")} />
          <FieldError name="leadEmail" errors={errors} />
        </label>
        <label className={label}>
          Country code
          <input type="text" inputMode="numeric" required maxLength={4} placeholder="972" defaultValue={v.phoneCountry ?? ""} name="phoneCountry" className={fieldClass(errors, "phoneCountry")} aria-invalid={errors.phoneCountry ? true : undefined} aria-describedby={describedBy(errors, "phoneCountry")} />
          <FieldError name="phoneCountry" errors={errors} />
        </label>
        <label className={label}>
          Phone number
          <input type="tel" required maxLength={20} placeholder="50 123 4567" defaultValue={v.phoneNumber ?? ""} name="phoneNumber" className={fieldClass(errors, "phoneNumber")} aria-invalid={errors.phoneNumber ? true : undefined} aria-describedby={describedBy(errors, "phoneNumber")} />
          <FieldError name="phoneNumber" errors={errors} />
        </label>
      </fieldset>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-sm font-bold text-ink">
          Special requests <span className="ml-1 text-xs font-normal text-muted">Optional. Sent to the hotel and not guaranteed.</span>
        </legend>
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          {REQUESTS.map((r) => (
            <label key={r.id} className="flex items-center gap-2 text-sm text-ink">
              <input type="checkbox" name="requests" value={r.id} defaultChecked={(v.requests ?? "").split(",").includes(r.id)} className="h-4 w-4 accent-brand" />
              {r.label}
            </label>
          ))}
        </div>
        <label className={label}>
          Additional request
          <input type="text" name="requestText" maxLength={300} defaultValue={v.requestText ?? ""} placeholder="e.g. Quiet room, twin beds if possible" className={input} />
        </label>
        <p className="text-xs text-muted">Do not write personal, ID, card or phone details here.</p>
      </fieldset>
      {initial ? null : prefill ? (
        <input type="hidden" name="clientId" value={prefill.clientId} />
      ) : (
        <label className="flex items-center gap-2 text-sm text-ink">
          <input type="checkbox" name="saveClient" defaultChecked={v.saveClient === "on"} className="h-4 w-4 accent-brand" />
          Save the lead guest to Clients, so you can select them next time.
        </label>
      )}
      <p className="text-xs text-muted">The hotel receives the lead guest&apos;s name, email and phone. Use the guest&apos;s own details.</p>
      <div className="flex flex-wrap items-center gap-4">
        <button type="submit" disabled={pending} className={btnPrimary}>
          {pending ? "Saving…" : submitLabel}
        </button>
        <Link href={back.href} className={link}>
          {back.label}
        </Link>
      </div>
    </form>
  );
}

function FieldError({ name, errors }: { name: string; errors: Record<string, string> }): ReactNode {
  return errors[name] ? (
    <span id={`${name}-error`} className={fieldMessage}>
      {errors[name]}
    </span>
  ) : null;
}

// A given and family name (and title) for each guest of one room.
function RoomGuests({ room, r, v, errors }: { room: GuestFormRoom; r: number; v: Record<string, string>; errors: Record<string, string> }) {
  return (
    <>
      {room.guests.map((title, i) => {
        const [given, family, titleField] = [guestField("given", r, i), guestField("family", r, i), guestField("title", r, i)];
        return (
          <fieldset key={i} className="grid gap-3 sm:grid-cols-2">
            <legend className="mb-2 text-sm font-bold text-ink">
              {title}
              {i === 0 && r === 0 ? <span className="ml-2 text-xs font-normal text-muted">Lead guest: the booking is in this name</span> : null}
              {i === 0 && r > 0 ? <span className="ml-2 text-xs font-normal text-muted">Main guest of this room</span> : null}
            </legend>
            <label className={`${label} sm:col-span-2 sm:max-w-[140px]`}>
              Title
              <select name={titleField} defaultValue={v[titleField] ?? ""} className={input}>
                <option value="">None</option>
                <option value="MR">Mr</option>
                <option value="MRS">Mrs</option>
                <option value="MS">Ms</option>
              </select>
            </label>
            <label className={label}>
              Given name
              <input type="text" required maxLength={60} autoComplete="off" defaultValue={v[given] ?? ""} name={given} className={fieldClass(errors, given)} aria-invalid={errors[given] ? true : undefined} aria-describedby={describedBy(errors, given)} />
              <FieldError name={given} errors={errors} />
            </label>
            <label className={label}>
              Family name
              <input type="text" required maxLength={60} autoComplete="off" defaultValue={v[family] ?? ""} name={family} className={fieldClass(errors, family)} aria-invalid={errors[family] ? true : undefined} aria-describedby={describedBy(errors, family)} />
              <FieldError name={family} errors={errors} />
            </label>
          </fieldset>
        );
      })}
    </>
  );
}

// The client and companions fill the guests in order, room after room.
function fromPrefill(prefill: GuestPrefill | null, rooms: GuestFormRoom[]): Record<string, string> {
  if (!prefill) return {};
  const values: Record<string, string> = { leadEmail: prefill.leadEmail, phoneCountry: prefill.phoneCountry, phoneNumber: prefill.phoneNumber };
  const fields = rooms.flatMap((room, r) => room.guests.map((_, i) => [guestField("given", r, i), guestField("family", r, i)] as const));
  prefill.guests.forEach((g, k) => {
    const field = fields[k];
    if (!field) return;
    values[field[0]] = g.givenName;
    values[field[1]] = g.familyName;
  });
  return values;
}

// Something was typed or changed in the guest form (not only what a chosen client filled in).
function typedInForm(): boolean {
  const form = document.getElementById(FORM_ID);
  if (!(form instanceof HTMLFormElement)) return false;
  return Array.from(form.querySelectorAll("input")).some((el) => (el.type === "checkbox" ? el.checked !== el.defaultChecked : el.type !== "hidden" && el.value !== el.defaultValue));
}

// "Choose from clients": fills the guests from one of the agency's clients (read on the server).
// When the agent already typed something, it asks before replacing it.
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
          const question = e.target.value ? "Replace the guest details you typed with this client's details?" : "Clear the guest details you typed?";
          if (typedInForm() && !window.confirm(question)) return;
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
