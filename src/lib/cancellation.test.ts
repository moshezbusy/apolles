import { describe, expect, it } from "vitest";
import { cancellationSummary, freeCancelDeadline, freeCancellation, hotelDateTime } from "./cancellation";

const NOW = new Date("2027-03-01T10:00:00.000Z");
const penalty = (start: string, extra: { amount?: { minor: number; currency: string } | null; nights?: number | null; percent?: string | null } = {}) => ({
  start,
  end: "2027-04-10T00:00:00+02:00",
  amount: null,
  nights: 1,
  percent: null,
  ...extra,
});
const total = { minor: 50_000, currency: "USD" };

describe("free cancellation: one rule for the label, the stored rate and the filter", () => {
  it("is promised only with a penalty schedule, no non-refundable dates and a first charge still ahead", () => {
    const terms = { refundable: true, cancelPenalties: [penalty("2027-04-09T00:00:00+02:00"), penalty("2027-04-07T00:00:00+02:00")], nonrefundableDateRanges: [] };
    expect(freeCancelDeadline(terms)).toEqual({ at: new Date("2027-04-06T22:00:00.000Z"), start: "2027-04-07T00:00:00+02:00" });
    expect(freeCancellation(terms, NOW)?.start).toBe("2027-04-07T00:00:00+02:00");
    expect(cancellationSummary(terms, NOW)).toEqual({ kind: "free", text: "Free cancellation until Wed, Apr 7, 2027, 00:00 hotel time" });
  });

  it("a deadline that already passed is not free cancellation (also at the very moment it ends)", () => {
    const terms = { refundable: true, cancelPenalties: [penalty("2027-03-01T12:00:00+02:00")], nonrefundableDateRanges: [] };
    expect(freeCancelDeadline(terms)).not.toBeNull();
    expect(freeCancellation(terms, NOW)).toBeNull();
    expect(cancellationSummary(terms, NOW)).toEqual({ kind: "charges", text: "Cancellation charges apply" });
    expect(freeCancellation(terms, new Date("2027-03-01T09:59:59.000Z"))).not.toBeNull();
  });

  it("nights that cannot be refunded mean no free cancellation promise", () => {
    const terms = { refundable: true, cancelPenalties: [penalty("2027-04-07T00:00:00+02:00")], nonrefundableDateRanges: [{ start: "2027-04-10", end: "2027-04-11" }] };
    expect(freeCancelDeadline(terms)).toBeNull();
    expect(cancellationSummary(terms, NOW)).toEqual({ kind: "charges", text: "Cancellation charges apply" });
  });

  it("refundable with no charge listed: the supplier named no deadline, so none is promised", () => {
    const terms = { refundable: true, cancelPenalties: [], nonrefundableDateRanges: [] };
    expect(freeCancelDeadline(terms)).toBeNull();
    expect(cancellationSummary(terms, NOW)).toEqual({ kind: "unknown", text: "Cancellation charges may apply" });
  });

  it("a date that cannot be read means no promise", () => {
    const terms = { refundable: true, cancelPenalties: [penalty("2027-04-07T00:00:00+02:00"), penalty("soon")], nonrefundableDateRanges: [] };
    expect(freeCancelDeadline(terms)).toBeNull();
    expect(cancellationSummary(terms, NOW).kind).toBe("charges");
  });

  it("not refundable: non-refundable when nothing or only full charges are listed, otherwise charges apply", () => {
    expect(cancellationSummary({ refundable: false, cancelPenalties: [] }, NOW)).toEqual({ kind: "non_refundable", text: "Non-refundable" });
    expect(cancellationSummary({ refundable: false, cancelPenalties: [penalty("2027-03-01T00:00:00+02:00", { nights: null, percent: "100%" })] }, NOW).kind).toBe("non_refundable");
    expect(cancellationSummary({ refundable: false, cancelPenalties: [penalty("2027-03-01T00:00:00+02:00", { nights: null, amount: total })], price: { total, nights: 2 } }, NOW).kind).toBe("non_refundable");
    expect(cancellationSummary({ refundable: false, cancelPenalties: [penalty("2027-03-01T00:00:00+02:00", { nights: 2 })], price: { total, nights: 2 } }, NOW).kind).toBe("non_refundable");
    // A part of the price: saying "non-refundable" next to "charge USD 100.00" would contradict.
    const partial = { refundable: false, cancelPenalties: [penalty("2027-03-01T00:00:00+02:00", { nights: null, amount: { minor: 10_000, currency: "USD" } })], price: { total, nights: 2 } };
    expect(cancellationSummary(partial, NOW)).toEqual({ kind: "charges", text: "Cancellation charges apply" });
    expect(cancellationSummary({ refundable: false, cancelPenalties: [penalty("2027-03-01T00:00:00+02:00", { nights: 1 })], price: { total, nights: 2 } }, NOW).kind).toBe("charges");
    // A future free period on a rate the supplier calls not refundable is never promised.
    expect(cancellationSummary({ refundable: false, cancelPenalties: [penalty("2027-04-07T00:00:00+02:00")] }, NOW).kind).toBe("charges");
  });
});

describe("hotelDateTime", () => {
  it("shows the hotel's own clock with the weekday, never converted", () => {
    expect(hotelDateTime("2027-04-07T00:00:00.000+02:00")).toBe("Wed, Apr 7, 2027, 00:00 hotel time");
    expect(hotelDateTime("2027-12-31T23:59:00-05:00")).toBe("Fri, Dec 31, 2027, 23:59 hotel time");
    expect(hotelDateTime("2028-02-29T18:00:00Z")).toBe("Tue, Feb 29, 2028, 18:00 hotel time");
    expect(hotelDateTime("2027-04-07T14:30+05:30")).toBe("Wed, Apr 7, 2027, 14:30 hotel time");
  });

  it("gives text it cannot read back as it is", () => {
    expect(hotelDateTime("something else")).toBe("something else");
    expect(hotelDateTime("2027-02-30T00:00:00Z")).toBe("2027-02-30T00:00:00Z");
  });
});
