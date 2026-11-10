import { crc32, deflateSync } from "node:zlib";

// A real, valid PNG of one solid colour (RGB, 8-bit), for upload tests.
export function solidPng(width: number, height: number, rgb: [number, number, number] = [23, 63, 53]): Buffer {
  const chunk = (type: string, data: Buffer): Buffer => {
    const typed = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(typed));
    return Buffer.concat([length, typed, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 2, 0, 0, 0], 8); // bit depth 8, colour type RGB
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(new Array(width).fill(rgb).flat())]);
  const pixels = Buffer.concat(new Array(height).fill(row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(pixels)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
