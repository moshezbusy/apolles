import { requireAgent } from "@/server/auth/guards";
import { DOCUMENT_HEADERS, PdfTimeout, documentUnavailable, hitDocumentLimit, tooManyDocuments } from "@/server/booking/pdf-safety";
import { VoucherNotAvailable, renderVoucher } from "@/server/booking/voucher";

// The voucher PDF of the agency's own confirmed booking (screen 12, "Voucher"). The agent gives
// it to the client, so its file name does not say Apolles (screen 23). Limited per agency
// (making a PDF is not free), and a PDF that cannot be finished fails with a clear answer.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { agencyId } = await requireAgent();
  const { id } = await params;
  const limit = await hitDocumentLimit("voucher", agencyId);
  if (!limit.allowed) return tooManyDocuments(limit.retryAfterMs);
  let pdf: Buffer;
  try {
    pdf = await renderVoucher(agencyId, id);
  } catch (error) {
    if (error instanceof VoucherNotAvailable) return new Response("Not found", { status: 404, headers: DOCUMENT_HEADERS });
    if (error instanceof PdfTimeout) {
      console.error("voucher PDF timed out", { bookingId: id.slice(0, 64) });
      return documentUnavailable();
    }
    throw error;
  }
  return new Response(new Uint8Array(pdf), {
    headers: {
      ...DOCUMENT_HEADERS,
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="hotel-voucher-${id.replace(/[^A-Za-z0-9]/g, "").slice(0, 40)}.pdf"`,
    },
  });
}
