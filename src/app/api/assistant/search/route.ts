import { handleAssistantCall } from "@/server/assistant/api-route";

// Hotel search for AI assistants (search only). See src/server/assistant/api-route.ts.
export async function POST(request: Request): Promise<Response> {
  return handleAssistantCall(request, "search");
}
