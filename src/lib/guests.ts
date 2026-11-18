// Guests as stored on a booking: adults first (the lead guest is the first adult), then the
// children, each with the age the search was priced for (BP7). A title (plan 8b) comes first.
export type StoredGuest = { givenName: string; familyName: string; title?: "MR" | "MRS" | "MS" };

const TITLE = { MR: "Mr", MRS: "Mrs", MS: "Ms" } as const;

export function guestName(g: StoredGuest): string {
  return `${g.title ? `${TITLE[g.title]} ` : ""}${g.givenName} ${g.familyName}`;
}

export function guestLines(guests: StoredGuest[], adults: number, childAges: number[]): string[] {
  return guests.map((g, i) => (i < adults ? guestName(g) : `${guestName(g)} (child, age ${childAges[i - adults] ?? "?"})`));
}
