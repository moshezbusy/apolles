// Result of the guest details and book posts. On an error the form shows the message and what
// the agent typed (guest names, email, phone), so nothing has to be typed again.
export type BookFormState = { status: "error"; message: string; values?: Record<string, string> } | null;

const MAX_ROOM_FIELDS = 9; // more than the 8 rooms allowed, so too many is refused, not cut
const MAX_GUESTS = 14; // in one room

function text(value: FormDataEntryValue | null, max = 100): string {
  return typeof value === "string" ? value.slice(0, max) : "";
}

// The guest fields of room r (0-based) and guest i of that room: r0_given_0 is room 1's main guest.
export function guestField(kind: "given" | "family" | "title", room: number, guest: number): string {
  return `r${room}_${kind}_${guest}`;
}

// Only the known fields are read (the form also carries Next.js internals).
export function readGuestForm(formData: FormData): Record<string, string> {
  const values: Record<string, string> = {};
  for (const key of ["s", "p", "r", "b", "stay", "saveClient", "clientId", "leadEmail", "phoneCountry", "phoneNumber"]) values[key] = text(formData.get(key), 254);
  values.requestText = text(formData.get("requestText"), 300);
  // The ticked special requests, kept as one comma list (known names only, checked on the server).
  values.requests = formData
    .getAll("requests")
    .filter((v): v is string => typeof v === "string")
    .slice(0, 4)
    .map((v) => v.slice(0, 20))
    .join(",");
  // Rooms in order, each with its guests in order; a room or guest with no name fields ends the list.
  for (let r = 0; r < MAX_ROOM_FIELDS; r++) {
    for (let i = 0; i < MAX_GUESTS; i++) {
      const [given, family, title] = [guestField("given", r, i), guestField("family", r, i), guestField("title", r, i)];
      if (!formData.has(given) && !formData.has(family)) break;
      values[given] = text(formData.get(given), 60);
      values[family] = text(formData.get(family), 60);
      values[title] = text(formData.get(title), 3);
    }
    if (values[guestField("given", r, 0)] === undefined) break;
  }
  return values;
}

export function toDraftInput(values: Record<string, string>) {
  const rooms: { guests: { givenName: string; familyName: string; title?: string }[] }[] = [];
  for (let r = 0; values[guestField("given", r, 0)] !== undefined; r++) {
    const guests: { givenName: string; familyName: string; title?: string }[] = [];
    for (let i = 0; values[guestField("given", r, i)] !== undefined; i++) {
      const title = values[guestField("title", r, i)];
      guests.push({ givenName: values[guestField("given", r, i)]!, familyName: values[guestField("family", r, i)] ?? "", ...(title ? { title } : {}) });
    }
    rooms.push({ guests });
  }
  return {
    snapshotId: values.s ?? "",
    propertyId: values.p ?? "",
    rateId: values.r ?? "",
    bedGroupId: values.b ?? "",
    rooms,
    leadEmail: values.leadEmail ?? "",
    specialRequests: { options: (values.requests ?? "").split(",").filter(Boolean), text: values.requestText ?? "" },
    // Plan 5d: only sent when the agent books from a quote.
    ...(values.stay ? { quoteStayId: values.stay } : {}),
    // Spaces, dashes and brackets are allowed in what the agent types; only digits are kept.
    leadPhone: { countryCode: (values.phoneCountry ?? "").replace(/\D/g, ""), number: (values.phoneNumber ?? "").replace(/[\s().-]/g, "") },
  };
}
