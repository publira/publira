/**
 * Render the repository's images from the vector sources under `assets/`.
 *
 *     task images:gen
 *
 * Nothing in the stack renders SVG on the way in — a fixture is picked in a
 * file field and a body page is uploaded to object storage — so the raster is
 * committed too. Committing only the raster is what this replaces: a JPEG on
 * its own can be swapped but never edited, and its history records that some
 * bytes moved and nothing else.
 *
 * `assets/images.json` maps each source to the paths it renders to. One source
 * can have several, which is why the mapping is a file rather than a rule about
 * where an output sits relative to its source: the comic pages are the bodies
 * the development seed uploads.
 *
 * An output's size is the SVG's own `width` and `height` unless it names one,
 * so each image's dimensions stay where a reader can see them — the eye-catch
 * fixtures are named after theirs, and the console validates against them. A
 * named size is what lets one seed card cover every aspect ratio and delivery
 * width an eye-catch is served in without a source file per size; those cards
 * are drawn with `preserveAspectRatio="none"` so the ratio is the render's
 * decision rather than the drawing's.
 */

import { readFile, writeFile } from "node:fs/promises";

import sharp from "sharp";

/**
 * The encoder is picked from the output's extension.
 *
 * JPEG for everything a reader's browser and the console's upload field are
 * given: an upload is stored untouched and image-server converts from it.
 *
 * Full chroma resolution and mozjpeg's encoder, so the eye-catch cards survive
 * being cropped and re-encoded per aspect ratio without the suite comparing
 * subsampling artefacts. The quality is set where a 1050x1500 comic page lands
 * around 100 KB, the weight of a scanned page of that size: lighter pages would
 * quietly buy `e2e/tests/host.viewer-performance.spec.ts` headroom a real body
 * does not have.
 */
const JPEG = {
  chromaSubsampling: "4:4:4",
  mozjpeg: true,
  quality: 82,
} as const;

/**
 * PNG for the brand mark's icons, which keep their transparency. Truecolour
 * rather than a palette, so the bytes follow from the render alone and not from
 * a quantiser's choices.
 */
const PNG = {
  compressionLevel: 9,
  palette: false,
} as const;

const TRANSPARENT = { alpha: 0, b: 0, g: 0, r: 0 } as const;

/**
 * One output with a size of its own. `padding` draws the render smaller than
 * that size and `background` makes the rest opaque, for an icon a platform
 * would otherwise fill in itself: iOS paints a transparent `apple-touch-icon`
 * black and crops it to its own rounded square.
 */
interface SizedOutput {
  /** Any colour sharp accepts; the whole output is flattened onto it. */
  background?: string;
  height: number;
  /** Pixels between the drawing and each edge, taken from the named size. */
  padding?: number;
  path: string;
  width: number;
}

/**
 * One rendered file. A bare string is the path, rendered at the SVG's own
 * size; an object renders at the size it names instead.
 */
type ImageOutput = string | SizedOutput;

/** One entry of `assets/images.json`. */
interface ImageEntry {
  /**
   * Encoded as a single channel the way a scanned page would be. Line art
   * only: an eye-catch is colour.
   */
  monochrome?: boolean;
  /** Paths the render is written to, relative to the repository root. */
  outputs: ImageOutput[];
  /** The SVG to render, relative to `assets/`. */
  source: string;
}

const ROOT = new URL("../", import.meta.url);
const ASSETS = new URL("assets/", ROOT);

const manifest: ImageEntry[] = JSON.parse(
  await readFile(new URL("images.json", ASSETS), "utf-8")
);

const resize = (svg: Buffer, output: SizedOutput): sharp.Sharp => {
  const padding = output.padding ?? 0;
  // `fill` rather than a fitted resize: a card that names a size is drawn to
  // be stretched into it, and a fitted one would letterbox instead.
  const resized = sharp(svg).resize(
    output.width - padding * 2,
    output.height - padding * 2,
    { fit: "fill" }
  );
  const flattened =
    output.background === undefined
      ? resized
      : resized.flatten({ background: output.background });
  if (padding === 0) {
    return flattened;
  }
  return flattened.extend({
    background: output.background ?? TRANSPARENT,
    bottom: padding,
    left: padding,
    right: padding,
    top: padding,
  });
};

const encode = (pipeline: sharp.Sharp, path: string): sharp.Sharp => {
  if (path.endsWith(".png")) {
    return pipeline.png(PNG);
  }
  if (path.endsWith(".jpg")) {
    return pipeline.jpeg(JPEG);
  }
  throw new Error(`${path}: no encoder for this extension`);
};

const renderOutput = async (
  svg: Buffer,
  entry: ImageEntry,
  output: ImageOutput
): Promise<string> => {
  const path = typeof output === "string" ? output : output.path;
  const pipeline =
    typeof output === "string" ? sharp(svg) : resize(svg, output);
  const image = await encode(
    entry.monochrome ? pipeline.toColourspace("b-w") : pipeline,
    path
  ).toBuffer();
  await writeFile(new URL(path, ROOT), image);
  return `${path} (${image.length} bytes)`;
};

const renderEntry = async (entry: ImageEntry): Promise<string[]> => {
  const svg = await readFile(new URL(entry.source, ASSETS));
  return await Promise.all(
    entry.outputs.map((output) => renderOutput(svg, entry, output))
  );
};

const rendered = await Promise.all(manifest.map(renderEntry));
for (const line of rendered.flat()) {
  console.log(line);
}
