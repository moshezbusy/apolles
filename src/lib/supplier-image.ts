// Hotel images are shown only from the supplier's image host, over https. Any other link
// (another host, a look-alike host, credentials in the URL, another scheme) is dropped, so a
// changed or tampered content row can never make an agent's browser load from elsewhere.

const IMAGE_HOSTS = new Set(["i.travelapi.com"]);

export function safeImageUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.port || !IMAGE_HOSTS.has(parsed.hostname)) return null;
  return parsed.toString();
}
