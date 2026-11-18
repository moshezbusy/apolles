import { requireAgent } from "@/server/auth/guards";
import { StatementNotAvailable, renderStatement } from "@/server/booking/statement";

// The booking statement PDF of the agency's own paid booking (mockup 22; not a tax invoice).
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { agencyId } = await requireAgent();
  const { id } = await params;
  let pdf: Buffer;
  try {
    pdf = await renderStatement(agencyId, id);
  } catch (error) {
    if (error instanceof StatementNotAvailable) return new Response("Not found", { status: 404 });
    throw error;
  }
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="statement-${id.replace(/[^A-Za-z0-9]/g, "").slice(0, 40)}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
