import { countryName, isCountryCode } from "@/lib/countries";
import { appIssuer } from "@/server/ai/config";
import { MAX_ROOMS } from "@/server/search/input";
import type { Occupancy } from "@/server/supplier/types";

// Result links of the AI connector (design §6): `/search/open` on the app's own address, with
// the URL contract of mockup 07 plus the hotel and destination ids (names are not unique). The
// link holds no token and no personal data; opening it runs no search.

const MAX_ROOMS_PARAM_LENGTH = 200;
const MAX_ADULTS = 8;
const MAX_CHILDREN = 6;
const MAX_CHILD_AGE = 17;
// A whole number without a leading zero ("0" itself is allowed): one canonical text per room.
const NUMBER = /^(0|[1-9]\d?)$/;

// Rooms joined by ",", each room = adults then child ages joined by "-": "2-5-9,2".
function roomsParam(rooms: Occupancy[]): string {
  return rooms.map((room) => [room.adults, ...room.childAges].join("-")).join(",");
}

// `nationality` is an ISO 3166 code ("IL"); the link carries the country name ("Israel").
export function hotelLink(i: {
  hotelName: string;
  propertyId: string;
  destinationId: string;
  checkin: string;
  checkout: string;
  rooms: Occupancy[];
  nationality: string;
}): string {
  if (!isCountryCode(i.nationality)) throw new Error("hotelLink: nationality must be an ISO country code");
  const params = new URLSearchParams({
    dest: i.hotelName,
    type: "hotel",
    in: i.checkin,
    out: i.checkout,
    rooms: roomsParam(i.rooms),
    nat: countryName(i.nationality),
    hotel: i.propertyId,
    destId: i.destinationId,
  });
  return `${appIssuer()}/search/open?${params.toString()}`;
}

// "2-5-9,2" → [{ adults: 2, childAges: [5, 9] }, { adults: 2, childAges: [] }]. null for
// anything else: 1-8 rooms, each with 1-8 adults and 0-6 children aged 0-17.
export function parseRoomsParam(text: string): Occupancy[] | null {
  if (typeof text !== "string" || text.length === 0 || text.length > MAX_ROOMS_PARAM_LENGTH) return null;
  const parts = text.split(",");
  if (parts.length > MAX_ROOMS) return null;
  const rooms: Occupancy[] = [];
  for (const part of parts) {
    const numbers = part.split("-");
    if (!numbers.every((n) => NUMBER.test(n))) return null;
    const [adults, ...childAges] = numbers.map(Number);
    if (adults === undefined || adults < 1 || adults > MAX_ADULTS) return null;
    if (childAges.length > MAX_CHILDREN || childAges.some((age) => age > MAX_CHILD_AGE)) return null;
    rooms.push({ adults, childAges });
  }
  return rooms;
}
