import notoSansJpUnicode from "@fontsource/noto-sans-jp/unicode.json" with { type: "json" };
import notoSansKrUnicode from "@fontsource/noto-sans-kr/unicode.json" with { type: "json" };
import notoSansScUnicode from "@fontsource/noto-sans-sc/unicode.json" with { type: "json" };
import notoSansTcUnicode from "@fontsource/noto-sans-tc/unicode.json" with { type: "json" };
import notoSansUnicode from "@fontsource/noto-sans/unicode.json" with { type: "json" };
import type { Locale } from "@publira/i18n";
import type { ImageResponse } from "next/og";

import { woffCodePoints } from "./woff-character-map";

/** One face handed to `ImageResponse`, in the shape its `fonts` option takes. */
export type OpenGraphCardFont = NonNullable<
  NonNullable<ConstructorParameters<typeof ImageResponse>[1]>["fonts"]
>[number];

type FontFamily =
  | "noto-sans"
  | "noto-sans-jp"
  | "noto-sans-kr"
  | "noto-sans-sc"
  | "noto-sans-tc";

/**
 * The faces a card in each locale draws with, its own first. Han characters
 * take a different form in each region, so a Japanese card draws them from
 * the Japanese face and a Traditional Chinese one from the Traditional; a
 * character the locale's face lacks — a Korean title on an English card —
 * comes from the first of the rest that has it, in the same order for every
 * locale so a text always draws with the same faces.
 */
const FAMILIES_BY_LOCALE: Record<Locale, readonly FontFamily[]> = {
  en: [
    "noto-sans",
    "noto-sans-jp",
    "noto-sans-kr",
    "noto-sans-sc",
    "noto-sans-tc",
  ],
  ja: [
    "noto-sans-jp",
    "noto-sans",
    "noto-sans-kr",
    "noto-sans-sc",
    "noto-sans-tc",
  ],
  ko: [
    "noto-sans-kr",
    "noto-sans",
    "noto-sans-jp",
    "noto-sans-sc",
    "noto-sans-tc",
  ],
  "zh-Hans": [
    "noto-sans-sc",
    "noto-sans",
    "noto-sans-jp",
    "noto-sans-kr",
    "noto-sans-tc",
  ],
  "zh-Hant": [
    "noto-sans-tc",
    "noto-sans",
    "noto-sans-jp",
    "noto-sans-kr",
    "noto-sans-sc",
  ],
};

/**
 * The one weight a card is set in. Fontsource ships each weight as its own
 * files, a few megabytes per CJK family, and the card tells its lines apart by
 * size and colour, so a second weight would double what the image carries for
 * nothing the card draws.
 */
const FONT_WEIGHT = 700;

/**
 * The subsets each family is split into, as its package states them:
 * `"[57]"` is `noto-sans-jp-57-700-normal.woff`, and `"latin"` is
 * `noto-sans-jp-latin-700-normal.woff`. A range says which file to look in for
 * a character, not that the file draws it (`woffCodePoints`).
 */
const UNICODE_RANGES: Record<FontFamily, Record<string, string>> = {
  "noto-sans": notoSansUnicode,
  "noto-sans-jp": notoSansJpUnicode,
  "noto-sans-kr": notoSansKrUnicode,
  "noto-sans-sc": notoSansScUnicode,
  "noto-sans-tc": notoSansTcUnicode,
};

/** A face file, as the `?bytes` rule makes a module of it. */
interface FaceModule {
  default: Uint8Array;
}

/**
 * Every subset file of {@link FONT_WEIGHT}, by file name, each imported as
 * bytes the first time a card needs it. They are part of the build rather than
 * files read from `node_modules`: the standalone output keeps the files a read
 * of that directory traces but not the pnpm links the path runs through, so the
 * path names nothing there. `?bytes` is the rule that makes a face a
 * `Uint8Array`, in `next.config.ts` and again in `vitest.config.ts`.
 *
 * `import.meta.glob` takes literals only, so the weight is written out here.
 */
const FACE_IMPORTS: Record<
  FontFamily,
  Partial<Record<string, () => Promise<FaceModule>>>
> = {
  "noto-sans": import.meta.glob<FaceModule>("./*-700-normal.woff", {
    base: "../node_modules/@fontsource/noto-sans/files",
    query: "?bytes",
  }),
  "noto-sans-jp": import.meta.glob<FaceModule>("./*-700-normal.woff", {
    base: "../node_modules/@fontsource/noto-sans-jp/files",
    query: "?bytes",
  }),
  "noto-sans-kr": import.meta.glob<FaceModule>("./*-700-normal.woff", {
    base: "../node_modules/@fontsource/noto-sans-kr/files",
    query: "?bytes",
  }),
  "noto-sans-sc": import.meta.glob<FaceModule>("./*-700-normal.woff", {
    base: "../node_modules/@fontsource/noto-sans-sc/files",
    query: "?bytes",
  }),
  "noto-sans-tc": import.meta.glob<FaceModule>("./*-700-normal.woff", {
    base: "../node_modules/@fontsource/noto-sans-tc/files",
    query: "?bytes",
  }),
};

/** A subset's code points as inclusive `[first, last]` ranges. */
type CodePointRanges = readonly (readonly [number, number])[];

interface FontSubset {
  face: () => Promise<FaceModule>;
  name: string;
  ranges: CodePointRanges;
}

/**
 * `U+0000-00FF,U+0131,U+4??` as ranges. A `?` stands for any hex digit, which
 * the CSS `unicode-range` syntax Fontsource writes allows.
 */
const parseUnicodeRange = (value: string): CodePointRanges =>
  value.split(",").flatMap((entry) => {
    const [first, last] = entry.trim().replace(/^U\+/iu, "").split("-");

    if (!first) {
      return [];
    }

    const start = Number.parseInt(first.replaceAll("?", "0"), 16);
    const end = Number.parseInt((last ?? first).replaceAll("?", "f"), 16);

    return Number.isNaN(start) || Number.isNaN(end) ? [] : [[start, end]];
  });

const inRanges = (ranges: CodePointRanges, codePoint: number): boolean =>
  ranges.some(([start, end]) => codePoint >= start && codePoint <= end);

const subsetsByFamily = new Map<FontFamily, FontSubset[]>();

/**
 * A family's subsets with their ranges parsed, once per process. A subset the
 * table names without a file of this weight is left out.
 */
const familySubsets = (family: FontFamily): FontSubset[] => {
  let subsets = subsetsByFamily.get(family);

  if (!subsets) {
    subsets = Object.entries(UNICODE_RANGES[family]).flatMap(([key, range]) => {
      const subset = key.replaceAll(/^\[|\]$/gu, "");

      const face =
        FACE_IMPORTS[family][
          `./${family}-${subset}-${FONT_WEIGHT}-normal.woff`
        ];

      return face
        ? [
            {
              face,
              name: `${family}-${subset}`,
              ranges: parseUnicodeRange(range),
            },
          ]
        : [];
    });
    subsetsByFamily.set(family, subsets);
  }

  return subsets;
};

interface LoadedFace {
  codePoints: ReadonlySet<number>;
  data: ArrayBuffer;
}

const loadedFaces = new Map<string, Promise<LoadedFace>>();

/**
 * A subset's bytes, as the `ArrayBuffer` `ImageResponse` takes, and the code
 * points it really draws. Each is read once per process: the module system
 * keeps the bytes anyway, and the map is the size of the subset.
 */
const loadFace = ({ face, name }: FontSubset): Promise<LoadedFace> => {
  let loaded = loadedFaces.get(name);

  if (!loaded) {
    loaded = face().then(({ default: bytes }) => ({
      codePoints: woffCodePoints(bytes),
      data: bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength
      ) as ArrayBuffer,
    }));
    loadedFaces.set(name, loaded);
  }

  return loaded;
};

export interface OpenGraphCardFonts {
  /** The faces to hand `ImageResponse`, in the order its `fontFamily` lists them. */
  fonts: OpenGraphCardFont[];
  /**
   * Each text as it can be drawn: a character no shipped face draws, such as
   * an emoji, is left out. `ImageResponse` would otherwise fetch a face or an
   * image for it from a CDN while the card renders, which a self-hosted
   * install cannot count on reaching.
   */
  texts: string[];
}

/**
 * The faces a card in `locale` needs for `texts`, and nothing more. Each
 * character is drawn from the first family in the locale's order that has a
 * glyph for it: the subset `unicode.json` files it under is read, and its own
 * character map says whether that glyph is there.
 */
export const loadOpenGraphCardFonts = async (
  locale: Locale,
  texts: readonly string[]
): Promise<OpenGraphCardFonts> => {
  const families = FAMILIES_BY_LOCALE[locale].map(familySubsets);

  const faceFor = async (
    codePoint: number
  ): Promise<FontSubset | undefined> => {
    for (const subsets of families) {
      const subset = subsets.find(({ ranges }) => inRanges(ranges, codePoint));

      if (!subset) {
        continue;
      }

      // Sequential on purpose: a later family is read only where every
      // earlier one lacks the glyph.
      // oxlint-disable-next-line no-await-in-loop
      const { codePoints } = await loadFace(subset);

      if (codePoints.has(codePoint)) {
        return subset;
      }
    }

    return undefined;
  };

  const characters = [...new Set(texts.flatMap((text) => [...text]))];

  const faces = new Map(
    await Promise.all(
      characters.map(
        async (character) =>
          [character, await faceFor(character.codePointAt(0) ?? 0)] as const
      )
    )
  );

  const drawn = texts.map((text) =>
    [...text].filter((character) => faces.get(character)).join("")
  );

  // Ordered by family, so the `fontFamily` list puts the locale's own face
  // first for a character two of them draw.
  const used = new Set([...faces.values()].map((subset) => subset?.name));

  const fonts = await Promise.all(
    families.flat().flatMap((subset) =>
      used.has(subset.name)
        ? [
            loadFace(subset).then(({ data }): OpenGraphCardFont => ({
              data,
              name: subset.name,
              style: "normal",
              weight: FONT_WEIGHT,
            })),
          ]
        : []
    )
  );

  return { fonts, texts: drawn };
};
