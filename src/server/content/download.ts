import { Readable } from "node:stream";
import { createInterface } from "node:readline";
import { createGunzip } from "node:zlib";

// Downloads Expedia's gzipped JSONL catalog file and yields it one line at a time, without
// holding the whole file in memory. The link comes from Expedia, but it is still checked: https
// only, no IP literals or localhost, and no redirects (so the download cannot be pointed at an
// internal address). Expedia's Authorization header is never sent to the download host.

const DOWNLOAD_TIMEOUT_MS = 30 * 60_000;

function assertSafeUrl(href: string): URL {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    throw new Error("catalog link is not a valid URL");
  }
  const host = url.hostname.toLowerCase();
  const ipLiteral = /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(":") || host.startsWith("[");
  if (url.protocol !== "https:" || ipLiteral || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) {
    throw new Error("catalog link refused: must be https to a public host name");
  }
  return url;
}

export async function openCatalogStream(href: string): Promise<AsyncIterable<string>> {
  const url = assertSafeUrl(href);
  const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
  if (!response.ok || !response.body) throw new Error(`catalog download failed (HTTP ${response.status})`);
  const gunzip = Readable.fromWeb(response.body as import("node:stream/web").ReadableStream).pipe(createGunzip());
  const reader = createInterface({ input: gunzip, crlfDelay: Infinity });
  return (async function* () {
    for await (const line of reader) {
      if (line.trim()) yield line;
    }
  })();
}
