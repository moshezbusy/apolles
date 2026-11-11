import { formatMinor, type Money } from "@/lib/supplier-money";
import type { CancelPenalty, DueAtProperty, Offer, PriceLineKind } from "@/server/supplier/types";

// Wording for the hotel page (screen 09). Amounts are shown exactly as the supplier gave them.

export const LINE_LABEL: Record<PriceLineKind, string> = {
  room_rate: "Room",
  extra_person_fee: "Extra person fee",
  taxes_and_fees: "Taxes and fees",
  taxes: "Taxes",
  discount: "Discount",
  service_fee: "Service fee",
};

export const DUE_LABEL: Record<DueAtProperty["kind"], string> = {
  mandatory_fee: "Mandatory fee",
  resort_fee: "Resort fee",
  mandatory_tax: "Mandatory tax",
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// "2027-04-07T00:00:00.000+02:00" → "Apr 7, 2027, 00:00 (UTC+02:00)": the property's local time,
// as Expedia gives it, never converted to another time zone.
export function propertyTime(value: string): string {
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?(Z|[+-]\d{2}:\d{2})?$/);
  if (!m) return value;
  const [, y, mo, d, h, mi, zone] = m;
  const offset = !zone || zone === "Z" ? "UTC" : `UTC${zone}`;
  return `${MONTHS[Number(mo) - 1] ?? mo} ${Number(d)}, ${y}, ${h}:${mi} (${offset})`;
}

export function money(m: Money): string {
  return formatMinor(m.minor, m.currency);
}

export function penaltyText(p: CancelPenalty): string {
  const charge = p.amount ? money(p.amount) : p.percent ? `${p.percent} of the total` : p.nights !== null ? `${p.nights} ${p.nights === 1 ? "night" : "nights"}` : "a fee";
  return `From ${propertyTime(p.start)} to ${propertyTime(p.end)}: cancellation charge ${charge}.`;
}

// The short label next to the price (AP2): "Non-refundable", or free cancellation until the
// first charge starts.
export function cancellationLabel(offer: Offer): { refundable: boolean; text: string } {
  if (!offer.refundable) return { refundable: false, text: "Non-refundable" };
  const first = [...offer.cancelPenalties].sort((a, b) => a.start.localeCompare(b.start))[0];
  return { refundable: true, text: first ? `Free cancellation until ${propertyTime(first.start)}` : "Free cancellation" };
}
