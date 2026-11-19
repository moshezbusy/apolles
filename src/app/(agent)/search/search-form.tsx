"use client";

import { useActionState, useId, useRef, useState } from "react";
import { alertError, btnPrimary, btnSecondary, input, label } from "@/components/ui";
import { DateRangeField } from "@/components/date-picker/DateRangeField";
import { DestinationPicker } from "./destination-picker";
import type { SearchFormState, SearchFormValues } from "./form-state";

// Search box (screens 07, 08, 09): destination, dates, and per room the adults and each child's
// age (SP1). The dates are our own calendar (plan 9: DD/MM/YYYY, the system's look); they are
// sent as ISO dates. Rooms (plan 10): one block per room, sent in room order as room_adults and
// room_children ("9,4"); "Add room" only when several rooms are allowed (multiRoomAllowed, from
// the server page). Everything is checked again on the server.

type Action = (previous: SearchFormState, formData: FormData) => Promise<SearchFormState>;

const ADULTS = [1, 2, 3, 4, 5, 6, 7, 8];
const MAX_CHILDREN = 6;
const MAX_ROOMS = 8;
const AGES = Array.from({ length: 18 }, (_, i) => i);

type Room = { key: number; adults: number; ages: string[] }; // key: stable while rooms are removed

export function SearchForm({
  action,
  values,
  minDate,
  maxDate,
  compact = false,
  quoteId = null,
  multiRoomAllowed = false,
}: {
  action: Action;
  values: SearchFormValues;
  minDate: string;
  maxDate: string;
  compact?: boolean;
  quoteId?: string | null;
  multiRoomAllowed?: boolean;
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
      <Fields shown={shown} minDate={minDate} maxDate={maxDate} pending={pending} compact={compact} multiRoomAllowed={multiRoomAllowed} />
    </form>
  );
}

export function ageText(age: string): string {
  return Number(age) === 1 ? "1 year" : `${Number(age)} years`;
}

// The rooms as the form starts with them. Children are added straight by age (owner, 19.11):
// no "number of children" box, so no child can be left without an age. Ages the server refused
// come back as "" and are dropped; with no rooms at all the form starts with one of two adults.
function startRooms(values: SearchFormValues): Room[] {
  const rooms = values.rooms.slice(0, MAX_ROOMS).map((room, key) => ({
    key,
    adults: ADULTS.includes(Number(room.adults)) ? Number(room.adults) : 2,
    ages: room.childAges.filter((a) => /^\d{1,2}$/.test(a)).slice(0, MAX_CHILDREN),
  }));
  return rooms.length > 0 ? rooms : [{ key: 0, adults: 2, ages: [] }];
}

function Fields({
  shown,
  minDate,
  maxDate,
  pending,
  compact,
  multiRoomAllowed,
}: {
  shown: SearchFormValues;
  minDate: string;
  maxDate: string;
  pending: boolean;
  compact: boolean;
  multiRoomAllowed: boolean;
}) {
  const [rooms, setRooms] = useState<Room[]>(() => startRooms(shown));
  const nextKey = useRef(MAX_ROOMS);
  const guests = rooms.reduce((n, room) => n + room.adults + room.ages.length, 0);
  const update = (index: number, change: (room: Room) => Room) => setRooms((current) => current.map((room, i) => (i === index ? change(room) : room)));

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
            {rooms.length} {rooms.length === 1 ? "room" : "rooms"} · {guests} {guests === 1 ? "guest" : "guests"}
          </span>
          <span aria-hidden="true" className="text-[11px] text-[#8a938e]">
            ▾
          </span>
        </summary>
        <div className="absolute right-0 z-40 mt-1.5 flex max-h-[min(560px,75vh)] w-[min(300px,calc(100vw-40px))] flex-col gap-3 overflow-y-auto rounded-[11px] border border-[#e1e6e3] bg-white p-3.5 shadow-[0_15px_38px_rgba(19,47,39,0.14)]">
          {rooms.map((room, index) => (
            <RoomFields
              key={room.key}
              index={index}
              room={room}
              several={rooms.length > 1}
              onAdults={(adults) => update(index, (r) => ({ ...r, adults }))}
              onAddChild={(age) => update(index, (r) => ({ ...r, ages: [...r.ages, age].slice(0, MAX_CHILDREN) }))}
              onRemoveChild={(child) => update(index, (r) => ({ ...r, ages: r.ages.filter((_, i) => i !== child) }))}
              onRemove={index > 0 ? () => setRooms((current) => current.filter((_, i) => i !== index)) : null}
            />
          ))}
          {multiRoomAllowed && rooms.length < MAX_ROOMS ? (
            <button type="button" onClick={() => {
                const key = nextKey.current++;
                setRooms((current) => [...current, { key, adults: 2, ages: [] }].slice(0, MAX_ROOMS));
              }} className={`${btnSecondary} w-full`}>
              Add room
            </button>
          ) : null}
          {rooms.length > 1 ? <p className="text-xs text-muted">Same room type for all rooms.</p> : null}
          {!multiRoomAllowed && rooms.length === 1 ? <p className="text-xs text-muted">One room per booking.</p> : null}
        </div>
      </details>
      <button type="submit" disabled={pending} className={btnPrimary}>
        {pending ? "Searching…" : "Search"}
      </button>
    </div>
  );
}

// One room: its adults and its children by age, sent as room_adults and room_children.
function RoomFields({
  index,
  room,
  several,
  onAdults,
  onAddChild,
  onRemoveChild,
  onRemove,
}: {
  index: number;
  room: Room;
  several: boolean;
  onAdults: (adults: number) => void;
  onAddChild: (age: string) => void;
  onRemoveChild: (child: number) => void;
  onRemove: (() => void) | null;
}) {
  const number = index + 1;
  // With several rooms, the buttons say which room they belong to (screen readers read them alone).
  const ofRoom = several ? ` of room ${number}` : "";
  return (
    <div role="group" aria-label={`Room ${number}`} className={`flex flex-col gap-3 ${index > 0 ? "border-t border-[#e1e6e3] pt-3" : ""}`}>
      <div className="flex items-center justify-between">
        <span className="text-sm font-bold text-ink">Room {number}</span>
        {onRemove ? (
          <button type="button" aria-label={`Remove room ${number}`} onClick={onRemove} className="text-xs font-semibold text-muted hover:text-ink">
            Remove room
          </button>
        ) : null}
      </div>
      <input type="hidden" name="room_adults" value={room.adults} />
      <input type="hidden" name="room_children" value={room.ages.join(",")} />
      <label className={label}>
        Adults
        <select value={room.adults} onChange={(e) => onAdults(Number(e.target.value))} className={input}>
          {ADULTS.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </label>
      <div className={label}>
        <span>Children</span>
        {room.ages.map((age, child) => (
          <div key={child} className="flex min-h-10 items-center justify-between rounded-lg border border-[#d9e1dc] bg-brand-soft px-3 text-sm font-semibold text-brand">
            <span>
              Child {child + 1} · {ageText(age)}
            </span>
            <button
              type="button"
              aria-label={`Remove child ${child + 1}${ofRoom}`}
              onClick={() => onRemoveChild(child)}
              className="grid h-8 w-8 place-items-center rounded-full text-base text-brand hover:bg-white"
            >
              ×
            </button>
          </div>
        ))}
        {room.ages.length < MAX_CHILDREN ? (
          <AddChild onAdd={onAddChild} />
        ) : (
          <p className="text-xs font-normal text-muted">Up to {MAX_CHILDREN} children.</p>
        )}
      </div>
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
