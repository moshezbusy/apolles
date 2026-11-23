import { describe, expect, it } from "vitest";
import { feesAtProperty, sumBreakdowns } from "./price";
import type { PriceBreakdown } from "./types";

const usd = (minor: number) => ({ minor, currency: "USD" });

function part(room: number, taxes: number, fee: number | null): PriceBreakdown {
  return {
    total: usd(room + taxes),
    lines: [
      { kind: "room_rate", amount: usd(room) },
      { kind: "taxes_and_fees", amount: usd(taxes) },
    ],
    dueAtProperty: fee === null ? [] : [{ kind: "resort_fee", amount: usd(fee), localAmount: { minor: fee - 100, currency: "EUR" } }],
    dueAtPropertyTotal: fee === null ? null : usd(fee),
    nights: 2,
  };
}

describe("sumBreakdowns", () => {
  it("adds the totals and the lines by kind", () => {
    const sum = sumBreakdowns([part(10000, 1500, 2000), part(12000, 1800, 1000)]);
    expect(sum.total).toEqual(usd(25300));
    expect(sum.lines).toEqual([
      { kind: "room_rate", amount: usd(22000) },
      { kind: "taxes_and_fees", amount: usd(3300) },
    ]);
    expect(sum.dueAtProperty).toEqual([{ kind: "resort_fee", amount: usd(3000), localAmount: { minor: 2800, currency: "EUR" } }]);
    expect(sum.dueAtPropertyTotal).toEqual(usd(3000));
    expect(sum.nights).toBe(2);
  });

  it("one part gives that part back unchanged", () => {
    const one = part(10000, 1500, 2000);
    expect(sumBreakdowns([one])).toEqual(one);
  });

  it("a line kind only one room has is still added", () => {
    const a = part(10000, 1500, null);
    const b = { ...part(12000, 1800, null), lines: [...part(12000, 1800, null).lines, { kind: "extra_person_fee" as const, amount: usd(500) }] };
    b.total = usd(14300);
    expect(sumBreakdowns([a, b]).lines).toEqual([
      { kind: "room_rate", amount: usd(22000) },
      { kind: "taxes_and_fees", amount: usd(3300) },
      { kind: "extra_person_fee", amount: usd(500) },
    ]);
  });

  it("different nights throws", () => {
    expect(() => sumBreakdowns([part(10000, 1500, null), { ...part(12000, 1800, null), nights: 3 }])).toThrow(/nights/);
  });

  it("a part without a total due at the property gives no total due at the property", () => {
    expect(sumBreakdowns([part(10000, 1500, 2000), part(12000, 1800, null)]).dueAtPropertyTotal).toBeNull();
  });

  it("the local amount of a fee is kept only when every room has one in the same currency", () => {
    const a = part(10000, 1500, 2000);
    const noLocal = part(12000, 1800, 1000);
    noLocal.dueAtProperty = [{ kind: "resort_fee", amount: usd(1000), localAmount: null }];
    expect(sumBreakdowns([a, noLocal]).dueAtProperty).toEqual([{ kind: "resort_fee", amount: usd(3000), localAmount: null }]);
    const otherCurrency = part(12000, 1800, 1000);
    otherCurrency.dueAtProperty = [{ kind: "resort_fee", amount: usd(1000), localAmount: { minor: 900, currency: "GBP" } }];
    expect(sumBreakdowns([a, otherCurrency]).dueAtProperty[0]!.localAmount).toBeNull();
  });

  it("a fee only some rooms have is added over the rooms that have it", () => {
    expect(sumBreakdowns([part(10000, 1500, 2000), part(12000, 1800, null)]).dueAtProperty).toEqual([
      { kind: "resort_fee", amount: usd(2000), localAmount: { minor: 1900, currency: "EUR" } },
    ]);
  });

  it("refuses no parts, mixed currencies and an overflow", () => {
    expect(() => sumBreakdowns([])).toThrow();
    const eur = part(10000, 1500, null);
    eur.total = { minor: 11500, currency: "EUR" };
    expect(() => sumBreakdowns([part(10000, 1500, null), eur])).toThrow(/currency/);
    const huge = part(Number.MAX_SAFE_INTEGER - 10, 0, null);
    expect(() => sumBreakdowns([huge, huge])).toThrow(/overflow/);
  });
});

describe("feesAtProperty", () => {
  const fee = (minor: number) => ({ kind: "resort_fee" as const, amount: usd(minor), localAmount: null });

  it("nothing listed and no total: nothing is due", () => {
    expect(feesAtProperty({ dueAtProperty: [], dueAtPropertyTotal: null })).toEqual({ due: false, total: null });
    expect(feesAtProperty({ dueAtProperty: [], dueAtPropertyTotal: usd(0) })).toEqual({ due: false, total: null });
  });

  it("only the supplier's total, with no single fee listed: fees are due, with that amount", () => {
    expect(feesAtProperty({ dueAtProperty: [], dueAtPropertyTotal: usd(2_500) })).toEqual({ due: true, total: usd(2_500) });
  });

  it("listed fees that add up to the total: the list is enough", () => {
    expect(feesAtProperty({ dueAtProperty: [fee(1_000), fee(1_500)], dueAtPropertyTotal: usd(2_500) })).toEqual({ due: true, total: null });
    expect(feesAtProperty({ dueAtProperty: [fee(1_000)], dueAtPropertyTotal: null })).toEqual({ due: true, total: null });
  });

  it("listed fees that do not add up to the total: the total is shown too", () => {
    expect(feesAtProperty({ dueAtProperty: [fee(1_000)], dueAtPropertyTotal: usd(2_500) })).toEqual({ due: true, total: usd(2_500) });
  });
});
