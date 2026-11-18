import { requireAgent } from "@/server/auth/guards";
import { VoucherNotAvailable, renderVoucher } from "@/server/booking/voucher";

// The voucher PDF of the agency's own confirmed booking (screen 12, "Voucher"). The agent gives
// it to the client, so its file name does not say Apolles (screen 23).
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { agencyId } = await requireAgent();
  const { id } = await params;
  let pdf: Buffer;
  try {
    pdf = await renderVoucher(agencyId, id);
  } catch (error) {
    if (error instanceof VoucherNotAvailable) return new Response("Not found", { status: 404 });
    throw error;
  }
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="hotel-voucher-${id.replace(/[^A-Za-z0-9]/g, "").slice(0, 40)}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
