import { z } from "zod";

// What an agent searches by (spec section 3, row 4), with Rapid's limits: check-in from today
// to 365 days ahead (UTC), 1 to 28 nights, one room, 1 to 8 adults, up to 6 children aged 0-17.
// There is no nationality: Rapid takes only the point of sale (the agency's country, TR2).

const MAX_DAYS_AHEAD = 365;
const MAX_NIGHTS = 28;
const DAY_MS = 86_400_000;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value; // no "2027-02-30"
});

export function searchInputSchema(now: Date) {
  const today = Date.parse(`${now.toISOString().slice(0, 10)}T00:00:00.000Z`);
  return z
    .object({
      destinationId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
      checkin: isoDate,
      checkout: isoDate,
      adults: z.number().int().min(1).max(8),
      childAges: z.array(z.number().int().min(0).max(17)).max(6),
    })
    .strict()
    .superRefine((value, ctx) => {
      const checkin = Date.parse(`${value.checkin}T00:00:00.000Z`);
      const checkout = Date.parse(`${value.checkout}T00:00:00.000Z`);
      const nights = (checkout - checkin) / DAY_MS;
      if (checkin < today || checkin > today + MAX_DAYS_AHEAD * DAY_MS) ctx.addIssue({ code: "custom", message: "check-in out of range", path: ["checkin"] });
      if (!(nights >= 1 && nights <= MAX_NIGHTS)) ctx.addIssue({ code: "custom", message: "1 to 28 nights", path: ["checkout"] });
    });
}

export type SearchInput = z.infer<ReturnType<typeof searchInputSchema>>;
