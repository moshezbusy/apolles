// Reads an uploaded image's real type and size from its first bytes. The file name and the
// browser's Content-Type are never trusted: a "logo.png" that is really SVG or HTML could
// carry script. Only PNG and JPEG are recognised; anything else, including a truncated or
// malformed header, gives null. Never throws, never reads past the end of the buffer.

export type ImageInfo = { type: "image/png" | "image/jpeg"; width: number; height: number };

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export function readImageInfo(bytes: Uint8Array): ImageInfo | null {
  if (startsWith(bytes, PNG_SIGNATURE)) return readPng(bytes);
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return readJpeg(bytes);
  return null;
}

function startsWith(bytes: Uint8Array, prefix: number[]): boolean {
  return bytes.length >= prefix.length && prefix.every((b, i) => bytes[i] === b);
}

function u16(bytes: Uint8Array, at: number): number {
  return ((bytes[at] ?? 0) << 8) | (bytes[at + 1] ?? 0);
}

function u32(bytes: Uint8Array, at: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(at);
}

// PNG: 8-byte signature, then the IHDR chunk first: length (13), "IHDR", width, height.
function readPng(bytes: Uint8Array): ImageInfo | null {
  if (bytes.length < 24) return null;
  const isIhdr = bytes[12] === 0x49 && bytes[13] === 0x48 && bytes[14] === 0x44 && bytes[15] === 0x52;
  if (!isIhdr) return null;
  const width = u32(bytes, 16);
  const height = u32(bytes, 20);
  return width > 0 && height > 0 ? { type: "image/png", width, height } : null;
}

// JPEG: walk the segments after SOI (FF D8) until a start-of-frame marker, which holds the
// height and width. Markers without a length (RSTn, TEM) are skipped; SOS or EOI before a
// frame header means there is no size to read.
const SOF_MARKERS = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

function readJpeg(bytes: Uint8Array): ImageInfo | null {
  let at = 2;
  while (at + 4 <= bytes.length) {
    if (bytes[at] !== 0xff) return null;
    const marker = bytes[at + 1] ?? 0;
    if (marker === 0xff) {
      at += 1; // fill byte
      continue;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      at += 2;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) return null; // EOI or SOS before any frame header
    const length = u16(bytes, at + 2);
    if (length < 2 || at + 2 + length > bytes.length) return null;
    if (SOF_MARKERS.has(marker)) {
      if (length < 7) return null;
      const height = u16(bytes, at + 5);
      const width = u16(bytes, at + 7);
      return width > 0 && height > 0 ? { type: "image/jpeg", width, height } : null;
    }
    at += 2 + length;
  }
  return null;
}
