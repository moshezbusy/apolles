import type { QuoteListItem } from "@/server/quotes/quotes";

// Shared parts of the quote screens (14, 15).

const STATUS: Record<QuoteListItem["status"], { label: string; className: string }> = {
  DRAFT: { label: "Draft", className: "bg-[#f1efe9] text-[#5f6863]" },
  SENT: { label: "Sent", className: "bg-[#eaf1f7] text-[#2f5f86]" },
  VIEWED: { label: "Viewed", className: "bg-[#fff6dc] text-[#8a6a10]" },
  SELECTED: { label: "Option selected", className: "bg-brand-soft text-brand" },
  BOOKED: { label: "Booked", className: "bg-brand-soft text-brand" },
};

export function StatusPill({ status }: { status: QuoteListItem["status"] }) {
  const s = STATUS[status];
  return (
    <span className={`inline-flex w-fit items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold ${s.className}`}>
      <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" />
      {s.label}
    </span>
  );
}

export function guestsText(adults: number, childAges: number[]): string {
  const parts = [`${adults} ${adults === 1 ? "adult" : "adults"}`];
  if (childAges.length) parts.push(`${childAges.length} ${childAges.length === 1 ? "child" : "children"}`);
  return parts.join(" · ");
}
