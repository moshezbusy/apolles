import { PassThrough, Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGunzip } from "node:zlib";

// Downloads Expedia's gzipped JSONL catalog file and yields it one line at a time, without
// holding the whole file in memory. The link comes from Expedia, but it is still checked: https
// only, no IP literals or localhost, and no redirects (so the download cannot be pointed at an
// internal address). Expedia's Authorization header is never sent to the download host.

const DOWNLOAD_TIMEOUT_MS = 30 * 60_000;
const MAX_LINE_CHARS = 2_000_000; // one hotel is a few kB; a longer "line" is a broken file

function assertSafeUrl(href: string): URL {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    throw new Error("catalog link is not a valid URL");
  }
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  const ipLiteral = /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(":") || host.startsWith("[");
  if (url.protocol !== "https:" || ipLiteral || !host.includes(".") || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) {
    throw new Error("catalog link refused: must be https to a public host name");
  }
  return url;
}

export async function openCatalogStream(href: string): Promise<AsyncIterable<string>> {
  const url = assertSafeUrl(href);
  const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
  if (!response.ok || !response.body) throw new Error(`catalog download failed (HTTP ${response.status})`);
  const gunzip = createGunzip();
  const out = new PassThrough();
  // pipeline passes an error from any stage (the network, gunzip) on to `out`, and the reader
  // below rethrows it: a broken download is an error for the caller, never an unhandled crash.
  pipeline(Readable.fromWeb(response.body as import("node:stream/web").ReadableStream), gunzip, out).catch((error: unknown) => {
    out.destroy(error instanceof Error ? error : new Error("catalog download failed"));
  });
  return (async function* () {
    const decoder = new TextDecoder();
    let pending = "";
    for await (const chunk of out) {
      pending += decoder.decode(chunk as Buffer, { stream: true });
      let newline = pending.indexOf("\n");
      while (newline !== -1) {
        const line = pending.slice(0, newline).replace(/\r$/, "");
        pending = pending.slice(newline + 1);
        if (line.trim()) yield line;
        newline = pending.indexOf("\n");
      }
      if (pending.length > MAX_LINE_CHARS) {
        out.destroy();
        throw new Error("catalog file refused: a line is longer than the limit");
      }
    }
    pending += decoder.decode();
    if (pending.length > MAX_LINE_CHARS) throw new Error("catalog file refused: a line is longer than the limit");
    if (pending.trim()) yield pending;
  })();
}
