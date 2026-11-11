import { requireAgent } from "@/server/auth/guards";
import { BOOKING_TABS, bookingsCsv, type BookingTab } from "@/server/booking/list";

// CSV of the agency's bookings (screen 13), with the same tab and search as the list.
export async function GET(request: Request): Promise<Response> {
  const { agencyId } = await requireAgent();
  const url = new URL(request.url);
  const rawTab = url.searchParams.get("tab");
  const tab: BookingTab = BOOKING_TABS.includes(rawTab as BookingTab) ? (rawTab as BookingTab) : "all";
  const q = url.searchParams.get("q")?.slice(0, 100);
  const csv = await bookingsCsv(agencyId, { tab, ...(q ? { q } : {}) });
  const day = new Date().toISOString().slice(0, 10);
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="apolles-bookings-${day}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
