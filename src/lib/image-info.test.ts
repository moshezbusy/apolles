import { describe, expect, it } from "vitest";
import { readImageInfo } from "./image-info";

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
