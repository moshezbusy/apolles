// Supplier layer answers for the adapter's tests, written by hand from the layer's README and its
// src/core/types.ts (branch claude/brave-goldberg-v7adee): RateOffer, SearchResult, Quote,
// BookingAnswer. Made-up hotels, prices, references and guests. Test-only (no network).

export const LAYER_HOTEL = "59"; // a key of the layer's config/mappings/hotelbeds.json
export const OFFER_ID = "6f1c2a9e-4b7d-4c1e-9a55-0d2f7c3b8e11";
export const QUOTE_ID = "0b8d4e2f-7a61-4f3a-8c2d-5e9a1b7c6d20";
export const REFERENCE = "APL-K7M2Q9XP";

type Money = { minor: number; currency: string };

export function rateOffer(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    offerId: OFFER_ID,
    supplierId: "hotelbeds",
    environment: "test",
    hotelId: LAYER_HOTEL,
    supplierHotelCode: "377201",
    ratePlanCode: "20270410|20270412|W|1|377201|DBL.ST|ID_B2B_26|BB||1~2~0||N@06~~2557c~-1",
    ratePlanName: "Bed and breakfast",
    rooms: [{ occupancyIndex: 0, supplierRoomCode: "DBL.ST", roomName: "Double Standard" }],
    board: "BB",
    boardRaw: "BB",
    total: { minor: 24_680, currency: "USD" },
    taxesIncluded: true,
    paymentModel: "PREPAID",
    cancellation: {
      refundable: true,
      penalties: [
        { from: "2027-04-08T23:59:00+02:00", amount: { minor: 12_340, currency: "USD" } },
        { from: "2027-04-09T23:59:00+02:00", amount: { minor: 24_680, currency: "USD" } },
      ],
    },
    checkIn: "2027-04-10",
    checkOut: "2027-04-12",
    occupancy: [{ adults: 2, childrenAges: [] }],
    supplierData: { rateKey: "kept-by-the-layer", rateType: "BOOKABLE" },
    ...over,
  };
}

export function searchAnswer(offers: unknown[]): Record<string, unknown> {
  return {
    offers,
    suppliers: [{ supplierId: "hotelbeds", ok: true, offers: offers.length, durationMs: 840, unmappedHotels: 0 }],
    unmappedHotelIds: [],
  };
}

export function quoteAnswer(over: Record<string, unknown> = {}, offer: Record<string, unknown> = rateOffer()): Record<string, unknown> {
  return {
    quoteId: QUOTE_ID,
    environment: "test",
    offer,
    searchedTotal: offer.total as Money,
    priceChanged: false,
    cancellationChanged: false,
    expiresAt: "2027-03-01T10:10:00.000Z",
    ...over,
  };
}

export function bookingAnswer(over: Record<string, unknown> = {}): Record<string, unknown> {
  const status = (over.status as string | undefined) ?? "CONFIRMED";
  return {
    clientReference: REFERENCE,
    supplierId: "hotelbeds",
    environment: "test",
    hotelId: LAYER_HOTEL,
    status,
    quoteId: QUOTE_ID,
    approvedTotal: { minor: 24_680, currency: "USD" },
    offer: rateOffer(),
    total: { minor: 24_680, currency: "USD" },
    holder: { firstName: "Dana", lastName: "Levi", email: "dana@example.com", phone: "+972 501234567" },
    guests: [[{ firstName: "Dana", lastName: "Levi", type: "ADULT" }, { firstName: "Avi", lastName: "Levi", type: "ADULT" }]],
    paymentType: "AGENCY_CREDIT",
    supplierBookingRef: "102-4455667",
    hotelConfirmationNumber: "HC-88123",
    reconcileAttempts: 0,
    createdAt: "2027-03-01T10:02:00.000Z",
    updatedAt: "2027-03-01T10:02:03.000Z",
    history: [{ at: "2027-03-01T10:02:00.000Z", status: "PENDING", note: "sent to supplier" }],
    booked: status === "CONFIRMED",
    ...over,
  };
}
