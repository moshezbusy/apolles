/**
 * Cancellation deadlines from suppliers.
 *
 * Many suppliers send a deadline as hotel local time with no UTC offset
 * ("12-05-2027 00:00:00"), and we do not know the hotel's time zone here.
 * Reading it as UTC shows a deadline that is LATER than the real one for
 * every hotel east of UTC: an agent could cancel "in time" and still be
 * charged.
 *
 * So an offset-less deadline is moved to the earliest moment that calendar
 * day can begin anywhere on earth: 00:00 in UTC+14. That is never later
 * than the real deadline, whatever the hotel's zone and whatever time of
 * day the supplier meant. The price is that free cancellation appears to
 * end up to about a day early.
 */

/** The earliest time zone on earth is UTC+14 (Line Islands). */
const EARLIEST_ZONE_HOURS = 14;

const HAS_OFFSET = /(?:[zZ]|[+-]\d{2}(?::?\d{2})?)$/;

/** Start of the given calendar day (YYYY-MM-DD) in UTC+14, as an ISO instant. Undefined if it is not a real date. */
export function earliestStartOfLocalDay(isoDate: string): string | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return undefined;
  const t = Date.parse(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(t) || new Date(t).toISOString().slice(0, 10) !== isoDate) return undefined; // 2027-02-30
  return new Date(t - EARLIEST_ZONE_HOURS * 3_600_000).toISOString();
}

/**
 * ISO date or date-time -> the instant to show as the deadline. With an
 * offset: exactly that instant. Without: see the note at the top.
 */
export function conservativeDeadline(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const s = value.trim();
  const m = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)(.*))?$/.exec(s);
  if (!m) return undefined;
  const [, day, time, rest = ''] = m;
  if (time && HAS_OFFSET.test(rest)) {
    const t = Date.parse(`${day}T${time}${rest.replace(/^([+-]\d{2})(\d{2})$/, '$1:$2')}`);
    return Number.isNaN(t) ? undefined : new Date(t).toISOString();
  }
  if (rest !== '') return undefined; // trailing text we do not understand
  if (time && Number.isNaN(Date.parse(`${day}T${time}Z`))) return undefined;
  return earliestStartOfLocalDay(day!);
}
