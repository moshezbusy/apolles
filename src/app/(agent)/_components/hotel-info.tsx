import { card, sectionTitle } from "@/components/ui";
import { toBlocks } from "@/lib/supplier-text";
import type { CancelPenalty, PriceBreakdown, PropertyContent } from "@/server/supplier/types";
import { DUE_LABEL, LINE_LABEL, money, penaltyText } from "./rate-text";

// Hotel and rate details shared by the hotel page (09), review & book (11) and the booking
// summary (12), so each shows the policies and prices the same way. Supplier text is always
// shown as plain text (toBlocks), never as HTML.

// Supplier text, shown as plain paragraphs and list items (never as HTML).
export function SupplierText({ html }: { html: string | null | undefined }) {
  const blocks = toBlocks(html);
  if (blocks.length === 0) return null;
  const items = blocks.filter((b) => b.kind === "li");
  return (
    <div className="flex flex-col gap-1.5 text-[13.5px] leading-relaxed text-[#37413d]">
      {blocks
        .filter((b) => b.kind === "p")
        .map((b, i) => (
          <p key={`p${i}`}>{b.text}</p>
        ))}
      {items.length > 0 ? (
        <ul className="list-disc pl-5">
          {items.map((b, i) => (
            <li key={`li${i}`}>{b.text}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function Policies({ content }: { content: PropertyContent }) {
  const { checkin, checkout, fees } = content;
  const checkinTime = [checkin.beginTime, checkin.endTime].filter(Boolean).join(" to ");
  return (
    <section id="policies" aria-labelledby="policies-title" className={`${card} bg-white p-5`}>
      <h2 id="policies-title" className={sectionTitle}>
        Policies
      </h2>
      <dl className="mt-4 grid gap-5 md:grid-cols-2">
        <div>
          <dt className="text-sm font-bold text-ink">Check-in</dt>
          <dd className="mt-1 flex flex-col gap-1.5 text-[13.5px] text-[#37413d]">
            {checkinTime ? <p>From {checkinTime}</p> : null}
            {checkin.minAge ? <p>Minimum check-in age: {checkin.minAge}</p> : null}
            <SupplierText html={checkin.instructions} />
          </dd>
        </div>
        <div>
          <dt className="text-sm font-bold text-ink">Check-out</dt>
          <dd className="mt-1 text-[13.5px] text-[#37413d]">{checkout.time ? `By ${checkout.time}` : "See the hotel's instructions"}</dd>
        </div>
        {checkin.specialInstructions ? (
          <div>
            <dt className="text-sm font-bold text-ink">Special instructions</dt>
            <dd className="mt-1">
              <SupplierText html={checkin.specialInstructions} />
            </dd>
          </div>
        ) : null}
        {fees.mandatory || fees.optional ? (
          <div>
            <dt className="text-sm font-bold text-ink">Fees</dt>
            <dd className="mt-1 flex flex-col gap-2">
              <SupplierText html={fees.mandatory} />
              <SupplierText html={fees.optional} />
            </dd>
          </div>
        ) : null}
        {content.knowBeforeYouGo ? (
          <div className="md:col-span-2">
            <dt className="text-sm font-bold text-ink">Know before you go</dt>
            <dd className="mt-1">
              <SupplierText html={content.knowBeforeYouGo} />
            </dd>
          </div>
        ) : null}
      </dl>
    </section>
  );
}


// The supplier's total and its lines (BP5), then anything paid at the property (BP4).
export function PriceDetails({ price, stay }: { price: PriceBreakdown; stay: string }) {
  return (
    <div>
      <p className="text-[20px] font-extrabold tabular-nums text-ink">{money(price.total)}</p>
      <p className="text-xs text-muted">Total for {stay}</p>
      <dl className="mt-2 flex flex-col gap-0.5 text-xs text-[#37413d]">
        {price.lines.map((line) => (
          <div key={line.kind} className="flex justify-between gap-3">
            <dt>{LINE_LABEL[line.kind]}</dt>
            <dd className="tabular-nums">{money(line.amount)}</dd>
          </div>
        ))}
      </dl>
      {price.dueAtProperty.length > 0 ? (
        <div className="mt-2.5 rounded-[9px] border border-[#eadfbe] bg-[#fff9e9] p-2 text-xs text-[#6f5a20]">
          <p className="font-bold">Paid at the property, not included in the total</p>
          <ul className="mt-1 flex flex-col gap-0.5">
            {price.dueAtProperty.map((fee, i) => (
              <li key={i}>
                {DUE_LABEL[fee.kind]}: {fee.localAmount ? `${money(fee.localAmount)} (about ${money(fee.amount)})` : money(fee.amount)}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

// The full cancellation policy (BP3), including non-refundable stay dates.
export function CancellationPolicy({ refundable, penalties, nonrefundableDateRanges }: { refundable: boolean; penalties: CancelPenalty[]; nonrefundableDateRanges: { start: string; end: string }[] }) {
  return (
    <ul className="flex flex-col gap-1 text-xs text-[#37413d]">
      {penalties.map((p, i) => (
        <li key={i}>{penaltyText(p)}</li>
      ))}
      {nonrefundableDateRanges.map((r, i) => (
        <li key={`n${i}`}>
          Non-refundable for stay dates {r.start} to {r.end}.
        </li>
      ))}
      {!refundable ? <li>This rate cannot be cancelled or changed without paying the full amount.</li> : null}
      {refundable && penalties.length === 0 ? <li>Free cancellation before check-in.</li> : null}
    </ul>
  );
}

