import { Prisma } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { STATUS_LABEL, cell, decimal } from "@/server/booking/list";
import { bookingSale } from "@/server/booking/selling";
import { getBalance, listEntriesWithBalance } from "@/server/wallet/ledger";

// Reporting (screen 19, plan 6): the agency's own bookings of a period, by booking date (UTC),
// in USD. Sales use the agency's selling price (reports only, never charged); a booking without
// one counts its net, with no profit. Cancelled bookings count as no sale. Every sum is done in
// SQL, scoped by agencyId, over the (agencyId, createdAt) index.

export type ReportRange = "month" | "7d" | "last_month" | "year" | "custom";
export type Period = { range: ReportRange; from: string; to: string; prevFrom: string; prevTo: string };

const DAY = 86_400_000;
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const MAX_DAYS = 366;

function iso(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}
function ms(day: string): number {
  return Date.parse(`${day}T00:00:00.000Z`);
}
function realDay(day: string | undefined): day is string {
  return !!day && ISO.test(day) && iso(ms(day)) === day;
}

// The period asked for; anything wrong falls back to this month. Calendar periods compare with the
// calendar period before; 7 days and a custom range with the same number of days before.
export function reportPeriod(q: { range?: string | undefined; from?: string | undefined; to?: string | undefined }, now: Date = new Date()): Period {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const today = iso(now.getTime());
  const month = (year: number, mon: number) => ({ from: iso(Date.UTC(year, mon, 1)), to: iso(Date.UTC(year, mon + 1, 1) - DAY) });
  const sameLength = (from: string, to: string) => {
    const days = (ms(to) - ms(from)) / DAY + 1;
    return { prevFrom: iso(ms(from) - days * DAY), prevTo: iso(ms(from) - DAY) };
  };
  switch (q.range) {
    case "7d": {
      const from = iso(ms(today) - 6 * DAY);
      return { range: "7d", from, to: today, ...sameLength(from, today) };
    }
    case "last_month": {
      const cur = month(y, m - 1);
      const prev = month(y, m - 2);
      return { range: "last_month", ...cur, prevFrom: prev.from, prevTo: prev.to };
    }
    case "year":
      return { range: "year", from: `${y}-01-01`, to: `${y}-12-31`, prevFrom: `${y - 1}-01-01`, prevTo: `${y - 1}-12-31` };
    case "custom":
      if (realDay(q.from) && realDay(q.to) && q.from <= q.to && (ms(q.to) - ms(q.from)) / DAY + 1 <= MAX_DAYS) {
        return { range: "custom", from: q.from, to: q.to, ...sameLength(q.from, q.to) };
      }
      break;
  }
  const cur = month(y, m);
  const prev = month(y, m - 1);
  return { range: "month", ...cur, prevFrom: prev.from, prevTo: prev.to };
}

export type Report = {
  totals: {
    bookings: number;
    grossSalesMinor: number;
    paidMinor: number;
    profitMinor: number;
    marginBp: number;
    withoutPriceCount: number;
    previousGrossSalesMinor: number;
    changeBp: number | null;
  };
  status: { vouchered: number; pending: number; inStay: number; completed: number; cancelled: number };
  metrics: { avgValueMinor: number; avgProfitMinor: number; marginBp: number; cancellationRateBp: number };
  weekly: { start: string; salesMinor: number; profitMinor: number }[];
  balance: { balanceCents: number; topupsCents: number; topupCount: number; refundsCents: number; refundCount: number };
  ledger: { id: string; createdAt: Date; type: string; reason: string; bookingRef: string | null; amountCents: number; balanceAfterCents: number }[];
  topDestinations: { name: string; bookings: number; salesMinor: number; profitMinor: number }[];
  topHotels: { name: string; bookings: number; salesMinor: number; profitMinor: number }[];
  recent: { id: string; reference: string; hotelName: string; leadName: string; status: string; saleMinor: number; profitMinor: number }[];
};

// Bookings of the period (not drafts, expired or failed): the net (the charge) and the sale per row.
function periodRows(agencyId: string, from: string, to: string): Prisma.Sql {
  return Prisma.sql`
    SELECT b.*,
      CASE WHEN b.mt IS NULL THEN b.net
           WHEN b.mt = 'FIXED' THEN b.net + b.mv
           ELSE b.net + (b.net * b.mv + 5000) / 10000 END AS sale
    FROM (
      SELECT "status"::text AS status, "checkin", "checkout", "hotelName", "hotelCity", "propertyId", "createdAt",
        COALESCE("chargedMinor", "totalMinor")::bigint AS net,
        "sellMarkupType"::text AS mt, "sellMarkupValue"::bigint AS mv
      FROM "Booking"
      WHERE "agencyId" = ${agencyId}
        AND "createdAt" >= ${new Date(ms(from))} AND "createdAt" < ${new Date(ms(to) + DAY)}
        AND "status" NOT IN ('DRAFT', 'EXPIRED', 'FAILED')
    ) b`;
}

const LIVE = Prisma.sql`status NOT IN ('CANCELLED', 'CANCELLED_BY_SUPPLIER')`;

type Totals = { bookings: bigint; sales: bigint | null; paid: bigint | null; profit: bigint | null; unpriced: bigint; live: bigint; cancelled: bigint };

async function totals(agencyId: string, from: string, to: string): Promise<Totals> {
  const [row] = await db.$queryRaw<Totals[]>`
    WITH r AS (${periodRows(agencyId, from, to)})
    SELECT count(*) AS bookings,
      sum(sale) FILTER (WHERE ${LIVE}) AS sales,
      sum(net) FILTER (WHERE ${LIVE}) AS paid,
      sum(sale - net) FILTER (WHERE ${LIVE}) AS profit,
      count(*) FILTER (WHERE ${LIVE} AND mt IS NULL) AS unpriced,
      count(*) FILTER (WHERE ${LIVE}) AS live,
      count(*) FILTER (WHERE NOT (${LIVE})) AS cancelled
    FROM r`;
  return row!;
}

const num = (v: bigint | number | null | undefined) => Number(v ?? 0);
const ratioBp = (part: number, whole: number) => (whole > 0 ? Math.round((part * 10_000) / whole) : 0);

export async function agencyReport(agencyId: string, period: Period, now: Date = new Date()): Promise<Report> {
  const today = iso(now.getTime());
  const [cur, prev, statusRows, weeklyRows, cities, hotels, recentRows, balance, ledgerRows, history] = await Promise.all([
    totals(agencyId, period.from, period.to),
    totals(agencyId, period.prevFrom, period.prevTo),
    db.$queryRaw<{ vouchered: bigint; pending: bigint; in_stay: bigint; completed: bigint; cancelled: bigint }[]>`
      WITH r AS (${periodRows(agencyId, period.from, period.to)})
      SELECT count(*) FILTER (WHERE status = 'CONFIRMED' AND checkin > ${today}) AS vouchered,
        count(*) FILTER (WHERE status IN ('PENDING_CONFIRMATION', 'CANCEL_PENDING')) AS pending,
        count(*) FILTER (WHERE status = 'CONFIRMED' AND checkin <= ${today} AND checkout > ${today}) AS in_stay,
        count(*) FILTER (WHERE status = 'CONFIRMED' AND checkout <= ${today}) AS completed,
        count(*) FILTER (WHERE NOT (${LIVE})) AS cancelled
      FROM r`,
    db.$queryRaw<{ week: number; sales: bigint; profit: bigint }[]>`
      WITH r AS (${periodRows(agencyId, period.from, period.to)})
      SELECT floor(extract(epoch FROM ("createdAt" - ${new Date(ms(period.from))}::timestamp)) / 604800)::int AS week,
        sum(sale) AS sales, sum(sale - net) AS profit
      FROM r WHERE ${LIVE} GROUP BY 1 ORDER BY 1`,
    db.$queryRaw<{ name: string; bookings: bigint; sales: bigint; profit: bigint }[]>`
      WITH r AS (${periodRows(agencyId, period.from, period.to)})
      SELECT "hotelCity" AS name, count(*) AS bookings, sum(sale) AS sales, sum(sale - net) AS profit
      FROM r WHERE ${LIVE} GROUP BY "hotelCity" ORDER BY sales DESC, name ASC LIMIT 5`,
    db.$queryRaw<{ name: string; bookings: bigint; sales: bigint; profit: bigint }[]>`
      WITH r AS (${periodRows(agencyId, period.from, period.to)})
      SELECT min("hotelName") AS name, count(*) AS bookings, sum(sale) AS sales, sum(sale - net) AS profit
      FROM r WHERE ${LIVE} GROUP BY "propertyId" ORDER BY sales DESC, name ASC LIMIT 5`,
    db.booking.findMany({
      where: { agencyId, status: { notIn: ["DRAFT", "EXPIRED", "FAILED"] }, createdAt: { gte: new Date(ms(period.from)), lt: new Date(ms(period.to) + DAY) } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 5,
      select: { id: true, reference: true, hotelName: true, leadGivenName: true, leadFamilyName: true, status: true, totalMinor: true, chargedMinor: true, sellMarkupType: true, sellMarkupValue: true },
    }),
    getBalance(agencyId),
    db.$queryRaw<{ topups: bigint | null; topup_count: bigint; refunds: bigint | null; refund_count: bigint }[]>`
      SELECT sum("amountCents") FILTER (WHERE type = 'TOPUP_BANK') AS topups, count(*) FILTER (WHERE type = 'TOPUP_BANK') AS topup_count,
        sum("amountCents") FILTER (WHERE type = 'REFUND') AS refunds, count(*) FILTER (WHERE type = 'REFUND') AS refund_count
      FROM "LedgerEntry"
      WHERE "agencyId" = ${agencyId} AND "createdAt" >= ${new Date(ms(period.from))} AND "createdAt" < ${new Date(ms(period.to) + DAY)}`,
    listEntriesWithBalance(agencyId, undefined, 6),
  ]);

  const sales = num(cur.sales);
  const profit = num(cur.profit);
  const live = num(cur.live);
  const prevSales = num(prev.sales);
  const s = statusRows[0]!;
  const l = ledgerRows[0]!;
  const weeks = Math.ceil(((ms(period.to) - ms(period.from)) / DAY + 1) / 7);
  const byWeek = new Map(weeklyRows.map((w) => [w.week, w]));
  return {
    totals: {
      bookings: num(cur.bookings),
      grossSalesMinor: sales,
      paidMinor: num(cur.paid),
      profitMinor: profit,
      marginBp: ratioBp(profit, sales),
      withoutPriceCount: num(cur.unpriced),
      previousGrossSalesMinor: prevSales,
      changeBp: prevSales > 0 ? Math.round(((sales - prevSales) * 10_000) / prevSales) : null,
    },
    status: { vouchered: num(s.vouchered), pending: num(s.pending), inStay: num(s.in_stay), completed: num(s.completed), cancelled: num(s.cancelled) },
    metrics: {
      avgValueMinor: live > 0 ? Math.round(sales / live) : 0,
      avgProfitMinor: live > 0 ? Math.round(profit / live) : 0,
      marginBp: ratioBp(profit, sales),
      cancellationRateBp: ratioBp(num(cur.cancelled), num(cur.bookings)),
    },
    weekly: Array.from({ length: weeks }, (_, i) => ({
      start: iso(ms(period.from) + i * 7 * DAY),
      salesMinor: num(byWeek.get(i)?.sales),
      profitMinor: num(byWeek.get(i)?.profit),
    })),
    balance: { balanceCents: balance.balanceCents, topupsCents: num(l.topups), topupCount: num(l.topup_count), refundsCents: num(l.refunds), refundCount: num(l.refund_count) },
    ledger: history.entries.map((e) => ({ id: e.id, createdAt: e.createdAt, type: e.type, reason: e.reason, bookingRef: e.bookingRef, amountCents: e.amountCents, balanceAfterCents: e.balanceAfterCents })),
    topDestinations: cities.map((c) => ({ name: c.name, bookings: num(c.bookings), salesMinor: num(c.sales), profitMinor: num(c.profit) })),
    topHotels: hotels.map((h) => ({ name: h.name, bookings: num(h.bookings), salesMinor: num(h.sales), profitMinor: num(h.profit) })),
    recent: recentRows.map((b) => {
      const sale = bookingSale(b);
      return { id: b.id, reference: b.reference, hotelName: b.hotelName, leadName: `${b.leadGivenName} ${b.leadFamilyName}`, status: b.status, saleMinor: sale.saleMinor, profitMinor: sale.profitMinor };
    }),
  };
}

const CSV_MAX_ROWS = 5_000;

// "Export CSV": the period's bookings with net, selling price and profit (USD).
export async function reportCsv(agencyId: string, period: Period): Promise<string> {
  const rows = await db.booking.findMany({
    where: { agencyId, status: { notIn: ["DRAFT", "EXPIRED", "FAILED"] }, createdAt: { gte: new Date(ms(period.from)), lt: new Date(ms(period.to) + DAY) } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: CSV_MAX_ROWS,
    select: { reference: true, createdAt: true, status: true, hotelName: true, hotelCity: true, leadGivenName: true, leadFamilyName: true, checkin: true, checkout: true, totalMinor: true, chargedMinor: true, sellMarkupType: true, sellMarkupValue: true },
  });
  const header = "Reference,Booked at (UTC),Status,Hotel,City,Lead guest,Check-in,Check-out,Net (USD),Selling price (USD),Profit (USD)";
  const lines = rows.map((r) => {
    const sale = bookingSale(r);
    return [
      r.reference,
      r.createdAt.toISOString().slice(0, 16).replace("T", " "),
      cell(STATUS_LABEL[r.status]),
      cell(r.hotelName),
      cell(r.hotelCity),
      cell(`${r.leadGivenName} ${r.leadFamilyName}`),
      r.checkin,
      r.checkout,
      decimal(sale.netMinor, "USD"),
      decimal(sale.saleMinor, "USD"),
      decimal(sale.profitMinor, "USD"),
    ].join(",");
  });
  return `${[header, ...lines].join("\r\n")}\r\n`;
}
