import { db } from "@/server/db";
import type {
  AvailabilityQuery,
  ContentSource,
  Offer,
  PriceCheckResult,
  PropertyContent,
  PropertyOffers,
  SupplierAdapter,
} from "./types";

// A supplier with made-up hotels' rates and content, for development and the browser tests
// only (never staging or production: see ./index.ts). It answers the same way every time for
// the same hotel and dates, and covers what the screens must show: a refundable and a
// non-refundable rate, a choice of bed types, and fees paid at the property in local currency.
// It never books: price check (plan 3) throws.

const DAY_MS = 86_400_000;

function seed(id: string): number {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) % 9_973;
  return h;
}

function nightsOf(q: AvailabilityQuery): number {
  return Math.round((Date.parse(`${q.checkout}T00:00:00Z`) - Date.parse(`${q.checkin}T00:00:00Z`)) / DAY_MS);
}

function offer(propertyId: string, n: number, nights: number, checkin: string, kind: 0 | 1 | 2): Offer {
  const nightly = 9_000 + (seed(propertyId) % 40) * 500 + kind * 2_500; // cents
  const room = nightly * nights;
  const taxes = Math.floor(room / 8);
  const usd = (minor: number) => ({ minor, currency: "USD" });
  const refundable = kind !== 0;
  const freeUntil = new Date(Date.parse(`${checkin}T00:00:00Z`) - 3 * DAY_MS).toISOString().slice(0, 10);
  return {
    propertyId,
    roomId: `room-${kind}`,
    roomName: ["Standard Double Room", "Superior King Room", "Family Suite"][kind]!,
    rateId: `rate-${n}-${kind}`,
    refundable,
    bedGroups:
      kind === 1
        ? [
            { id: "bg-king", description: "1 King Bed", priceCheckToken: `fake-${propertyId}-${kind}-king` },
            { id: "bg-twin", description: "2 Twin Beds", priceCheckToken: `fake-${propertyId}-${kind}-twin` },
          ]
        : [{ id: "bg-1", description: kind === 0 ? "1 Double Bed" : "1 King Bed and 1 Sofa Bed", priceCheckToken: `fake-${propertyId}-${kind}` }],
    cancelPenalties: refundable
      ? [{ start: `${freeUntil}T00:00:00.000+02:00`, end: `${checkin}T23:59:00.000+02:00`, amount: usd(nightly), nights: null, percent: null }]
      : [],
    nonrefundableDateRanges: [],
    price: {
      total: usd(room + taxes),
      lines: [
        { kind: "room_rate", amount: usd(room) },
        { kind: "taxes_and_fees", amount: usd(taxes) },
      ],
      dueAtProperty:
        kind === 2 ? [{ kind: "resort_fee", amount: usd(2_000 * nights), localAmount: { minor: 1_850 * nights, currency: "EUR" } }] : [],
      dueAtPropertyTotal: kind === 2 ? usd(2_000 * nights) : null,
      nights,
    },
  };
}

export class FakeSupplierAdapter implements SupplierAdapter {
  async searchAvailability(query: AvailabilityQuery): Promise<PropertyOffers[]> {
    const nights = nightsOf(query);
    return query.propertyIds.map((propertyId, n) => ({
      propertyId,
      offers: ([0, 1, 2] as const).map((kind) => offer(propertyId, n, nights, query.checkin, kind)),
    }));
  }

  async priceCheck(): Promise<PriceCheckResult> {
    throw new Error("The fake supplier does not price-check or book");
  }
}

export class FakeContentSource implements ContentSource {
  async listRegions(): Promise<never> {
    throw new Error("The fake supplier has no regions sync");
  }
  async catalogLink(): Promise<never> {
    throw new Error("The fake supplier has no catalog");
  }
  async inactiveSince(): Promise<{ propertyIds: string[]; next: null }> {
    return { propertyIds: [], next: null };
  }

  async propertyContent(ids: string[]): Promise<PropertyContent[]> {
    const rows = await db.property.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, city: true, countryCode: true, starRating: true } });
    return rows.map((p) => ({
      propertyId: p.id,
      name: p.name,
      address: { line1: "1 Example Street", city: p.city, stateProvince: null, postalCode: null, countryCode: p.countryCode },
      starRating: p.starRating?.toString() ?? null,
      coordinates: null,
      heroImage: null,
      images: [],
      amenities: ["Free WiFi", "Swimming pool", "24-hour front desk"],
      checkin: {
        beginTime: "3:00 PM",
        endTime: "midnight",
        instructions: "<p>Extra-person charges may apply.</p><ul><li>Government-issued photo identification is required at check-in.</li></ul>",
        specialInstructions: "Front desk staff will greet guests on arrival.",
        minAge: 18,
      },
      checkout: { time: "11:00 AM" },
      fees: { mandatory: "<p>Resort fee: EUR 18.50 per night.</p>", optional: "<p>Breakfast: EUR 15 per person.</p>" },
      knowBeforeYouGo: "<ul><li>No pets allowed.</li><li>Quiet hours from 10 PM.</li></ul>",
      description: `${p.name} is a sample hotel used for testing.`, // plain text: the page never renders supplier HTML
      onsiteCurrency: "EUR",
      rooms: [],
    }));
  }
}
