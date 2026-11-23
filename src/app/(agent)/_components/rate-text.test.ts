import { describe, expect, it } from "vitest";
import type { Offer } from "@/server/supplier/types";
import { cancellationLabel, penaltyText, propertyTime } from "./rate-text";

const base: Offer = {
  propertyId: "1",
  roomId: "r",
  roomName: "Room",
  rateId: "x",
  refundable: true,
  bedGroups: [],
  cancelPenalties: [],
  nonrefundableDateRanges: [],
    amenities: [],
  price: { total: { minor: 1, currency: "USD" }, lines: [], dueAtProperty: [], dueAtPropertyTotal: null, nights: 1 },
  roomPrices: [{ total: { minor: 1, currency: "USD" }, lines: [], dueAtProperty: [], dueAtPropertyTotal: null, nights: 1 }],
};

describe("rate wording", () => {
  it("shows the property's local time as given, never converted", () => {
    expect(propertyTime("2027-04-07T00:00:00.000+02:00")).toBe("Apr 7, 2027, 00:00 (UTC+02:00)");
    expect(propertyTime("2027-12-31T23:59:00-05:00")).toBe("Dec 31, 2027, 23:59 (UTC-05:00)");
    expect(propertyTime("something else")).toBe("something else");
  });

  it("each penalty says when and how much", () => {
    expect(penaltyText({ start: "2027-04-07T00:00:00+02:00", end: "2027-04-10T00:00:00+02:00", amount: { minor: 12_345, currency: "USD" }, nights: null, percent: null })).toBe(
      "From Apr 7, 2027, 00:00 (UTC+02:00) to Apr 10, 2027, 00:00 (UTC+02:00): cancellation charge USD 123.45.",
    );
    expect(penaltyText({ start: "2027-04-07T00:00:00Z", end: "2027-04-10T00:00:00Z", amount: null, nights: 1, percent: null })).toContain("1 night");
    expect(penaltyText({ start: "2027-04-07T00:00:00Z", end: "2027-04-10T00:00:00Z", amount: null, nights: null, percent: "50%" })).toContain("50% of the total");
  });

  const NOW = new Date("2027-03-01T10:00:00.000Z");
  const penalties = [
    { start: "2027-04-09T00:00:00+02:00", end: "2027-04-10T00:00:00+02:00", amount: null, nights: 1, percent: null },
    { start: "2027-04-07T00:00:00+02:00", end: "2027-04-09T00:00:00+02:00", amount: null, nights: 1, percent: null },
  ];

  it("labels: non-refundable, or free cancellation until the earliest charge, in one wording", () => {
    expect(cancellationLabel({ ...base, refundable: false }, NOW)).toEqual({ refundable: false, kind: "non_refundable", text: "Non-refundable" });
    expect(cancellationLabel({ ...base, cancelPenalties: penalties }, NOW)).toEqual({
      refundable: true,
      kind: "free",
      text: "Free cancellation until Wed, Apr 7, 2027, 00:00 hotel time",
    });
  });

  it("never claims free cancellation the supplier did not give", () => {
    // Refundable with no charge listed: no deadline was named.
    expect(cancellationLabel(base, NOW)).toEqual({ refundable: false, kind: "unknown", text: "Cancellation charges may apply" });
    // Nights that cannot be refunded.
    expect(cancellationLabel({ ...base, cancelPenalties: penalties, nonrefundableDateRanges: [{ start: "2027-04-10", end: "2027-04-11" }] }, NOW)).toEqual({
      refundable: false,
      kind: "charges",
      text: "Cancellation charges apply",
    });
    // The deadline is already over.
    expect(cancellationLabel({ ...base, cancelPenalties: penalties }, new Date("2027-04-08T00:00:00Z")).text).toBe("Cancellation charges apply");
    // Not refundable with a charge of part of the price: charges apply, not "non-refundable".
    const part = [{ start: "2027-03-01T00:00:00+02:00", end: "2027-04-10T00:00:00+02:00", amount: null, nights: null, percent: "50%" }];
    expect(cancellationLabel({ ...base, refundable: false, cancelPenalties: part }, NOW).text).toBe("Cancellation charges apply");
  });
});
