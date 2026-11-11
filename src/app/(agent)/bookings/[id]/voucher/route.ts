import { requireAgent } from "@/server/auth/guards";
import { VoucherNotAvailable, renderVoucher } from "@/server/booking/voucher";

// The voucher PDF of the agency's own confirmed booking (screen 12, "Voucher").
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
      "Content-Disposition": 'attachment; filename="apolles-voucher.pdf"',
      "Cache-Control": "no-store",
    },
  });
}
