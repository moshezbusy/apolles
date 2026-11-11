// Guests as stored on a booking: adults first (the lead guest is the first adult), then the
// children, each with the age the search was priced for (BP7).
export function guestLines(guests: { givenName: string; familyName: string }[], adults: number, childAges: number[]): string[] {
  return guests.map((g, i) => (i < adults ? `${g.givenName} ${g.familyName}` : `${g.givenName} ${g.familyName} (child, age ${childAges[i - adults] ?? "?"})`));
}
