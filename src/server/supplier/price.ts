import type { Money } from "@/lib/supplier-money";
import type { DueAtProperty, PriceBreakdown, PriceLineKind } from "./types";

// Several rooms (plan 10): the price of the stay is the sum of the rooms' prices. Addition only,
// of the supplier's own amounts: no rounding, no conversion (BP5). Anything that does not add up
// cleanly (no rooms, different currencies or nights, an amount too large) throws: a price is
// never built from parts that disagree.

export class PriceSumInvalid extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PriceSumInvalid";
  }
}

function plus(a: Money, b: Money): Money {
  if (a.currency !== b.currency) throw new PriceSumInvalid(`cannot add ${a.currency} and ${b.currency}: currency differs`);
  const minor = a.minor + b.minor;
  if (!Number.isSafeInteger(minor)) throw new PriceSumInvalid("amount overflow");
  return { minor, currency: a.currency };
}

// Totals and lines are added by kind (kinds in the order they first appear). A fee paid at the
// property is added over the rooms that have it; its local amount is kept only when each of
// those rooms has one, in the same currency. The total due at the property is known only when
// every room has one. Nights come from the first room; every room must agree.
export function sumBreakdowns(parts: PriceBreakdown[]): PriceBreakdown {
  const [first, ...rest] = parts;
  if (!first) throw new PriceSumInvalid("no room prices to add");
  for (const part of rest) {
    if (part.nights !== first.nights) throw new PriceSumInvalid(`rooms disagree on nights (${first.nights} and ${part.nights})`);
  }

  let total = first.total;
  for (const part of rest) total = plus(total, part.total);

  const lines = new Map<PriceLineKind, Money>();
  for (const line of parts.flatMap((part) => part.lines)) {
    const sum = lines.get(line.kind);
    lines.set(line.kind, sum ? plus(sum, line.amount) : line.amount);
  }

  const fees = new Map<DueAtProperty["kind"], { amount: Money; localAmount: Money | null }>();
  for (const fee of parts.flatMap((part) => part.dueAtProperty)) {
    const sum = fees.get(fee.kind);
    if (!sum) {
      fees.set(fee.kind, { amount: fee.amount, localAmount: fee.localAmount });
      continue;
    }
    const sameLocal = sum.localAmount && fee.localAmount && sum.localAmount.currency === fee.localAmount.currency;
    fees.set(fee.kind, {
      amount: plus(sum.amount, fee.amount),
      localAmount: sameLocal ? plus(sum.localAmount!, fee.localAmount!) : null,
    });
  }

  let dueAtPropertyTotal: Money | null = first.dueAtPropertyTotal;
  for (const part of rest) {
    dueAtPropertyTotal = dueAtPropertyTotal && part.dueAtPropertyTotal ? plus(dueAtPropertyTotal, part.dueAtPropertyTotal) : null;
  }

  return {
    total,
    lines: [...lines].map(([kind, amount]) => ({ kind, amount })),
    dueAtProperty: [...fees].map(([kind, fee]) => ({ kind, ...fee })),
    dueAtPropertyTotal,
    nights: first.nights,
  };
}
