import { handleAssistantCall } from "@/server/assistant/api-route";

// The rates of one hotel of an assistant's search (search only). See src/server/assistant/api-route.ts.
export async function POST(request: Request): Promise<Response> {
  return handleAssistantCall(request, "rates");
}
