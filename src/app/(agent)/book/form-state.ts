import { GUEST_NAME_LATIN, GUEST_NAME_PATTERN } from "@/lib/guest-name";

// Result of the guest details and book posts. On an error the form shows the message and what
// the agent typed (guest names, email, phone), so nothing has to be typed again. `fields`: the
// message for each wrong field (by form name), shown under it; the first one gets the focus.
// `recheck`: the price check is too old, so the review page offers to check it again.
export type BookFormState = { status: "error"; message: string; values?: Record<string, string>; fields?: Record<string, string>; recheck?: boolean } | null;

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

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// What is missing or wrong in the guest form, field by field (the server checks it all again).
// Names in Latin letters as on the passport; the lead guest's email, country code and phone.
export function guestFieldErrors(values: Record<string, string>): Record<string, string> {
  const errors: Record<string, string> = {};
  for (let r = 0; values[guestField("given", r, 0)] !== undefined; r++) {
    for (let i = 0; values[guestField("given", r, i)] !== undefined; i++) {
      for (const [kind, what] of [["given", "given name"], ["family", "family name"]] as const) {
        const field = guestField(kind, r, i);
        const value = (values[field] ?? "").trim();
        if (!value) errors[field] = `Enter the ${what}.`;
        else if (!GUEST_NAME_PATTERN.test(value)) errors[field] = GUEST_NAME_LATIN;
      }
    }
  }
  const email = (values.leadEmail ?? "").trim();
  if (!email) errors.leadEmail = "Enter the lead guest's email.";
  else if (!EMAIL.test(email) || email.length > 254) errors.leadEmail = "Enter a valid email, like name@example.com.";
  if (!/^\d{1,3}$/.test((values.phoneCountry ?? "").replace(/[\s+]/g, ""))) errors.phoneCountry = "Enter the country code: 1 to 3 digits, like 972.";
  if (!/^\d{4,14}$/.test((values.phoneNumber ?? "").replace(/[\s().-]/g, ""))) errors.phoneNumber = "Enter the phone number: 4 to 14 digits.";
  return errors;
}

// The form field of a place the server named as wrong ("rooms.0.guests.1.givenName" → r0_given_1).
export function formFieldOf(path: string): string | null {
  const guest = /^rooms\.(\d+)\.guests\.(\d+)\.(givenName|familyName)$/.exec(path);
  if (guest) return guestField(guest[3] === "givenName" ? "given" : "family", Number(guest[1]), Number(guest[2]));
  if (path === "leadEmail") return "leadEmail";
  if (path === "leadPhone.countryCode") return "phoneCountry";
  if (path === "leadPhone.number") return "phoneNumber";
  return null;
}

// "1 field is missing or wrong." / "3 fields are missing or wrong." (mockup 10).
export function fieldsMessage(count: number): string {
  return count === 1 ? "1 field is missing or wrong. Check the field marked in red." : `${count} fields are missing or wrong. Check the fields marked in red.`;
}
