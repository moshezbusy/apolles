import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { bombPng, corruptIdatPng, makeJpeg, makePng, pngChunk, pngRowBytes } from "@/test/png";
import { IMAGE_MAX_PIXELS, IMAGE_MAX_SIDE, readImageInfo, validateImage } from "./image-info";

// Minimal valid headers: enough bytes for the parser, not full images.
function png(width: number, height: number): Uint8Array {
  const b = new Uint8Array(33);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0); // signature
  b.set([0, 0, 0, 13], 8); // IHDR length
  b.set([0x49, 0x48, 0x44, 0x52], 12); // "IHDR"
  new DataView(b.buffer).setUint32(16, width);
  new DataView(b.buffer).setUint32(20, height);
  return b;
}

function jpeg(width: number, height: number, sofMarker = 0xc0): Uint8Array {
  // SOI, an APP0 segment (length 16), then SOFn with height/width.
  const app0 = [0xff, 0xe0, 0x00, 0x10, ...new Array(14).fill(0)];
  const sof = [0xff, sofMarker, 0x00, 0x11, 0x08, height >> 8, height & 0xff, width >> 8, width & 0xff, 3];
  return new Uint8Array([0xff, 0xd8, ...app0, ...sof, ...new Array(9).fill(0)]);
}

const text = (s: string) => new TextEncoder().encode(s);

describe("readImageInfo", () => {
  it("reads a PNG's type and size", () => {
    expect(readImageInfo(png(640, 200))).toEqual({ type: "image/png", width: 640, height: 200 });
  });

  it("reads a baseline and a progressive JPEG's size", () => {
    expect(readImageInfo(jpeg(800, 300))).toEqual({ type: "image/jpeg", width: 800, height: 300 });
    expect(readImageInfo(jpeg(512, 512, 0xc2))).toEqual({ type: "image/jpeg", width: 512, height: 512 });
  });

  it("rejects SVG, HTML and GIF bytes, whatever the file is called", () => {
    expect(readImageInfo(text('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'))).toBeNull();
    expect(readImageInfo(text("<!doctype html><script>alert(1)</script>"))).toBeNull();
    expect(readImageInfo(text("GIF89a\x01\x00\x01\x00"))).toBeNull();
  });

  it("rejects empty and truncated headers without throwing", () => {
    expect(readImageInfo(new Uint8Array())).toBeNull();
    expect(readImageInfo(png(640, 200).slice(0, 20))).toBeNull();
    expect(readImageInfo(jpeg(800, 300).slice(0, 22))).toBeNull();
    expect(readImageInfo(new Uint8Array([0xff, 0xd8, 0xff]))).toBeNull();
  });

  it("rejects a PNG whose first chunk is not IHDR, and zero sizes", () => {
    const bad = png(640, 200);
    bad.set([0x49, 0x44, 0x41, 0x54], 12); // "IDAT"
    expect(readImageInfo(bad)).toBeNull();
    expect(readImageInfo(png(0, 200))).toBeNull();
    expect(readImageInfo(jpeg(0, 300))).toBeNull();
  });

  it("stops on a JPEG segment length that points past the end", () => {
    const b = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0xff, 0xff, 0, 0]);
    expect(readImageInfo(b)).toBeNull();
  });
});

// A grey 8-bit row set with one bad filter byte at the start of row `row`.
function rawWithFilter(width: number, height: number, row: number, filter: number): Buffer {
  const stride = pngRowBytes(width, 6, 8);
  const raw = Buffer.alloc(height * stride);
  raw[row * stride] = filter;
  return raw;
}

describe("validateImage: PNG", () => {
  it.each([
    [0, 1], [0, 2], [0, 4], [0, 8], [0, 16], [2, 8], [2, 16], [3, 1], [3, 2], [3, 4], [3, 8], [4, 8], [4, 16], [6, 8], [6, 16],
  ] as const)("accepts a complete PNG of colour type %i, %i bits", (colorType, bitDepth) => {
    expect(validateImage(makePng(320, 100, { colorType, bitDepth }))).toEqual({ type: "image/png", width: 320, height: 100 });
  });

  it("accepts pixel data split over several IDAT chunks, text chunks and palette transparency", () => {
    expect(validateImage(makePng(320, 100, { idatParts: 3, before: [pngChunk("tEXt", Buffer.from("Software\0test"))] }))).not.toBeNull();
    expect(validateImage(makePng(320, 100, { colorType: 3, trns: Buffer.from([0, 128]) }))).not.toBeNull();
  });

  it("rejects a zlib bomb: a small file whose pixel stream inflates far beyond its header", () => {
    // 300 KB on disk, 300 MB of pixels for a decoder that trusts it.
    const bomb = bombPng(320, 100, 300_000_000);
    expect(bomb.length).toBeLessThan(512_000);
    const before = process.memoryUsage().arrayBuffers;
    expect(validateImage(bomb)).toBeNull();
    // The check stops at the size the header promises: it never holds the inflated bomb.
    expect(process.memoryUsage().arrayBuffers - before).toBeLessThan(50_000_000);
  });

  it("rejects a pixel stream that is not zlib data, is cut short, or is shorter than the header says", () => {
    expect(validateImage(corruptIdatPng(320, 100))).toBeNull();
    const good = deflateSync(Buffer.alloc(100 * pngRowBytes(320, 2, 8)));
    expect(validateImage(makePng(320, 100, { idat: good.subarray(0, good.length - 6) }))).toBeNull();
    expect(validateImage(makePng(320, 100, { raw: Buffer.alloc(50 * pngRowBytes(320, 2, 8)) }))).toBeNull();
    expect(validateImage(makePng(320, 100, { raw: Buffer.alloc(100 * pngRowBytes(320, 2, 8) + 1) }))).toBeNull();
  });

  it("rejects a row filter type that does not exist (pdfkit would throw while decoding)", () => {
    expect(validateImage(makePng(320, 100, { colorType: 6, raw: rawWithFilter(320, 100, 0, 4) }))).not.toBeNull();
    expect(validateImage(makePng(320, 100, { colorType: 6, raw: rawWithFilter(320, 100, 99, 5) }))).toBeNull();
  });

  it("rejects a wrong chunk checksum", () => {
    const bad = makePng(320, 100);
    bad[bad.length - 1] = bad[bad.length - 1]! ^ 0xff; // IEND's CRC
    expect(validateImage(bad)).toBeNull();
    const badIhdr = makePng(320, 100);
    badIhdr[19] = 0x41; // width changed after the checksum was written
    expect(validateImage(badIhdr)).toBeNull();
  });

  it("rejects a file cut short, a missing IEND, and bytes after IEND", () => {
    const good = makePng(320, 100);
    expect(validateImage(good.subarray(0, good.length - 1))).toBeNull();
    expect(validateImage(good.subarray(0, good.length - 12))).toBeNull();
    expect(validateImage(Buffer.concat([good, Buffer.from("<script>")]))).toBeNull();
    expect(validateImage(Buffer.concat([good, pngChunk("IEND")]))).toBeNull();
  });

  it("rejects interlaced and animated PNGs", () => {
    expect(validateImage(makePng(320, 100, { interlace: 1 }))).toBeNull();
    expect(validateImage(makePng(320, 100, { before: [pngChunk("acTL", Buffer.alloc(8))] }))).toBeNull();
    expect(validateImage(makePng(320, 100, { after: [pngChunk("fcTL", Buffer.alloc(26))] }))).toBeNull();
    expect(validateImage(makePng(320, 100, { after: [pngChunk("fdAT", Buffer.alloc(8))] }))).toBeNull();
  });

  it("rejects a bad header: unknown colour type, a bit depth the colour type does not allow, zero size", () => {
    expect(validateImage(makePng(320, 100, { colorType: 5 as 6 }))).toBeNull();
    expect(validateImage(makePng(320, 100, { colorType: 6, bitDepth: 4 }))).toBeNull();
    expect(validateImage(makePng(320, 100, { colorType: 3, bitDepth: 16 }))).toBeNull();
    expect(validateImage(makePng(0, 100))).toBeNull();
  });

  it("rejects more pixels than the budget, before inflating anything", () => {
    expect(validateImage(makePng(2000, 1000, { colorType: 0, bitDepth: 1 }))).toEqual({ type: "image/png", width: 2000, height: 1000 });
    expect(validateImage(makePng(2001, 100, { colorType: 0, bitDepth: 1 }))).toBeNull();
    expect(validateImage(makePng(100, 2001, { colorType: 0, bitDepth: 1 }))).toBeNull();
    expect(validateImage(makePng(2000, 1001, { colorType: 0, bitDepth: 1 }))).toBeNull();
    expect(IMAGE_MAX_SIDE).toBe(2000);
    expect(IMAGE_MAX_PIXELS).toBe(2_000_000);
  });

  it("rejects chunks out of order or missing: no IDAT, a second IHDR, IDAT runs apart, palette problems", () => {
    const ihdr = makePng(320, 100).subarray(8, 33);
    expect(validateImage(Buffer.concat([makePng(320, 100).subarray(0, 33), pngChunk("IEND")]))).toBeNull();
    expect(validateImage(makePng(320, 100, { before: [Buffer.from(ihdr)] }))).toBeNull();
    expect(validateImage(makePng(320, 100, { after: [pngChunk("tEXt", Buffer.from("a\0b")), pngChunk("IDAT", deflateSync(Buffer.alloc(1)))] }))).toBeNull();
    expect(validateImage(makePng(320, 100, { colorType: 3, paletteEntries: 0 }))).toBeNull();
    expect(validateImage(makePng(320, 100, { colorType: 3, bitDepth: 1, paletteEntries: 3 }))).toBeNull();
    expect(validateImage(makePng(320, 100, { colorType: 3, trns: Buffer.alloc(5) }))).toBeNull(); // more than the 4 palette entries
    expect(validateImage(makePng(320, 100, { colorType: 6, trns: Buffer.alloc(2) }))).toBeNull();
    expect(validateImage(makePng(320, 100, { before: [pngChunk("XXXX", Buffer.alloc(4))] }))).toBeNull(); // unknown critical chunk
  });

  it("rejects the header-only files the old check accepted", () => {
    expect(validateImage(png(640, 200))).toBeNull();
  });
});

describe("validateImage: JPEG", () => {
  it("accepts a complete baseline, extended and progressive JPEG", () => {
    expect(validateImage(makeJpeg(800, 300))).toEqual({ type: "image/jpeg", width: 800, height: 300 });
    expect(validateImage(makeJpeg(800, 300, { sof: 0xc1 }))).not.toBeNull();
    expect(validateImage(makeJpeg(800, 300, { sof: 0xc2 }))).not.toBeNull();
    expect(validateImage(makeJpeg(800, 300, { components: 1 }))).not.toBeNull();
  });

  it("rejects a JPEG cut short: no end marker, or cut inside a segment or the scan", () => {
    const good = makeJpeg(800, 300);
    expect(validateImage(makeJpeg(800, 300, { eoi: false }))).toBeNull();
    for (const cut of [4, 30, 100, good.length - 3, good.length - 1]) expect(validateImage(good.subarray(0, cut))).toBeNull();
  });

  it("rejects lossless and arithmetic frames, a second frame header, odd precision and component counts", () => {
    for (const sof of [0xc3, 0xc5, 0xc9, 0xca, 0xcf]) expect(validateImage(makeJpeg(800, 300, { sof }))).toBeNull();
    expect(validateImage(makeJpeg(800, 300, { precision: 12 }))).toBeNull();
    expect(validateImage(makeJpeg(800, 300, { components: 2 }))).toBeNull();
    const good = makeJpeg(800, 300);
    const sofAt = good.indexOf(Buffer.from([0xff, 0xc0]));
    const sof = good.subarray(sofAt, sofAt + 19);
    expect(validateImage(Buffer.concat([good.subarray(0, sofAt), sof, good.subarray(sofAt)]))).toBeNull();
  });

  it("rejects sizes over the pixel budget, zero sizes, and bytes after the end marker", () => {
    expect(validateImage(makeJpeg(2000, 1000))).not.toBeNull();
    expect(validateImage(makeJpeg(2001, 100))).toBeNull();
    expect(validateImage(makeJpeg(2000, 1001))).toBeNull();
    expect(validateImage(makeJpeg(0, 300))).toBeNull();
    expect(validateImage(makeJpeg(800, 300, { tail: [0x3c, 0x73] }))).toBeNull();
  });

  it("rejects a file with no scan, and the header-only files the old check accepted", () => {
    const good = makeJpeg(800, 300);
    const sosAt = good.indexOf(Buffer.from([0xff, 0xda]));
    expect(validateImage(Buffer.concat([good.subarray(0, sosAt), Buffer.from([0xff, 0xd9])]))).toBeNull();
    expect(validateImage(jpeg(800, 300))).toBeNull();
  });

  it("never throws on junk", () => {
    expect(validateImage(new Uint8Array())).toBeNull();
    expect(validateImage(text("<svg xmlns='http://www.w3.org/2000/svg'/>"))).toBeNull();
    expect(validateImage(new Uint8Array([0xff, 0xd8, 0xff]))).toBeNull();
    expect(validateImage(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBeNull();
  });
});
