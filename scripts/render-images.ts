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
 * where an output sits relative to its source: the comic pages are both the
 * E2E viewer fixtures and, once the development seed puts objects in storage,
 * the bodies that seed uploads.
 *
 * The output size is the SVG's own `width` and `height`, which keeps each
 * image's dimensions where a reader of the source can see them — the eye-catch
 * cards are named after theirs, and the console validates against them.
 */

import { readFile, writeFile } from "node:fs/promises";

import sharp from "sharp";

/**
 * JPEG, because that is what a reader's browser and the console's upload field
 * are given everywhere else: an upload is stored untouched and image-server
 * converts from it.
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

/** One entry of `assets/images.json`. */
interface ImageEntry {
  /**
   * Encoded as a single channel the way a scanned page would be. Line art
   * only: an eye-catch is colour.
   */
  monochrome?: boolean;
  /** Paths the render is written to, relative to the repository root. */
  outputs: string[];
  /** The SVG to render, relative to `assets/`. */
  source: string;
}

const ROOT = new URL("../", import.meta.url);
const ASSETS = new URL("assets/", ROOT);

const manifest: ImageEntry[] = JSON.parse(
  await readFile(new URL("images.json", ASSETS), "utf-8")
);

const renderEntry = async (entry: ImageEntry): Promise<string[]> => {
  const svg = await readFile(new URL(entry.source, ASSETS));
  const pipeline = sharp(svg);
  const jpeg = await (
    entry.monochrome ? pipeline.toColourspace("b-w") : pipeline
  )
    .jpeg(JPEG)
    .toBuffer();
  await Promise.all(
    entry.outputs.map((output) => writeFile(new URL(output, ROOT), jpeg))
  );
  return entry.outputs.map((output) => `${output} (${jpeg.length} bytes)`);
};

const rendered = await Promise.all(manifest.map(renderEntry));
for (const line of rendered.flat()) {
  console.log(line);
}
