import { randomBytes } from "node:crypto";
import { crc32, deflateSync } from "node:zlib";

const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

const pngChunk = (type: string, data: Buffer): Buffer => {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.byteLength);
  const typeAndData = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(typeAndData));
  return Buffer.concat([length, typeAndData, checksum]);
};

/**
 * An RGB PNG of random pixels. Noise does not compress, so its size is what
 * its dimensions say — about `width * height * 3` bytes — and every call is a
 * different picture.
 */
export const noisePng = (width: number, height: number): Buffer => {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  // Bit depth 8, colour type 2 (RGB), default compression, filter, and no
  // interlace.
  header.set([8, 2, 0, 0, 0], 8);

  const rowBytes = 1 + width * 3;
  const pixels = randomBytes(rowBytes * height);
  // Each row starts with its filter type, 0 for none.
  for (let row = 0; row < height; row += 1) {
    pixels[row * rowBytes] = 0;
  }

  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(pixels, { level: 1 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
};

/**
 * A ZIP holding `entries` as they are, without compression — what a reader
 * of the format needs and nothing more. Every entry is dated 1980-01-01.
 */
export const storedZip = (
  entries: readonly { data: Buffer; name: string }[]
): Buffer => {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const { data, name } of entries) {
    const fileName = Buffer.from(name, "utf-8");
    const checksum = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04_03_4b_50, 0);
    local.writeUInt16LE(20, 4);
    // General purpose flags: bit 11 says the name is UTF-8.
    local.writeUInt16LE(0x08_00, 6);
    // Method 0 is stored.
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0x21, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(data.byteLength, 18);
    local.writeUInt32LE(data.byteLength, 22);
    local.writeUInt16LE(fileName.byteLength, 26);
    local.writeUInt16LE(0, 28);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02_01_4b_50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x08_00, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0x21, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(data.byteLength, 20);
    central.writeUInt32LE(data.byteLength, 24);
    central.writeUInt16LE(fileName.byteLength, 28);
    central.writeUInt32LE(offset, 42);

    locals.push(local, fileName, data);
    centrals.push(central, fileName);
    offset += local.byteLength + fileName.byteLength + data.byteLength;
  }

  const centralDirectory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06_05_4b_50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.byteLength, 12);
  end.writeUInt32LE(offset, 16);

  return Buffer.concat([...locals, centralDirectory, end]);
};
