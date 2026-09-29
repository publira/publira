# Image sources

The vector originals of every JPEG this repository commits, and the map from each one to the paths it is rendered to.

| Path | What it holds |
| --- | --- |
| `eye-catch/<ratio>-<width>x<height>.svg` | One eye-catch card per aspect ratio the console accepts, at that ratio's minimum, plus a 2400x3200 card large enough for all four at once and a 600x800 card below the portrait minimum. Each is a different picture, so one delivered ratio can be told from another by its bytes. These are what the console's file field is given in `admin.eye-catch-upload.spec.ts`, not what the development seed stores |
| `seeds/` | Everything the development seed stores, one directory per kind of image it seeds, named after the object keys it lands at |
| `seeds/eye-catch/card-N.svg` | The eye-catch a series or a label is seeded with, five designs dealt round-robin over the catalogue. Each is drawn square with `preserveAspectRatio="none"` and stretched into every delivered ratio and width by the render, so one file covers twelve, and carries N dots so the design is identifiable in greyscale |
| `seeds/creator-icon/icon-N.svg` | The icon a creator is seeded with, five designs numbered the same way |
| `seeds/episode-page/page-NN.svg` | 1050x1500 monochrome comic body pages: panel frames, converging speed lines, a banded screentone, and a page number drawn as seven-segment rectangles so the render needs no font |
| `images.json` | `source` (relative to this directory) → `outputs` (relative to the repository root), with `monochrome` for the sources encoded as a single channel. An output is a path, or a `{ path, width, height }` when it is rendered at a size of its own |

```bash
task images:gen
```

Renders every entry with sharp, at the version the root `package.json` pins, into the paths `images.json` names. An output's size is the SVG's own `width` and `height` unless it names one of its own; `scripts/render-images.ts` holds the encoder settings and says why they are what they are.

Edit the SVG, run the task, and commit both — the render is reproducible, so a run on a clean tree leaves it clean and a JPEG that changes on its own is one somebody forgot to regenerate.

A source maps to a list rather than to one path because the same picture can serve more than one consumer, and to a sized output because one drawing can serve several delivered sizes. Redrawing a body page therefore moves whatever reads its output: today the `episode-comic-*` screenshot baselines and the bytes `e2e/tests/host.viewer-performance.spec.ts` measures the reader against, so re-record and re-measure in the same change. Redrawing a seed card moves every screenshot that photographs a shelf.

`db/seeds/objects/` is where the development seed's images land, and `task storage:seed` uploads exactly what is there — see [`db/seeds/README.md`](../db/seeds/README.md).
