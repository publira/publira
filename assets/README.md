# Image sources

The vector originals of every JPEG this repository commits, and the map from each one to the paths it is rendered to.

| Path | What it holds |
| --- | --- |
| `comic-pages/page-NN.svg` | 1050x1500 monochrome comic body pages: panel frames, converging speed lines, a banded screentone, and a page number drawn as seven-segment rectangles so the render needs no font |
| `eye-catch/<ratio>-<width>x<height>.svg` | One eye-catch card per aspect ratio the console accepts, at that ratio's minimum, plus a 2400x3200 card large enough for all four at once and a 600x800 card below the portrait minimum. Each is a different picture, so one delivered ratio can be told from another by its bytes |
| `images.json` | `source` (relative to this directory) → `outputs` (relative to the repository root), with `monochrome` for the sources encoded as a single channel |

```bash
task images:gen
```

Renders every entry with sharp, at the version the root `package.json` pins, into the paths `images.json` names. The output size is the SVG's own `width` and `height`; `scripts/render-images.ts` holds the encoder settings and says why they are what they are.

Edit the SVG, run the task, and commit both — the render is reproducible, so a run on a clean tree leaves it clean and a JPEG that changes on its own is one somebody forgot to regenerate.

A source maps to a list rather than to one path because the same picture can serve more than one consumer. Redrawing a comic page therefore moves whatever reads its output: today the `episode-comic-*` screenshot baselines and the bytes `e2e/tests/host.viewer-performance.spec.ts` measures the reader against, so re-record and re-measure in the same change.
