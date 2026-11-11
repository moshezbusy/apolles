// Supplier text (hotel descriptions, policies, fees) can contain HTML. It is never put into
// the page as HTML: this turns it into plain paragraphs and list items, which React escapes.
// Script and style content is dropped, every tag is removed, and the common entities are
// decoded. Whatever is left can only ever be shown as text.

export type TextBlock = { kind: "p" | "li"; text: string };

const MAX_CHARS = 20_000;

const NAMED: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function decode(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
    if (code[0] === "#") {
      const n = code[1] === "x" || code[1] === "X" ? Number.parseInt(code.slice(2), 16) : Number.parseInt(code.slice(1), 10);
      return Number.isInteger(n) && n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : "";
    }
    return NAMED[code.toLowerCase()] ?? whole;
  });
}

export function toBlocks(html: string | null | undefined): TextBlock[] {
  if (!html) return [];
  const marked = html
    .slice(0, MAX_CHARS * 2)
    .replace(/<(script|style)\b[\s\S]*?(<\/\1\s*>|$)/gi, " ")
    .replace(/<li\b[^>]*>/gi, "\n\u0001")
    .replace(/<\/?(p|div|br|ul|ol|li|h[1-6]|tr|table)\b[^>]*>/gi, "\n")
    .replace(/<[^>]*(>|$)/g, " ") // every other tag, closed or not
    .replace(/[<>]/g, " "); // a stray bracket left over
  const blocks: TextBlock[] = [];
  let total = 0;
  for (const raw of marked.split("\n")) {
    const isItem = raw.startsWith("\u0001");
    const text = decode(raw.replace("\u0001", "")).replace(/\s+/g, " ").trim();
    if (!text) continue;
    const room = MAX_CHARS - total;
    if (room <= 0) break;
    const kept = text.slice(0, room);
    total += kept.length;
    blocks.push({ kind: isItem ? "li" : "p", text: kept });
  }
  return blocks;
}
