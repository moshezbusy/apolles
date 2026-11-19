"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useActionState } from "react";
import { alertError, btnPrimary, input, label } from "@/components/ui";
import type { GuestPrefill } from "@/server/quotes/quote-booking";
import { type BookFormState, guestField } from "../form-state";

type Action = (previous: BookFormState, formData: FormData) => Promise<BookFormState>;

const REQUESTS = [
  { id: "EARLY_CHECKIN", label: "Early check-in" },
  { id: "LATE_CHECKOUT", label: "Late check-out" },
  { id: "HIGH_FLOOR", label: "High floor" },
  { id: "HONEYMOON", label: "Honeymoon" },
];

// One room of the form: its heading ("Room 1 · 2 adults, 1 child"; none when the booking is one
// room) and a label for each of its guests, adults first.
export type GuestFormRoom = { heading: string | null; guests: string[] };

// Screen 10: a given and family name for every guest of every room (lead guest first; each
// room's first adult is its main guest, TR5), and the lead guest's email and phone (TR4). One
// contact and one special request for the whole booking. The rate is passed on as ids only.
export function GuestForm({
  action,
  rate,
  rooms,
  prefill,
}: {
  action: Action;
  rate: { s: string; p: string; r: string; b: string; stay?: string };
  rooms: GuestFormRoom[];
  prefill: GuestPrefill | null;
}) {
  const [state, formAction, pending] = useActionState<BookFormState, FormData>(action, null);
  // What the agent typed wins (after an error); else the chosen client and companions.
  const v = state?.values ?? fromPrefill(prefill, rooms);
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
      {rooms.map((room, r) =>
        room.heading ? (
          <section key={r} aria-labelledby={`room-${r}`} className={`flex flex-col gap-4 ${r > 0 ? "border-t border-line pt-4" : ""}`}>
            <h2 id={`room-${r}`} className="text-base font-bold text-ink">
              {room.heading}
            </h2>
            <RoomGuests room={room} r={r} v={v} />
          </section>
        ) : (
          <RoomGuests key={r} room={room} r={r} v={v} />
        ),
      )}
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

// A given and family name (and title) for each guest of one room.
function RoomGuests({ room, r, v }: { room: GuestFormRoom; r: number; v: Record<string, string> }) {
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
                <option value="">—</option>
                <option value="MR">Mr</option>
                <option value="MRS">Mrs</option>
                <option value="MS">Ms</option>
              </select>
            </label>
            <label className={label}>
              Given name
              <input type="text" name={given} required maxLength={60} autoComplete="off" defaultValue={v[given] ?? ""} className={input} />
            </label>
            <label className={label}>
              Family name
              <input type="text" name={family} required maxLength={60} autoComplete="off" defaultValue={v[family] ?? ""} className={input} />
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
