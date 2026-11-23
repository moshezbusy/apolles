import { z } from "zod";
import { isIsoDate } from "@/components/date-picker/calendar";
import { parseRoomsParam } from "@/server/ai/links";
import type { Occupancy } from "@/server/supplier/types";

// What a result link (design §6) and the "Show rates" form carry. Everything is checked again
// here: the link comes from outside. `dest` and `nat` are display-only and never used to search.

const ID = /^[A-Za-z0-9_-]{1,64}$/;

export type OpenFields = { hotel: string; destId: string; checkin: string; checkout: string; rooms: Occupancy[]; roomsText: string };

const fieldsSchema = z.object({
  hotel: z.string().regex(ID),
  destId: z.string().regex(ID),
  in: z.string().refine(isIsoDate),
  out: z.string().refine(isIsoDate),
  rooms: z.string().refine((v) => parseRoomsParam(v) !== null),
});

type Raw = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

// null when anything is wrong (the page and the action both answer "Check the destination, dates and guests.").
export function parseOpenFields(raw: Raw): OpenFields | null {
  const parsed = fieldsSchema.safeParse({
    hotel: first(raw.hotel),
    destId: first(raw.destId),
    in: first(raw.in),
    out: first(raw.out),
    rooms: first(raw.rooms),
  });
  if (!parsed.success) return null;
  const rooms = parseRoomsParam(parsed.data.rooms);
  if (!rooms || parsed.data.out <= parsed.data.in) return null;
  return { hotel: parsed.data.hotel, destId: parsed.data.destId, checkin: parsed.data.in, checkout: parsed.data.out, rooms, roomsText: parsed.data.rooms };
}

// Display-only text: capped, never used for anything but showing.
export function displayText(value: string | string[] | undefined, max: number): string {
  const text = first(value);
  return text.length > max ? "" : text;
}

export const NOTICES = {
  invalid: "Check the destination, dates and guests.",
  ratelimited: "Too many searches. Wait a minute and try again.",
  unavailable: "Hotel search is unavailable right now. Try again in a few minutes.",
} as const;

export type Notice = keyof typeof NOTICES;

export function noticeOf(value: string | string[] | undefined): Notice | null {
  const v = first(value);
  return v === "invalid" || v === "ratelimited" || v === "unavailable" ? v : null;
}

// The link back to the page with a message (same fields the form carried).
export function openPath(fields: OpenFields, notice: Notice): string {
  const q = new URLSearchParams({ in: fields.checkin, out: fields.checkout, rooms: fields.roomsText, hotel: fields.hotel, destId: fields.destId, notice });
  return `/search/open?${q.toString()}`;
}
