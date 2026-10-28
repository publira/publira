import { inflateSync } from "node:zlib";

const WOFF_SIGNATURE = 0x77_4f_46_46;
const WOFF_HEADER_LENGTH = 44;
const WOFF_TABLE_ENTRY_LENGTH = 20;
const CMAP_TAG = 0x63_6d_61_70;

/** Inclusive `[first, last]` code points. */
type Segment = readonly [first: number, last: number];

/** Every code point a format 4 subtable maps to a glyph other than `.notdef`. */
const format4CodePoints = (table: DataView, at: number): number[] => {
  const segmentCount = table.getUint16(at + 6) / 2;
  const endCodes = at + 14;
  const startCodes = endCodes + segmentCount * 2 + 2;
  const deltas = startCodes + segmentCount * 2;
  const rangeOffsets = deltas + segmentCount * 2;

  const codePoints: number[] = [];
  for (let segment = 0; segment < segmentCount; segment += 1) {
    const first = table.getUint16(startCodes + segment * 2);
    const last = table.getUint16(endCodes + segment * 2);
    const delta = table.getUint16(deltas + segment * 2);
    const rangeOffsetAt = rangeOffsets + segment * 2;
    const rangeOffset = table.getUint16(rangeOffsetAt);
    for (
      let codePoint = first;
      codePoint <= last && codePoint < 0xff_ff;
      codePoint += 1
    ) {
      const index =
        rangeOffset === 0
          ? codePoint
          : table.getUint16(
              rangeOffsetAt + rangeOffset + (codePoint - first) * 2
            );
      if (index !== 0 && (index + delta) % 0x1_00_00 !== 0) {
        codePoints.push(codePoint);
      }
    }
  }
  return codePoints;
};

/** The ranges a format 12 subtable maps, which fonts use beyond the BMP. */
const format12Segments = (table: DataView, at: number): Segment[] => {
  const groupCount = table.getUint32(at + 12);
  const segments: Segment[] = [];
  for (let group = 0; group < groupCount; group += 1) {
    const groupAt = at + 16 + group * 12;
    segments.push([table.getUint32(groupAt), table.getUint32(groupAt + 4)]);
  }
  return segments;
};

/**
 * The code points a WOFF font has a glyph for, from its `cmap` table.
 *
 * What a font covers has to be read from the font. Fontsource's `unicode.json`
 * gives each file the `unicode-range` Google Fonts cut it with, which is
 * shared by every family split the same way: a Traditional Chinese file is
 * listed for Simplified characters it does not draw. Formats 4 and 12 are the
 * subtables a Noto file maps characters with; format 14 maps variation
 * sequences, which a card never asks for.
 */
export const woffCodePoints = (woff: Uint8Array): ReadonlySet<number> => {
  const file = new DataView(woff.buffer, woff.byteOffset, woff.byteLength);
  if (file.getUint32(0) !== WOFF_SIGNATURE) {
    throw new Error("not a WOFF font");
  }

  const codePoints = new Set<number>();
  const tableCount = file.getUint16(12);
  for (let entry = 0; entry < tableCount; entry += 1) {
    const entryAt = WOFF_HEADER_LENGTH + entry * WOFF_TABLE_ENTRY_LENGTH;
    if (file.getUint32(entryAt) !== CMAP_TAG) {
      continue;
    }
    const offset = file.getUint32(entryAt + 4);
    const compressedLength = file.getUint32(entryAt + 8);
    const length = file.getUint32(entryAt + 12);
    const stored = woff.subarray(offset, offset + compressedLength);
    const bytes = compressedLength < length ? inflateSync(stored) : stored;
    const table = new DataView(
      bytes.buffer,
      bytes.byteOffset,
      bytes.byteLength
    );

    const subtableCount = table.getUint16(2);
    for (let subtable = 0; subtable < subtableCount; subtable += 1) {
      const at = table.getUint32(4 + subtable * 8 + 4);
      const format = table.getUint16(at);
      if (format === 4) {
        for (const codePoint of format4CodePoints(table, at)) {
          codePoints.add(codePoint);
        }
      } else if (format === 12) {
        for (const [first, last] of format12Segments(table, at)) {
          for (let codePoint = first; codePoint <= last; codePoint += 1) {
            codePoints.add(codePoint);
          }
        }
      }
    }
  }
  return codePoints;
};
