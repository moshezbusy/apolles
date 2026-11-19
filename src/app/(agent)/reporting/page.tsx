import type { Metadata } from "next";
import { DateField } from "@/components/date-picker/DateField";
import Link from "next/link";
import { btnPrimary, btnSecondary, card, cell, link, pageTitle, table, tableWrap, tbody, td, th, thead, tr } from "@/components/ui";
import { formatUsd } from "@/lib/money";
import { requireAgent } from "@/server/auth/guards";
import { STATUS_LABEL } from "@/server/booking/list";
import {
  type Period,
  type Report,
  agencyReport,
  reportPeriod,
} from "@/server/reports";
import { TYPE_LABEL } from "../balance/labels";

export const metadata: Metadata = {
  title: "Reporting | Apolles",
  robots: { index: false, follow: false },
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const RANGES = [
  { id: "month", label: "This month" },
  { id: "7d", label: "Last 7 days" },
  { id: "last_month", label: "Last month" },
  { id: "year", label: "This year" },
] as const;

function one(v: string | string[] | undefined): string | undefined {
  return (Array.isArray(v) ? v[0] : v)?.slice(0, 20);
}
function percent(bp: number): string {
  return `${(bp / 100).toFixed(1)}%`;
}
function query(p: Period): string {
  return p.range === "custom"
    ? `range=custom&from=${p.from}&to=${p.to}`
    : `range=${p.range}`;
}
const shortDay = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});
const fullDay = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});
function day(iso: string): string {
  return shortDay.format(new Date(`${iso}T00:00:00Z`));
}

// Screen 19: the agency's bookings, sales, profit and balance activity for a period. Sales and
// profit use the agency's own selling prices (reports only). Everything is the session agency's.
export default async function ReportingPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { agencyId } = await requireAgent();
  const q = await searchParams;
  const period = reportPeriod({
    range: one(q.range),
    from: one(q.from),
    to: one(q.to),
  });
  const r = await agencyReport(agencyId, period);
  const t = r.totals;

  return (
    <main className="mx-auto flex w-[min(1260px,calc(100%-40px))] flex-col gap-6 pb-16 pt-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className={pageTitle}>Reporting</h1>
          <p className="mt-1 text-[13px] text-muted">
            Track bookings, sales, profit and balance activity.{" "}
            {day(period.from)} to{" "}
            {fullDay.format(new Date(`${period.to}T00:00:00Z`))}.
          </p>
        </div>
        <a href={`/reporting/export?${query(period)}`} className={btnSecondary}>
          Export CSV
        </a>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <nav aria-label="Period" className="flex flex-wrap gap-1">
          {RANGES.map((range) => (
            <Link
              key={range.id}
              href={`/reporting?range=${range.id}`}
              aria-current={period.range === range.id ? "page" : undefined}
              className={`rounded-full border px-3 py-1.5 text-[13px] font-semibold ${period.range === range.id ? "border-brand bg-brand text-paper" : "border-line bg-white text-[#4d5a54] hover:border-brand"}`}
            >
              {range.label}
            </Link>
          ))}
        </nav>
        <form
          method="get"
          action="/reporting"
          className="flex flex-wrap items-end gap-2"
        >
          <input type="hidden" name="range" value="custom" />
          <DateField name="from" label="From" defaultValue={period.range === "custom" ? period.from : ""} />
          <DateField name="to" label="To" defaultValue={period.range === "custom" ? period.to : ""} />
          <button
            type="submit"
            className={period.range === "custom" ? btnPrimary : btnSecondary}
          >
            Custom range
          </button>
        </form>
      </div>

      <section
        aria-label="Totals"
        className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"
      >
        <Kpi
          title="Gross sales"
          value={formatUsd(t.grossSalesMinor)}
          note={
            t.changeBp === null
              ? "No sales in the period before"
              : `${t.changeBp >= 0 ? "+" : ""}${percent(t.changeBp)} vs the same days before`
          }
        />
        <Kpi
          title="Paid from balance"
          value={formatUsd(t.paidMinor)}
          note="Confirmed bookings and cancellation charges"
        />
        <Kpi
          title="Your profit"
          value={formatUsd(t.profitMinor)}
          note={`${percent(t.marginBp)} average margin`}
          extra={
            t.withoutPriceCount > 0 ? (
              <Link href="/bookings" className={`${link} text-xs`}>
                {t.withoutPriceCount}{" "}
                {t.withoutPriceCount === 1 ? "booking" : "bookings"} without a
                selling price →
              </Link>
            ) : null
          }
        />
        <Kpi
          title="Bookings"
          value={String(t.bookings)}
          note={`${r.status.vouchered} upcoming · ${r.status.pending} pending · ${r.status.inStay} in stay · ${r.status.completed} completed · ${r.status.cancelled} cancelled`}
        />
      </section>

      <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
        <section
          aria-labelledby="sales-title"
          className={`${card} bg-white p-5`}
        >
          <h2 id="sales-title" className="text-base font-bold text-ink">
            Sales performance
          </h2>
          <p className="text-xs text-muted">Sales and profit by week</p>
          <WeeklyChart weekly={r.weekly} />
        </section>
        <section
          aria-labelledby="metrics-title"
          className={`${card} bg-white p-5`}
        >
          <h2 id="metrics-title" className="text-base font-bold text-ink">
            Booking performance
          </h2>
          <dl className="mt-3 grid grid-cols-2 gap-3 text-[13px]">
            <Metric
              label="Average booking value"
              value={formatUsd(r.metrics.avgValueMinor)}
            />
            <Metric
              label="Average profit per booking"
              value={formatUsd(r.metrics.avgProfitMinor)}
            />
            <Metric
              label="Average margin"
              value={percent(r.metrics.marginBp)}
            />
            <Metric
              label="Cancellation rate"
              value={percent(r.metrics.cancellationRateBp)}
            />
          </dl>
          <h3 className="mt-5 text-sm font-bold text-ink">Booking status</h3>
          <ul className="mt-2 flex flex-col gap-1.5 text-[13px]">
            {(
              [
                ["Confirmed, upcoming", r.status.vouchered],
                ["Pending", r.status.pending],
                ["In stay", r.status.inStay],
                ["Completed", r.status.completed],
                ["Cancelled", r.status.cancelled],
              ] as const
            ).map(([name, count]) => (
              <li key={name} className="flex justify-between">
                <span className="text-[#37413d]">{name}</span>
                <strong className="tabular-nums">{count}</strong>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <BalanceActivity r={r} />

      <div className="grid gap-4 lg:grid-cols-2">
        <TopTable
          title="Top destinations"
          sub="Highest-performing destinations by sales"
          first="Destination"
          rows={r.topDestinations}
        />
        <TopTable
          title="Top hotels"
          sub="Hotels with the most sales"
          first="Hotel"
          rows={r.topHotels}
        />
      </div>

      <section aria-labelledby="recent-title">
        <h2 id="recent-title" className="text-base font-bold text-ink">
          Recent booking performance
        </h2>
        <p className="mb-3 text-xs text-muted">
          Latest bookings of the period and their profit
        </p>
        {r.recent.length === 0 ? (
          <p className={`${card} p-5 text-sm text-muted`}>
            No bookings in this period.
          </p>
        ) : (
          <div className={tableWrap}>
            <table className={table}>
              <thead className={thead}>
                <tr>
                  <th className={th}>Booking</th>
                  <th className={`${th} text-right`}>Sale</th>
                  <th className={`${th} text-right`}>Profit</th>
                  <th className={th}>Status</th>
                </tr>
              </thead>
              <tbody className={tbody}>
                {r.recent.map((b) => (
                  <tr key={b.id} className={tr}>
                    <td data-label="Booking" className={td}>
                      <Link href={`/bookings/${b.id}`} className={link}>
                        {b.hotelName}
                      </Link>
                      <span className="block text-xs text-muted">
                        {b.reference} · {b.leadName}
                      </span>
                    </td>
                    <td data-label="Sale" className={`${cell} text-right tabular-nums`}>
                      {formatUsd(b.saleMinor)}
                    </td>
                    <td data-label="Profit" className={`${cell} text-right tabular-nums`}>
                      {formatUsd(b.profitMinor)}
                    </td>
                    <td data-label="Status" className={td}>
                      {STATUS_LABEL[b.status as keyof typeof STATUS_LABEL] ??
                        b.status}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <p className="text-xs text-muted">
        Sales and profit use your own selling prices, for your reports only. A
        booking without a selling price counts its net price, with no profit.
        Cancelled bookings count no sale.
      </p>
    </main>
  );
}

function Kpi({
  title,
  value,
  note,
  extra,
}: {
  title: string;
  value: string;
  note: string;
  extra?: React.ReactNode;
}) {
  return (
    <div className={`${card} bg-white p-5`}>
      <p className="text-xs font-semibold text-muted">{title}</p>
      <p className="mt-1 text-[26px] font-bold tabular-nums text-ink">
        {value}
      </p>
      <p className="text-xs text-muted">{note}</p>
      {extra ? <div className="mt-1">{extra}</div> : null}
    </div>
  );
}

function Metric({ label: name, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[12px] bg-[#f7f5f0] p-3">
      <dt className="text-xs text-muted">{name}</dt>
      <dd className="text-[17px] font-bold tabular-nums text-ink">{value}</dd>
    </div>
  );
}

// Plain SVG bars (no chart package): sales and profit per week, with the week's start date.
function WeeklyChart({ weekly }: { weekly: Report["weekly"] }) {
  const max = Math.max(1, ...weekly.map((w) => w.salesMinor));
  const W = 640;
  const H = 200;
  const slot = W / Math.max(1, weekly.length);
  const bar = Math.min(28, slot / 3);
  return (
    <div className="mt-3">
      <div className="mb-2 flex gap-4 text-xs text-muted">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-brand" /> Sales
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-gold" /> Profit
        </span>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H + 24}`}
        role="img"
        aria-label="Sales and profit by week"
        className="h-auto w-full"
      >
        <line x1="0" y1={H} x2={W} y2={H} stroke="#e1e6e3" />
        {weekly.map((w, i) => {
          const x = i * slot + slot / 2;
          const hs = (w.salesMinor / max) * (H - 10);
          const hp = (Math.max(0, w.profitMinor) / max) * (H - 10);
          return (
            <g key={w.start}>
              <title>{`Week of ${day(w.start)}: sales ${formatUsd(w.salesMinor)}, profit ${formatUsd(w.profitMinor)}`}</title>
              <rect
                x={x - bar - 2}
                y={H - hs}
                width={bar}
                height={hs}
                rx="3"
                className="fill-brand"
              />
              <rect
                x={x + 2}
                y={H - hp}
                width={bar}
                height={hp}
                rx="3"
                className="fill-gold"
              />
              <text
                x={x}
                y={H + 16}
                textAnchor="middle"
                className="fill-[#8a938e] text-[11px]"
              >
                {day(w.start)}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function BalanceActivity({ r }: { r: Report }) {
  return (
    <section
      aria-labelledby="activity-title"
      className={`${card} bg-white p-5`}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 id="activity-title" className="text-base font-bold text-ink">
            Balance activity
          </h2>
          <p className="text-xs text-muted">
            Top-ups, bookings paid and refunds from cancellations
          </p>
        </div>
        <Link href="/balance" className={link}>
          View all activity
        </Link>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <Metric
          label="Current balance"
          value={formatUsd(r.balance.balanceCents)}
        />
        <Metric
          label={`Top-ups in the period (${r.balance.topupCount} bank ${r.balance.topupCount === 1 ? "transfer" : "transfers"})`}
          value={formatUsd(r.balance.topupsCents)}
        />
        <Metric
          label={`Refunds in the period (${r.balance.refundCount})`}
          value={formatUsd(r.balance.refundsCents)}
        />
      </div>
      {r.ledger.length > 0 ? (
        <div className={`${tableWrap} mt-4`}>
          <table className={table}>
            <thead className={thead}>
              <tr>
                <th className={th}>Date</th>
                <th className={th}>Activity</th>
                <th className={th}>Reference</th>
                <th className={`${th} text-right`}>Amount</th>
                <th className={`${th} text-right`}>Balance after</th>
              </tr>
            </thead>
            <tbody className={tbody}>
              {r.ledger.map((e) => (
                <tr key={e.id} className={tr}>
                  <td data-label="Date"
                    className={`${cell} whitespace-nowrap text-[13px] text-muted`}
                  >
                    {fullDay.format(e.createdAt)}
                  </td>
                  <td data-label="Activity" className={td}>
                    {TYPE_LABEL[e.type as keyof typeof TYPE_LABEL] ?? e.type}
                  </td>
                  <td data-label="Reference" className={`${cell} font-mono text-xs`}>
                    {e.bookingRef ?? ""}
                  </td>
                  <td data-label="Amount"
                    className={`${cell} text-right tabular-nums ${e.amountCents > 0 ? "text-brand" : "text-ink"}`}
                  >
                    {e.amountCents > 0
                      ? `+${formatUsd(e.amountCents)}`
                      : formatUsd(e.amountCents)}
                  </td>
                  <td data-label="Balance after" className={`${td} text-right tabular-nums`}>
                    {formatUsd(e.balanceAfterCents)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      <p className="mt-3 text-xs text-muted">
        Refunds return to your balance once the hotel confirms the cancellation,
        minus any cancellation charge. Bank transfers are added once Apolles
        confirms them.
      </p>
    </section>
  );
}

function TopTable({
  title,
  sub,
  first,
  rows,
}: {
  title: string;
  sub: string;
  first: string;
  rows: Report["topHotels"];
}) {
  return (
    <section className={`${card} min-w-0 bg-white p-5`}>
      <h2 className="text-base font-bold text-ink">{title}</h2>
      <p className="mb-3 text-xs text-muted">{sub}</p>
      {rows.length === 0 ? (
        <p className="text-sm text-muted">No bookings in this period.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className={table}>
            <thead className={thead}>
              <tr>
                <th className={th}>{first}</th>
                <th className={`${th} text-right`}>Bookings</th>
                <th className={`${th} text-right`}>Sales</th>
                <th className={`${th} text-right`}>Profit</th>
              </tr>
            </thead>
            <tbody className={tbody}>
              {rows.map((row) => (
                <tr key={row.name} className={tr}>
                  <td data-label="" className={td}>{row.name}</td>
                  <td data-label="Bookings" className={`${cell} text-right tabular-nums`}>
                    {row.bookings}
                  </td>
                  <td data-label="Sales" className={`${cell} text-right tabular-nums`}>
                    {formatUsd(row.salesMinor)}
                  </td>
                  <td data-label="Profit" className={`${cell} text-right tabular-nums`}>
                    {formatUsd(row.profitMinor)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
