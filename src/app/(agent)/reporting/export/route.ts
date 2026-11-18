import { requireAgent } from "@/server/auth/guards";
import { reportCsv, reportPeriod } from "@/server/reports";

// "Export CSV" (screen 19): the period's bookings of the session's agency, with sale and profit.
export async function GET(request: Request): Promise<Response> {
  const { agencyId } = await requireAgent();
  const url = new URL(request.url);
  const period = reportPeriod({
    range: url.searchParams.get("range")?.slice(0, 20) ?? undefined,
    from: url.searchParams.get("from")?.slice(0, 10) ?? undefined,
    to: url.searchParams.get("to")?.slice(0, 10) ?? undefined,
  });
  const csv = await reportCsv(agencyId, period);
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="apolles-report-${period.from}-to-${period.to}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
