import { requireAgent } from "@/server/auth/guards";
import { DOCUMENT_HEADERS, PdfTimeout, documentUnavailable, hitDocumentLimit, tooManyDocuments } from "@/server/booking/pdf-safety";
import { StatementNotAvailable, renderStatement } from "@/server/booking/statement";

// The booking statement PDF of the agency's own paid booking (mockup 22; not a tax invoice).
// Limited per agency, like the voucher.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { agencyId } = await requireAgent();
  const { id } = await params;
  const limit = await hitDocumentLimit("statement", agencyId);
  if (!limit.allowed) return tooManyDocuments(limit.retryAfterMs);
  let pdf: Buffer;
  try {
    pdf = await renderStatement(agencyId, id);
  } catch (error) {
    if (error instanceof StatementNotAvailable) return new Response("Not found", { status: 404, headers: DOCUMENT_HEADERS });
    if (error instanceof PdfTimeout) {
      console.error("statement PDF timed out", { bookingId: id.slice(0, 64) });
      return documentUnavailable();
    }
    throw error;
  }
  return new Response(new Uint8Array(pdf), {
    headers: {
      ...DOCUMENT_HEADERS,
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="statement-${id.replace(/[^A-Za-z0-9]/g, "").slice(0, 40)}.pdf"`,
    },
  });
}
