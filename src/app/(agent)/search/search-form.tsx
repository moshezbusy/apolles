"use client";

import { useActionState, useEffect, useId, useRef, useState } from "react";
import { alertError, btnPrimary, input, label } from "@/components/ui";
import { DateRangeField } from "@/components/date-picker/DateRangeField";
import { DestinationPicker } from "./destination-picker";
import type { SearchFormState, SearchFormValues } from "./form-state";

// Search box (screens 07, 08, 09): destination, dates, and per room the adults and each child's
// age (SP1). The dates are our own calendar (plan 9: DD/MM/YYYY, the system's look); they are
// sent as ISO dates. Rooms (plan 10): one block per room, sent in room order as room_adults and
// room_children ("9,4"); "+ Add a room" only when several rooms are allowed (multiRoomAllowed, from
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
  const panel = useRef<HTMLDetailsElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const added = useRef(false);
  const done = useRef<HTMLButtonElement>(null);
  const guests = rooms.reduce((n, room) => n + room.adults + room.ages.length, 0);
  const update = (index: number, change: (room: Room) => Room) => setRooms((current) => current.map((room, i) => (i === index ? change(room) : room)));

  // A room just added: scroll the room list to it (the panel itself keeps its place and size).
  useEffect(() => {
    if (!added.current) return;
    added.current = false;
    const smooth = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: smooth ? "smooth" : "auto" });
    // At the 8th room "+ Add a room" goes away: keep the keyboard focus in the panel.
    if (rooms.length >= MAX_ROOMS) done.current?.focus();
  }, [rooms.length]);

  return (
    <div className={`grid items-end gap-3 ${compact ? "lg:grid-cols-[1.6fr_1fr_1fr_1fr_auto]" : "md:grid-cols-2 lg:grid-cols-[1.6fr_1fr_1fr_1fr_auto]"}`}>
      <div className={label}>
        <span>Destination</span>
        <DestinationPicker defaultId={shown.destinationId} defaultLabel={shown.destinationLabel} />
      </div>
      <DateRangeField checkin={shown.checkin} checkout={shown.checkout} min={minDate} max={maxDate} />
      <details ref={panel} data-menu="plain" className="relative">
        <summary className={`${input} flex cursor-pointer list-none items-center justify-between`} aria-label="Rooms and guests">
          <span>
            {rooms.length} {rooms.length === 1 ? "room" : "rooms"} · {guests} {guests === 1 ? "guest" : "guests"}
          </span>
          <span aria-hidden="true" className="text-[11px] text-[#8a938e]">
            ▾
          </span>
        </summary>
        {/* Owner's picture (20.11): the panel floats over the page, so adding rooms never moves
            or lengthens the page: under the field from sm up, a sheet fixed to the bottom of the
            screen on a phone. The room list scrolls inside it, with "+ Add a room" and Done
            always at the bottom. */}
        <div className="absolute right-0 z-40 mt-1.5 flex w-[min(380px,calc(100vw-40px))] flex-col rounded-[14px] border border-[#e1e6e3] bg-white shadow-[0_15px_38px_rgba(19,47,39,0.14)] max-sm:fixed max-sm:inset-x-0 max-sm:bottom-0 max-sm:z-50 max-sm:mt-0 max-sm:w-full max-sm:rounded-b-none max-sm:rounded-t-[18px] max-sm:shadow-[0_-12px_38px_rgba(19,47,39,0.18)]">
          <div ref={scroller} data-rooms-scroll="true" className="max-h-[min(420px,calc(100dvh-260px))] overflow-y-auto overscroll-contain px-4 pb-3 pt-4 max-sm:max-h-[62dvh]">
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
            {rooms.length > 1 ? <p className="mt-3 text-xs text-muted">Same room type for all rooms.</p> : null}
            {!multiRoomAllowed && rooms.length === 1 ? <p className="mt-3 text-xs text-muted">One room per booking.</p> : null}
          </div>
          <div className="flex items-center gap-3 border-t border-[#eeeae5] px-4 py-3 max-sm:pb-[max(12px,env(safe-area-inset-bottom))]">
            {multiRoomAllowed && rooms.length < MAX_ROOMS ? (
              <button
                type="button"
                onClick={() => {
                  const key = nextKey.current++;
                  added.current = true;
                  setRooms((current) => [...current, { key, adults: 2, ages: [] }].slice(0, MAX_ROOMS));
                }}
                className="text-sm font-bold text-brand hover:underline"
              >
                + Add a room
              </button>
            ) : null}
            <button
              ref={done}
              type="button"
              onClick={() => {
                if (panel.current) panel.current.open = false;
                panel.current?.querySelector("summary")?.focus();
              }}
              className={`${btnPrimary} ml-auto min-w-[120px]`}
            >
              Done
            </button>
          </div>
        </div>
      </details>
      <button type="submit" disabled={pending} className={btnPrimary}>
        {pending ? "Searching…" : "Search"}
      </button>
    </div>
  );
}

// One room: its adults (a - / + stepper) and its children by age (chips side by side, then a
// small "+"), sent as room_adults and room_children.
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
  const inRoom = several ? ` in room ${number}` : "";
  const ofRoom = several ? ` of room ${number}` : "";
  const min = ADULTS[0] ?? 1;
  const max = ADULTS[ADULTS.length - 1] ?? 8;
  return (
    <div role="group" aria-label={`Room ${number}`} className={index > 0 ? "mt-4 border-t border-[#e1e6e3] pt-4" : ""}>
      <div className="flex items-center justify-between">
        <span className="text-base font-bold text-ink">Room {number}</span>
        {onRemove ? (
          <button type="button" aria-label={`Remove room ${number}`} onClick={onRemove} className="text-sm font-semibold text-[#9b3b2e] hover:underline">
            Remove
          </button>
        ) : null}
      </div>
      <input type="hidden" name="room_adults" value={room.adults} />
      <input type="hidden" name="room_children" value={room.ages.join(",")} />
      <div className="mt-2.5 grid grid-cols-[auto_1fr] items-start gap-4">
        <div className={label}>
          <span>Adults</span>
          <div className="flex h-10 items-center rounded-lg border border-[#d9e1dc] bg-paper">
            <button
              type="button"
              disabled={room.adults <= min}
              aria-label={`Fewer adults${inRoom}`}
              onClick={() => onAdults(Math.max(min, room.adults - 1))}
              className="grid h-10 w-10 place-items-center rounded-l-lg text-xl text-brand hover:bg-brand-soft disabled:cursor-not-allowed disabled:text-[#c3c9c5] disabled:hover:bg-transparent"
            >
              −
            </button>
            <span aria-live="polite" className="w-6 text-center text-base font-semibold tabular-nums text-ink">
              {room.adults}
            </span>
            <button
              type="button"
              disabled={room.adults >= max}
              aria-label={`More adults${inRoom}`}
              onClick={() => onAdults(Math.min(max, room.adults + 1))}
              className="grid h-10 w-10 place-items-center rounded-r-lg text-xl text-brand hover:bg-brand-soft disabled:cursor-not-allowed disabled:text-[#c3c9c5] disabled:hover:bg-transparent"
            >
              +
            </button>
          </div>
        </div>
        <div className={`${label} min-w-0`}>
          <span>Children</span>
          {room.ages.length === 0 ? (
            <div className="flex flex-col">
              <AddChild onAdd={onAddChild} label={`Add a child${several ? ` to room ${number}` : ""}`} compact={false} />
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-1.5">
              {room.ages.map((age, child) => (
                <span key={child} className="inline-flex h-9 items-center gap-0.5 rounded-lg bg-[#f1f4f2] pl-3 pr-1 text-sm font-medium text-ink">
                  {ageText(age)}
                  <button
                    type="button"
                    aria-label={`Remove child ${child + 1}${ofRoom}`}
                    onClick={() => onRemoveChild(child)}
                    className="grid h-7 w-7 place-items-center rounded-full text-base text-muted hover:bg-white hover:text-ink"
                  >
                    ×
                  </button>
                </span>
              ))}
              {room.ages.length < MAX_CHILDREN ? (
                <AddChild onAdd={onAddChild} label={`Add a child${several ? ` to room ${number}` : ""}`} compact />
              ) : (
                <p className="basis-full text-xs font-normal text-muted">Up to {MAX_CHILDREN} children.</p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// "Add a child" (owner's picture, 19.11): a button that opens the list of ages; a tap on an age
// adds the child and closes the list. Buttons, not a <select>: arrow keys on a closed select
// change its value in some browsers, which would add children nobody asked for. Once the room
// has children it is a small "+" after the chips (owner's picture, 20.11); the list then takes
// a full line below them.
function AddChild({ onAdd, label: name, compact }: { onAdd: (age: string) => void; label: string; compact: boolean }) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  const list = useRef<HTMLDivElement>(null);
  // The list opens inside the scrolling room list: bring it into view if it opened below it.
  useEffect(() => {
    if (open) list.current?.scrollIntoView({ block: "nearest" });
  }, [open]);
  return (
    <>
      {compact ? (
        <button
          type="button"
          aria-expanded={open}
          aria-controls={listId}
          aria-label={name}
          onClick={() => setOpen((o) => !o)}
          className="grid h-9 w-12 place-items-center rounded-lg border border-[#d9e1dc] bg-paper text-xl text-[#8a938e] hover:border-[#bcd0c6] hover:text-brand"
        >
          +
        </button>
      ) : (
        <button
          type="button"
          aria-expanded={open}
          aria-controls={listId}
          aria-label={name === "Add a child" ? undefined : name}
          onClick={() => setOpen((o) => !o)}
          className={`${input} flex items-center justify-between text-left`}
        >
          Add a child
          <span aria-hidden="true" className="text-[11px] text-[#8a938e]">
            {open ? "▴" : "▾"}
          </span>
        </button>
      )}
      {open ? (
        <div ref={list} id={listId} role="group" aria-label="Age of the child" className="mt-1.5 max-h-56 basis-full overflow-y-auto rounded-[11px] border border-[#e1e6e3] bg-white p-1.5 shadow-[0_10px_26px_rgba(19,47,39,0.12)]">
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
    </>
  );
}
