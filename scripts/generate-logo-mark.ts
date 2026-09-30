/**
 * Generate the provisional Publira mark from a pinned font.
 *
 *     task images:logo-mark
 *
 * STAND-IN, NOT THE LOGO: the mark this writes holds the place of the
 * commissioned logo tracked in #3406, and is replaced by it wholesale.
 *
 * The mark is the hiragana ぱ as drawn in Shippori Mincho B1 ExtraBold,
 * converted to outlines and set in paper on a Sumi tile with rounded corners.
 * The font is under the SIL Open Font License, which
 * restricts redistributing the font software and places no restriction on
 * artwork made from its glyph outlines — so the SVG is committed and the font is
 * not: it is downloaded on every run, checked against a pinned SHA-256, and
 * only ever held in memory.
 *
 * The output depends on nothing but the font's bytes and this file, so a run on
 * a clean tree leaves it clean. Coordinates stay in font units (the em is 1000)
 * and the glyph is translated by whole units, which keeps every number the
 * outline has — integers, and the halves TrueType's implied on-curve points
 * land on — exact in the path data rather than rounded by a float formatter.
 *
 * `task images:gen` renders the rasters the web apps serve from the SVG this
 * writes; run it after this one.
 */

import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";

// The package's `main` is a UMD bundle, which Node.js reads as CommonJS with no
// named exports; the ES module build its `module` field names is only found by
// bundlers, so it is imported by path.
import { parse } from "opentype.js/dist/opentype.mjs";

/** The `google/fonts` commit the font is read at. */
const FONT_COMMIT = "d0b2d1307ad5d6b579d627a6e5abd25952484b96";
const FONT_PATH = "ofl/shipporiminchob1/ShipporiMinchoB1-ExtraBold.ttf";
/** SHA-256 of the file at `FONT_PATH` in `FONT_COMMIT`. */
const FONT_SHA256 =
  "bee99a242f32128e8d6a4acff2b3f1742cd42ea90748758e6e10456871887e76";

const FAMILY = "Shippori Mincho B1";
const WEIGHT = 800;
const CHARACTER = "ぱ";
/** Sumi, the brand's foreground, for the tile. The mark never takes Shu. */
const SUMI = "#1F1D1A";
/** The brand's paper background, for the glyph. */
const PAPER = "#F5F5F2";

/**
 * The tile's side in font units. With the glyph's 824-unit bounding box that
 * leaves it about two thirds of the tile, the share a letter takes on an app
 * icon, and a margin wide enough that the handakuten does not crowd a corner.
 */
const TILE = 1280;
/**
 * An eighth of the side, so that at the 32px favicon the corner is 4px — the
 * `--radius-control` of `@publira/brand/theme.css`.
 */
const RADIUS = TILE / 8;

const OUTPUT = new URL("../assets/brand/logo-mark.svg", import.meta.url);

const fail = (message: string): never => {
  console.error(`generate-logo-mark: ${message}`);
  process.exit(1);
};

const downloadFont = async (): Promise<ArrayBuffer> => {
  const url = `https://raw.githubusercontent.com/google/fonts/${FONT_COMMIT}/${FONT_PATH}`;
  const response = await fetch(url);
  if (!response.ok) {
    fail(`GET ${url} answered ${response.status} ${response.statusText}.`);
  }
  const bytes = await response.arrayBuffer();
  const digest = createHash("sha256")
    .update(new Uint8Array(bytes))
    .digest("hex");
  if (digest !== FONT_SHA256) {
    fail(
      [
        `the font downloaded from ${url} does not match the pinned SHA-256.`,
        `  expected ${FONT_SHA256}`,
        `  received ${digest}`,
        "Refusing to generate a mark from a font nobody has checked. If the pin was moved on purpose, update FONT_COMMIT and FONT_SHA256 together.",
      ].join("\n")
    );
  }
  return bytes;
};

/** The `name` table as opentype.js 2 parses it, one record per platform. */
type NameTable = Record<
  "macintosh" | "windows",
  Record<string, Record<string, string> | undefined> | undefined
>;

/** One drawing command of an opentype.js path, in absolute coordinates. */
type PathCommand =
  | { type: "M" | "L"; x: number; y: number }
  | { type: "Q"; x: number; x1: number; y: number; y1: number }
  | {
      type: "C";
      x: number;
      x1: number;
      x2: number;
      y: number;
      y1: number;
      y2: number;
    }
  | { type: "Z" };

/** An English entry of the font's `name` table, or a failure naming it. */
const fontName = (names: NameTable, key: string): string => {
  const value = names.windows?.[key]?.en ?? names.macintosh?.[key]?.en;
  return value ?? fail(`the font's name table has no English "${key}".`);
};

/**
 * A path coordinate as SVG writes it. The inputs are multiples of 0.5 (see the
 * file comment), which `String` prints exactly.
 */
const coordinate = (value: number): string => {
  if (!Number.isInteger(value * 2)) {
    fail(`the outline has a coordinate that is not a half unit: ${value}.`);
  }
  return String(value);
};

const pathData = (commands: PathCommand[]): string =>
  commands
    .map((command) => {
      switch (command.type) {
        case "M":
        case "L": {
          return `${command.type}${coordinate(command.x)} ${coordinate(command.y)}`;
        }
        case "Q": {
          return `Q${coordinate(command.x1)} ${coordinate(command.y1)} ${coordinate(command.x)} ${coordinate(command.y)}`;
        }
        case "C": {
          return `C${coordinate(command.x1)} ${coordinate(command.y1)} ${coordinate(command.x2)} ${coordinate(command.y2)} ${coordinate(command.x)} ${coordinate(command.y)}`;
        }
        case "Z": {
          return "Z";
        }
        default: {
          return fail(`unexpected path command ${JSON.stringify(command)}.`);
        }
      }
    })
    .join("");

const font = parse(await downloadFont());
const names: NameTable = font.names;

const family = fontName(names, "preferredFamily");
const [version] = fontName(names, "version").split(";");
const license = fontName(names, "license");
const copyright = fontName(names, "copyright");
const weight = font.tables.os2?.usWeightClass;
if (family !== FAMILY || weight !== WEIGHT) {
  fail(`expected ${FAMILY} at weight ${WEIGHT}, got ${family} at ${weight}.`);
}

const glyph = font.charToGlyph(CHARACTER);
if (glyph.index === 0) {
  fail(`${FAMILY} has no glyph for ${CHARACTER}.`);
}

// At a font size equal to the em, `getPath` returns font units with the y axis
// already flipped for SVG. Measure the outline where it sits, then draw it again
// shifted so its bounding box is centred on the tile.
const bounds = glyph.getPath(0, 0, font.unitsPerEm).getBoundingBox();
const width = bounds.x2 - bounds.x1;
const height = bounds.y2 - bounds.y1;
if (Math.max(width, height) + RADIUS > TILE) {
  fail(`${CHARACTER} is ${width}x${height} units, too large for the tile.`);
}
const path = glyph.getPath(
  Math.round((TILE - width) / 2) - bounds.x1,
  Math.round((TILE - height) / 2) - bounds.y1,
  font.unitsPerEm
);

// The tile is a path as well, so the file holds nothing but outlines.
const tile = [
  `M${RADIUS} 0H${TILE - RADIUS}`,
  `A${RADIUS} ${RADIUS} 0 0 1 ${TILE} ${RADIUS}V${TILE - RADIUS}`,
  `A${RADIUS} ${RADIUS} 0 0 1 ${TILE - RADIUS} ${TILE}H${RADIUS}`,
  `A${RADIUS} ${RADIUS} 0 0 1 0 ${TILE - RADIUS}V${RADIUS}`,
  `A${RADIUS} ${RADIUS} 0 0 1 ${RADIUS} 0Z`,
].join("");

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${TILE}" height="${TILE}" viewBox="0 0 ${TILE} ${TILE}">
<!--
  Provisional Publira mark. A stand-in until the commissioned logo (#3406)
  replaces it; do not treat this as the final logo.

  Generated by scripts/generate-logo-mark.ts. Do not edit by hand.

  Glyph:     ${CHARACTER} (U+${CHARACTER.codePointAt(0)?.toString(16).toUpperCase()}), converted to outlines, in ${PAPER} on a ${SUMI} tile
  Family:    ${family}
  Weight:    ${weight} (ExtraBold)
  Version:   ${version}
  Source:    https://github.com/google/fonts/blob/${FONT_COMMIT}/${FONT_PATH}
  Copyright: ${copyright}
  License:   ${license}
-->
<path fill="${SUMI}" d="${tile}"/>
<path fill="${PAPER}" d="${pathData(path.commands)}"/>
</svg>
`;

await writeFile(OUTPUT, svg);
console.log(`assets/brand/logo-mark.svg (${TILE}x${TILE})`);
