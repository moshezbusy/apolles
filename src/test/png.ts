import { crc32, deflateSync } from "node:zlib";

// Test-only: builds PNG files byte by byte, valid ones and deliberately broken ones (a zlib
// bomb, a corrupt pixel stream, a wrong checksum), so upload and voucher tests never depend on
// image files in the repository.

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

export function pngChunk(type: string, data: Uint8Array = Buffer.alloc(0)): Buffer {
  const typed = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed));
  return Buffer.concat([length, typed, crc]);
}

export type PngOptions = {
  colorType?: 0 | 2 | 3 | 4 | 6;
  bitDepth?: 1 | 2 | 4 | 8 | 16;
  interlace?: 0 | 1;
  // The raw pixel rows before compression (default: all zero, the right size for the header).
  raw?: Uint8Array;
  // The compressed pixel stream as stored (default: `raw`, deflated). Split over `idatParts` chunks.
  idat?: Uint8Array;
  idatParts?: number;
  // Chunks placed between the header (and palette) and the pixel data, and after the pixel data.
  before?: Buffer[];
  after?: Buffer[];
  // Colour type 3: a palette of this many entries is added (default 4, or 2 for 1-bit). `trns` adds a tRNS chunk.
  paletteEntries?: number;
  trns?: Uint8Array;
};

export function pngRowBytes(width: number, colorType: number, bitDepth: number): number {
  return 1 + Math.ceil((width * (CHANNELS[colorType] ?? 1) * bitDepth) / 8);
}

export function makePng(width: number, height: number, options: PngOptions = {}): Buffer {
  const colorType = options.colorType ?? 2;
  const bitDepth = options.bitDepth ?? 8;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([bitDepth, colorType, 0, 0, options.interlace ?? 0], 8);
  const raw = options.raw ?? Buffer.alloc(height * pngRowBytes(width, colorType, bitDepth));
  const idat = Buffer.from(options.idat ?? deflateSync(raw));
  const parts = Math.max(1, options.idatParts ?? 1);
  const size = Math.ceil(idat.length / parts);
  const idatChunks = Array.from({ length: parts }, (_, i) => pngChunk("IDAT", idat.subarray(i * size, (i + 1) * size)));
  return Buffer.concat([
    SIGNATURE,
    pngChunk("IHDR", ihdr),
    ...(colorType === 3 ? [pngChunk("PLTE", Buffer.alloc((options.paletteEntries ?? Math.min(4, 2 ** bitDepth)) * 3, 0x55))] : []),
    ...(options.trns ? [pngChunk("tRNS", options.trns)] : []),
    ...(options.before ?? []),
    ...idatChunks,
    ...(options.after ?? []),
    pngChunk("IEND"),
  ]);
}

// A small file that claims to be width x height RGBA but whose pixel stream inflates to
// `inflatedBytes` of zeros: the "zlib bomb" (a few hundred KB of file, hundreds of MB in memory
// for a decoder that trusts it).
export function bombPng(width: number, height: number, inflatedBytes: number): Buffer {
  return makePng(width, height, { colorType: 6, idat: deflateSync(Buffer.alloc(inflatedBytes), { level: 9 }) });
}

// Valid chunks and checksums, but the pixel stream is not a zlib stream at all.
export function corruptIdatPng(width: number, height: number): Buffer {
  return makePng(width, height, { colorType: 6, idat: Buffer.from("this is not a zlib stream, only bytes that look like pixel data") });
}

// A minimal structurally complete JPEG: SOI, APP0, DQT, SOFn, DHT, SOS, a few scan bytes, EOI.
// Not decodable into a picture, but every segment is well formed (which is all the upload check
// and pdfkit look at: pdfkit embeds JPEG bytes without decoding them).
export function makeJpeg(width: number, height: number, options: { sof?: number; components?: number; precision?: number; scan?: number[]; tail?: number[]; eoi?: boolean } = {}): Buffer {
  const components = options.components ?? 3;
  const segment = (marker: number, data: number[]) => [0xff, marker, (data.length + 2) >> 8, (data.length + 2) & 0xff, ...data];
  const frame = [options.precision ?? 8, height >> 8, height & 0xff, width >> 8, width & 0xff, components];
  for (let i = 1; i <= components; i += 1) frame.push(i, 0x11, 0);
  const scanHeader = [components];
  for (let i = 1; i <= components; i += 1) scanHeader.push(i, 0);
  scanHeader.push(0, 63, 0);
  return Buffer.from([
    0xff, 0xd8,
    ...segment(0xe0, [0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]),
    ...segment(0xdb, [0, ...new Array<number>(64).fill(1)]),
    ...segment(options.sof ?? 0xc0, frame),
    ...segment(0xc4, [0, ...new Array<number>(16).fill(0)]),
    ...segment(0xda, scanHeader),
    ...(options.scan ?? [0x12, 0x34, 0xff, 0x00, 0x56, 0xff, 0xd0, 0x78]),
    ...(options.eoi === false ? [] : [0xff, 0xd9]),
    ...(options.tail ?? []),
  ]);
}
