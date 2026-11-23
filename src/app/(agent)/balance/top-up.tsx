import { alertInfo, card } from "@/components/ui";
import { supportContact } from "@/server/app-info";
import { getBankDetails } from "@/server/bank-details";

// "Top up by bank transfer": one wording for the balance page and the settings tab "Balance &
// top-ups". Apolles' bank account (from the environment), the agency's own reference, and what
// happens next. When the account is not set up yet it says so, and whom to ask, instead of an
// empty box.
export function TopUpByBankTransfer({ reference }: { reference: string | null }) {
  const details = getBankDetails();
  const support = supportContact();
  return (
    <section id="bank-transfer" aria-labelledby="bank-transfer-label" className={`${card} p-6`}>
      <h2 id="bank-transfer-label" className="text-base font-bold text-ink">
        Top up by bank transfer
      </h2>
      <p className="mb-4 mt-1 text-[13px] text-muted">Transfer USD to the account below. The amount is added to your balance once Apolles confirms the transfer, usually within 1 to 3 business days. No fees from Apolles.</p>
      {details.length > 0 ? (
        <dl className="grid grid-cols-[max-content_1fr] gap-x-8 gap-y-2 text-sm">
          {details.map((detail) => (
            <div key={detail.label} className="contents">
              <dt className="text-muted">{detail.label}</dt>
              <dd className="font-mono text-ink">{detail.value}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p role="status" className={alertInfo}>
          The bank details for top-ups are not set up yet. Contact Apolles support{support.email ? ` at ${support.email}` : ""} to top up your balance.
        </p>
      )}
      {reference ? (
        <p className="mt-4 rounded-[9px] border border-[#d3e3da] bg-brand-soft px-3 py-2.5 text-sm font-semibold text-brand">
          Your reference: <span className="font-mono">{reference}</span>
        </p>
      ) : null}
      <p className="mt-3 text-[13px] text-muted">Always write your reference so we can match the transfer to your agency. Unused balance can be returned to your bank account on request: contact Apolles support.</p>
    </section>
  );
}
