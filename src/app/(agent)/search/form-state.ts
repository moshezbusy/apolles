// Result of the search form post. On an error the form shows the message and what the agent
// had entered, so nothing has to be typed again.
export type SearchFormValues = {
  destinationId: string;
  destinationLabel: string; // what the box shows: the destination's or the hotel's name
  propertyId: string; // a hotel chosen by name ("" when a destination was chosen)
  checkin: string;
  checkout: string;
  rooms: SearchFormRoom[]; // in room order, 1 to 8 (plan 10)
};

export type SearchFormRoom = { adults: string; childAges: string[] };

export type SearchFormState = { status: "error"; message: string; values: SearchFormValues } | null;

const MAX_FIELD = 100;
const MAX_ROOM_FIELDS = 9; // more than the 8 rooms allowed, so too many is refused, not cut
const MAX_CHILD_FIELDS = 10; // more than the 6 allowed, so too many is refused, not cut

function text(value: FormDataEntryValue | null): string {
  return typeof value === "string" ? value.slice(0, MAX_FIELD) : "";
}

// Only the known fields are read (the form also carries Next.js internals). Each room is a
// room_adults field and a room_children field ("9,4", or "" for none), paired by order; at most
// 9 rooms are read (one more than allowed, for the schema to refuse). The server checks
// everything again.
export function readSearchForm(formData: FormData): SearchFormValues {
  const adults = formData.getAll("room_adults");
  const children = formData.getAll("room_children");
  const count = Math.min(Math.max(adults.length, children.length), MAX_ROOM_FIELDS);
  const rooms = Array.from({ length: count }, (_, i) => {
    const ages = text(children[i] ?? null);
    return { adults: text(adults[i] ?? null), childAges: ages === "" ? [] : ages.split(",").slice(0, MAX_CHILD_FIELDS) };
  });
  return {
    destinationId: text(formData.get("destinationId")),
    destinationLabel: text(formData.get("destinationLabel")),
    propertyId: text(formData.get("propertyId")),
    checkin: text(formData.get("checkin")),
    checkout: text(formData.get("checkout")),
    rooms,
  };
}

// Numbers for the search schema: anything that is not a whole number becomes NaN, which the
// schema refuses (never a silent 0). The hotel (propertyId) is not part of it: see toHotelSearchInput.
export function toSearchInput(values: SearchFormValues) {
  const int = (s: string) => (/^\d{1,2}$/.test(s) ? Number(s) : Number.NaN);
  return {
    destinationId: values.destinationId,
    checkin: values.checkin,
    checkout: values.checkout,
    rooms: values.rooms.map((room) => ({ adults: int(room.adults), childAges: room.childAges.map(int) })),
  };
}

// A hotel chosen by name: the hotel, the dates and the rooms (the destination is read on the server).
export function toHotelSearchInput(values: SearchFormValues) {
  const { checkin, checkout, rooms } = toSearchInput(values);
  return { propertyId: values.propertyId, checkin, checkout, rooms };
}

// Every child the agent added must have an age: a missing one ("4,") is refused, never dropped
// (it would price the room for fewer guests).
export function childAgesComplete(values: SearchFormValues): boolean {
  return values.rooms.every((room) => room.childAges.every((age) => age.trim() !== ""));
}
