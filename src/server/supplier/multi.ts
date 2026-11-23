import { freeCancelDeadline } from "@/lib/cancellation";
import type { AvailabilityQuery, Offer, PriceCheckRef, PriceCheckResult, PropertyOffers, SupplierAdapter, SupplierContext } from "./types";

// More than one supplier in one search (owner decision 2026-11-23: Expedia plus Hotelbeds). The
// main supplier (Expedia, or the fake) and the extra one are asked for the same batch at the
// same time, and their offers are merged per hotel:
// - For the same room type, board and refundability, the agent sees one price: the cheapest. A
//   tie keeps the main supplier's offer. Offers of one supplier alone are kept as they are (the
//   main supplier's results never change because a second supplier is on).
// - Room types are matched by their name, normalised (case, accents, punctuation, word order and
//   the word "room" do not count); boards by the words of what the rate includes. Names that
//   still differ stay two rates.
// - The extra supplier never fails the search: if it fails or times out, the main supplier's
//   offers are shown alone. A failure of the main supplier fails the search, as before.
// Which supplier an offer came from stays on the offer (Offer.supplier), on the server only.

const STOP_WORDS = new Set(["room", "rooms", "the", "a", "an", "with", "and", "of"]);

export function roomTypeKey(name: string): string {
  const words = name
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((word) => word !== "" && !STOP_WORDS.has(word));
  return [...new Set(words)].sort().join(" ");
}

export function boardKey(amenities: string[]): string {
  const text = amenities.join(" ").toLowerCase();
  if (text.includes("all inclusive") || text.includes("all-inclusive")) return "AI";
  if (text.includes("full board")) return "FB";
  if (text.includes("half board")) return "HB";
  if (text.includes("breakfast")) return "BB";
  return "RO";
}

export function mergeKey(offer: Offer): string {
  return `${roomTypeKey(offer.roomName)}|${boardKey(offer.amenities)}|${freeCancelDeadline(offer) !== null ? "free" : "charged"}`;
}

// The offers of one hotel from every supplier, main supplier first: in each group of the same
// room type, board and refundability offered by more than one supplier, only the cheapest stays.
export function mergeOffers(main: Offer[], extra: Offer[]): Offer[] {
  const all = [...main, ...extra];
  const groups = new Map<string, Offer[]>();
  for (const offer of all) {
    const key = mergeKey(offer);
    groups.set(key, [...(groups.get(key) ?? []), offer]);
  }
  const dropped = new Set<Offer>();
  for (const group of groups.values()) {
    if (new Set(group.map((offer) => offer.supplier ?? "expedia")).size < 2) continue;
    // Strictly cheaper wins; on a tie the first (the main supplier's) stays.
    const winner = group.reduce((best, offer) => (offer.price.total.minor < best.price.total.minor ? offer : best));
    for (const offer of group) if (offer !== winner) dropped.add(offer);
  }
  return all.filter((offer) => !dropped.has(offer));
}

export class MultiSupplierAdapter implements SupplierAdapter {
  private readonly main: SupplierAdapter;
  private readonly extra: SupplierAdapter;

  constructor(main: SupplierAdapter, extra: SupplierAdapter) {
    this.main = main;
    this.extra = extra;
  }

  async searchAvailability(query: AvailabilityQuery, context: SupplierContext): Promise<PropertyOffers[]> {
    const [mainResults, extraResults] = await Promise.all([
      this.main.searchAvailability(query, context),
      this.extra.searchAvailability(query, context).catch((error: unknown) => {
        console.error(`second supplier search skipped: ${error instanceof Error ? error.name : "Error"}`);
        return [] as PropertyOffers[];
      }),
    ]);
    const extraById = new Map<string, Offer[]>();
    for (const property of extraResults) if (!extraById.has(property.propertyId)) extraById.set(property.propertyId, property.offers);
    const merged: PropertyOffers[] = mainResults.map((property) => {
      const extra = extraById.get(property.propertyId);
      extraById.delete(property.propertyId);
      return extra ? { propertyId: property.propertyId, offers: mergeOffers(property.offers, extra) } : property;
    });
    for (const [propertyId, offers] of extraById) merged.push({ propertyId, offers });
    return merged;
  }

  // Price checks of a booking go to the booking's own supplier (bookingSupplier); this one is
  // the main supplier's.
  priceCheck(ref: PriceCheckRef, context: SupplierContext): Promise<PriceCheckResult> {
    return this.main.priceCheck(ref, context);
  }
}
