import { safeImageUrl } from "@/lib/supplier-image";
import type { SearchSummary } from "@/server/search/search";
import type { SearchFormValues } from "./form-state";

// Small pieces shared by the results (08) and hotel (09) pages.

// "2 nights, 2 adults, 1 child": what the price is for (SP1). Several rooms (plan 10) name the
// rooms, then the guests over all of them: "3 nights, 2 rooms, 4 adults, 1 child".
export function stayText(s: Pick<SearchSummary, "nights" | "rooms">): string {
  const adults = s.rooms.reduce((n, r) => n + r.adults, 0);
  const children = s.rooms.reduce((n, r) => n + r.childAges.length, 0);
  const parts = [`${s.nights} ${s.nights === 1 ? "night" : "nights"}`];
  if (s.rooms.length > 1) parts.push(`${s.rooms.length} rooms`);
  parts.push(guestsText(adults, children, ", "));
  return parts.join(", ");
}

// "4 adults, 1 child" (or with " · " between): the guests, children only when there are some.
export function guestsText(adults: number, children: number, separator: string): string {
  const parts = [`${adults} ${adults === 1 ? "adult" : "adults"}`];
  if (children > 0) parts.push(`${children} ${children === 1 ? "child" : "children"}`);
  return parts.join(separator);
}

// "Apr 10" in UTC (stay dates are calendar dates, not moments).
export function shortDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

export function formValuesOf(s: SearchSummary): SearchFormValues {
  return {
    destinationId: s.destinationId,
    destinationLabel: s.destinationLabel,
    propertyId: s.propertyId ?? "",
    checkin: s.checkin,
    checkout: s.checkout,
    rooms: s.rooms.map((r) => ({ adults: String(r.adults), childAges: r.childAges.map(String) })),
  };
}

// The star rating as given ("4.5" → four full stars and a half), with the number for screen readers.
export function Stars({ rating }: { rating: string | null }) {
  if (!rating) return null;
  const value = Number(rating);
  if (!Number.isFinite(value) || value <= 0) return null;
  const full = Math.floor(value);
  return (
    <span className="whitespace-nowrap text-[13px] tracking-[0.1em] text-[#b8902d]" aria-label={`${rating} stars`} title={`${rating} stars`}>
      <span aria-hidden="true">
        {"★".repeat(full)}
        {value > full ? "½" : ""}
      </span>
    </span>
  );
}

// A hotel photo from the supplier's image host only; a soft placeholder otherwise.
export function HotelPhoto({ url, alt, className }: { url: string | null | undefined; alt: string; className: string }) {
  const safe = safeImageUrl(url);
  if (!safe) return <div aria-hidden="true" className={`${className} bg-gradient-to-b from-[#a9c0c8] via-[#d7e1e1] to-[#b9a98f]`} />;
  // eslint-disable-next-line @next/next/no-img-element -- supplier images are not proxied through Next
  return <img src={safe} alt={alt} loading="lazy" referrerPolicy="no-referrer" className={`${className} object-cover`} />;
}
