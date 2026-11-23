import { crc32, inflateSync } from "node:zlib";

// Reads an uploaded image's real type and size from its first bytes. The file name and the
// browser's Content-Type are never trusted: a "logo.png" that is really SVG or HTML could
// carry script. Only PNG and JPEG are recognised; anything else, including a truncated or
// malformed header, gives null. Never throws, never reads past the end of the buffer.

//
// readImageInfo only looks at the header (enough to say "this is not an image" or "too small").
// validateImage checks the WHOLE file and is what decides whether a file may be stored or
// handed to the PDF library (see below).

export type ImageInfo = { type: "image/png" | "image/jpeg"; width: number; height: number };

// The pixel budget of validateImage: each side and the total. A logo is printed 150 points wide.
export const IMAGE_MAX_SIDE = 2_000;
export const IMAGE_MAX_PIXELS = 2_000_000;

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

// The full check, for a file that is about to be stored or drawn into a PDF. The PDF library
// (pdfkit) decodes a PNG with transparency in memory, inside a callback where an error can not
// be caught: a small file whose pixel stream inflates to hundreds of megabytes (a "zlib bomb")
// would exhaust the server, and a corrupt stream would leave the request hanging for good. So a
// file passes only when its whole structure is sound and its pixel data is exactly the size its
// header promises:
//   PNG:  every chunk's length and checksum, IHDR first, IEND last with nothing after it, a
//         colour type and bit depth the standard allows, not interlaced, not animated, within
//         the pixel budget; the IDAT stream is inflated with a hard cap at the expected size and
//         must come out at exactly that size, with a known filter type on every row.
//   JPEG: every segment up to the end marker (nothing after it), exactly one baseline, extended
//         or progressive frame header of 8-bit samples within the pixel budget, and a scan.
// Returns null for anything else. Never throws.
export function validateImage(bytes: Uint8Array): ImageInfo | null {
  try {
    if (startsWith(bytes, PNG_SIGNATURE)) return validatePng(bytes);
    if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return validateJpeg(bytes);
    return null;
  } catch {
    return null; // zlib refused the pixel stream (corrupt, cut short, or larger than the cap)
  }
}

function withinBudget(width: number, height: number): boolean {
  return width > 0 && height > 0 && width <= IMAGE_MAX_SIDE && height <= IMAGE_MAX_SIDE && width * height <= IMAGE_MAX_PIXELS;
}

// PNG colour type → samples per pixel, and the bit depths the standard allows for it.
const PNG_FORMATS: Record<number, { channels: number; depths: number[] }> = {
  0: { channels: 1, depths: [1, 2, 4, 8, 16] }, // greyscale
  2: { channels: 3, depths: [8, 16] }, // RGB
  3: { channels: 1, depths: [1, 2, 4, 8] }, // palette
  4: { channels: 2, depths: [8, 16] }, // greyscale + alpha
  6: { channels: 4, depths: [8, 16] }, // RGB + alpha
};
const PNG_ANIMATION_CHUNKS = new Set(["acTL", "fcTL", "fdAT"]);
const PNG_MAX_FILTER_TYPE = 4;

function validatePng(bytes: Uint8Array): ImageInfo | null {
  let header: { width: number; height: number; colorType: number; bitDepth: number; channels: number } | null = null;
  let paletteEntries: number | null = null;
  let hasTransparency = false;
  const idat: Uint8Array[] = [];
  let idatClosed = false;
  let ended = false;

  let at = PNG_SIGNATURE.length;
  while (at < bytes.length) {
    if (ended) return null; // bytes after IEND
    if (at + 12 > bytes.length) return null;
    const length = u32(bytes, at);
    if (length > bytes.length - at - 12) return null;
    const type = String.fromCharCode(bytes[at + 4]!, bytes[at + 5]!, bytes[at + 6]!, bytes[at + 7]!);
    if (!/^[A-Za-z]{4}$/.test(type)) return null;
    const data = bytes.subarray(at + 8, at + 8 + length);
    if (crc32(bytes.subarray(at + 4, at + 8 + length)) !== u32(bytes, at + 8 + length)) return null;
    at += 12 + length;

    if ((header === null) !== (type === "IHDR")) return null; // IHDR first, and only once
    if (idat.length > 0 && type !== "IDAT") idatClosed = true;

    if (type === "IHDR") {
      if (length !== 13) return null;
      const width = u32(data, 0);
      const height = u32(data, 4);
      const [bitDepth = 0, colorType = -1, compression, filter, interlace] = data.subarray(8);
      const format = PNG_FORMATS[colorType];
      if (!format || !format.depths.includes(bitDepth)) return null;
      if (compression !== 0 || filter !== 0 || interlace !== 0) return null; // interlaced: refused
      if (!withinBudget(width, height)) return null;
      header = { width, height, colorType, bitDepth, channels: format.channels };
    } else if (type === "PLTE") {
      if (paletteEntries !== null || idat.length > 0 || hasTransparency) return null;
      if (header!.colorType === 0 || header!.colorType === 4) return null;
      if (length === 0 || length % 3 !== 0 || length / 3 > 256) return null;
      if (header!.colorType === 3 && length / 3 > 2 ** header!.bitDepth) return null;
      paletteEntries = length / 3;
    } else if (type === "tRNS") {
      if (hasTransparency || idat.length > 0) return null;
      const colorType = header!.colorType;
      if (colorType === 3 ? paletteEntries === null || length === 0 || length > paletteEntries : length !== (colorType === 0 ? 2 : colorType === 2 ? 6 : -1)) return null;
      hasTransparency = true;
    } else if (type === "IDAT") {
      if (idatClosed) return null; // the pixel chunks must follow each other
      if (header!.colorType === 3 && paletteEntries === null) return null;
      idat.push(data);
    } else if (type === "IEND") {
      if (length !== 0) return null;
      ended = true;
    } else if (PNG_ANIMATION_CHUNKS.has(type)) {
      return null;
    } else if (type.charCodeAt(0) < 0x61) {
      return null; // a "critical" chunk (capital first letter) this check does not know
    }
  }
  if (!header || !ended || idat.length === 0) return null;

  const rowBytes = 1 + Math.ceil((header.width * header.channels * header.bitDepth) / 8);
  const expected = header.height * rowBytes;
  // maxOutputLength makes zlib stop (and throw) the moment the output would pass `expected`,
  // so a bomb costs at most `expected` bytes (16 MB at the pixel budget), never its full size.
  const pixels = inflateSync(idat.length === 1 ? idat[0]! : Buffer.concat(idat), { maxOutputLength: expected });
  if (pixels.length !== expected) return null;
  for (let row = 0; row < header.height; row += 1) {
    if (pixels[row * rowBytes]! > PNG_MAX_FILTER_TYPE) return null;
  }
  return { type: "image/png", width: header.width, height: header.height };
}

// Frame headers pdfkit can embed and every PDF reader can show: baseline, extended sequential
// and progressive (all Huffman). Lossless, differential and arithmetic-coded frames are refused.
const JPEG_ALLOWED_SOF = new Set([0xc0, 0xc1, 0xc2]);

function validateJpeg(bytes: Uint8Array): ImageInfo | null {
  let frame: { width: number; height: number } | null = null;
  let scans = 0;
  let at = 2;
  for (;;) {
    if (at + 2 > bytes.length || bytes[at] !== 0xff) return null; // cut short, or not a marker
    const marker = bytes[at + 1]!;
    if (marker === 0xff) {
      at += 1; // fill byte
      continue;
    }
    at += 2;
    if (marker === 0xd9) {
      // EOI: the end. Nothing may follow it.
      return frame && scans > 0 && at === bytes.length ? { type: "image/jpeg", ...frame } : null;
    }
    // Markers that carry no length are only valid inside a scan (RSTn) or at the start (SOI).
    if (marker === 0x00 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) return null;
    if (at + 2 > bytes.length) return null;
    const length = u16(bytes, at);
    if (length < 2 || at + length > bytes.length) return null;
    if (SOF_MARKERS.has(marker)) {
      if (frame || !JPEG_ALLOWED_SOF.has(marker)) return null;
      if (length < 8) return null;
      const precision = bytes[at + 2];
      const height = u16(bytes, at + 3);
      const width = u16(bytes, at + 5);
      const components = bytes[at + 7]!;
      if (precision !== 8 || ![1, 3, 4].includes(components) || length !== 8 + 3 * components) return null;
      if (!withinBudget(width, height)) return null;
      frame = { width, height };
    }
    at += length;
    if (marker === 0xda) {
      // SOS: compressed data follows, up to the next real marker. Inside it FF 00 is a data
      // byte and FF D0..D7 are restart markers.
      if (!frame) return null;
      scans += 1;
      for (;;) {
        const ff = bytes.indexOf(0xff, at);
        if (ff === -1 || ff + 1 >= bytes.length) return null; // the scan runs off the end
        const next = bytes[ff + 1]!;
        if (next === 0x00 || (next >= 0xd0 && next <= 0xd7)) at = ff + 2;
        else if (next === 0xff) at = ff + 1;
        else {
          at = ff;
          break;
        }
      }
    }
  }
}
