// Reads a request body as text, at most `maxBytes`: a declared Content-Length over the limit is
// refused before anything is read, and the stream is cut off as soon as it passes the limit, so a
// large body never sits in memory. null: too large (the caller answers 413).
export async function readLimitedText(request: Request, maxBytes: number): Promise<string | null> {
  const declared = request.headers.get("content-length");
  if (declared !== null && !(/^\d{1,12}$/.test(declared) && Number(declared) <= maxBytes)) return null;
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}
