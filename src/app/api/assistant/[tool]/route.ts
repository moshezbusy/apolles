import { handleAssistantTool, handleTokenCheck } from "@/server/assistant/api";

// The assistant search API, for the MCP connector process only (src/server/assistant/api.ts):
// search_hotels, get_hotel_rates, and "check" (is this assistant token good?). It reads the
// assistant token from the Authorization header and never a cookie.
export async function POST(request: Request, { params }: { params: Promise<{ tool: string }> }): Promise<Response> {
  const { tool } = await params;
  return tool === "check" ? handleTokenCheck(request) : handleAssistantTool(tool, request);
}
