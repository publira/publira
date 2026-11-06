import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";

import {
  checkSeriesImport,
  readSeriesImportPages,
  SERIES_IMPORT_MANIFEST_NAME,
  SERIES_IMPORT_MAX_EPISODE_PAGES,
} from "./series-import-manifest";
import type { SeriesImportProblem } from "./series-import-manifest";

const NOW = Temporal.Instant.from("2026-11-06T00:00:00Z");

const page = strToU8("page");

/** A manifest as a test writes it, right or wrong. */
interface Manifest {
  episodes?: object[];
  series?: object;
  version?: number;
  volumes?: object[];
}

const manifest = (overrides: Manifest = {}) => ({
  episodes: [
    { pages: ["ep01/002.png", "ep01/001.png"], title: "Episode 1" },
    { pages: ["ep02/001.jpg"], price: 500, title: "Episode 2" },
  ],
  series: { title: "A series" },
  version: 1,
  ...overrides,
});

const PAGES = {
  "ep01/001.png": page,
  "ep01/002.png": page,
  "ep02/001.jpg": page,
};

const zipOf = (json: Manifest, files: Record<string, Uint8Array> = PAGES) =>
  zipSync({
    ...files,
    [SERIES_IMPORT_MANIFEST_NAME]: strToU8(JSON.stringify(json)),
  });

const check = (zip: Uint8Array, seriesPublicId?: string) =>
  checkSeriesImport(zip, { currency: "JPY", now: NOW, seriesPublicId });

const problemsOf = (zip: Uint8Array, seriesPublicId?: string) => {
  const result = check(zip, seriesPublicId);

  return result.ok ? [] : result.problems;
};

/** The fields of one episode a test overrides, right or wrong. */
interface EpisodeOverrides {
  pages?: string[];
  price?: number;
  rental?: number;
  scheduled_at?: string;
  title?: string;
}

const withEpisode = (episode: EpisodeOverrides) =>
  manifest({ episodes: [{ pages: ["ep01/001.png"], title: "E", ...episode }] });

describe("checkSeriesImport", () => {
  it("plans a new series with its episodes in manifest order and pages in listed order", () => {
    const result = check(
      zipOf(
        manifest({
          series: {
            locale: "ja",
            reading_direction: "ltr",
            synopsis: "About it",
            title: "A series",
          },
        })
      )
    );

    expect(result).toEqual({
      ok: true,
      plan: {
        episodes: [
          {
            pages: [
              { bytes: 4, path: "ep01/002.png" },
              { bytes: 4, path: "ep01/001.png" },
            ],
            price: 0,
            scheduledAt: "",
            title: "Episode 1",
          },
          {
            pages: [{ bytes: 4, path: "ep02/001.jpg" }],
            price: 500,
            scheduledAt: "",
            title: "Episode 2",
          },
        ],
        target: {
          kind: "new",
          locale: "ja",
          readingDirection: "ltr",
          synopsis: "About it",
          title: "A series",
        },
      },
    });
  });

  it("targets an existing series by its id", () => {
    const result = check(zipOf(manifest({ series: { id: "SERIES001" } })));

    expect(result.ok && result.plan.target).toEqual({
      kind: "existing",
      publicId: "SERIES001",
    });
  });

  it("reads a price in the currency's own units", () => {
    const result = checkSeriesImport(zipOf(withEpisode({ price: 4.99 })), {
      currency: "USD",
      now: NOW,
    });

    expect(result.ok && result.plan.episodes[0]?.price).toBe(499);
  });

  it("reads a future scheduled_at into an instant", () => {
    const result = check(
      zipOf(withEpisode({ scheduled_at: "2030-01-01T00:00:00+09:00" }))
    );

    expect(result.ok && result.plan.episodes[0]?.scheduledAt).toBe(
      "2029-12-31T15:00:00Z"
    );
  });

  it.each<[string, Uint8Array, SeriesImportProblem[]]>([
    ["a file that is no ZIP", strToU8("no zip"), [{ code: "zip_invalid" }]],
    [
      "a ZIP without a manifest",
      zipSync({ "a.png": page }),
      [{ code: "manifest_missing" }],
    ],
    [
      "a manifest that is not JSON",
      zipSync({ [SERIES_IMPORT_MANIFEST_NAME]: strToU8("{") }),
      [{ code: "manifest_invalid" }],
    ],
    [
      "a version it does not read",
      zipOf(manifest({ version: 2 })),
      [{ code: "version_unsupported" }],
    ],
    [
      "an unknown key at the top",
      zipOf(manifest({ volumes: [] })),
      [{ code: "unknown_key", key: "volumes" }],
    ],
    [
      "an unknown key on the series",
      zipOf(manifest({ series: { genre: "x", title: "A" } })),
      [{ code: "series_unknown_key", key: "genre" }],
    ],
    [
      "a new series without a title",
      zipOf(manifest({ series: { synopsis: "x" } })),
      [{ code: "series_field_invalid", field: "title" }],
    ],
    [
      "an unknown key on an episode",
      zipOf(withEpisode({ rental: 1 })),
      [{ code: "episode_unknown_key", episode: "#1", key: "rental" }],
    ],
    [
      "an episode with no title",
      zipOf(withEpisode({ title: "" })),
      [{ code: "episode_field_invalid", episode: "#1", field: "title" }],
    ],
    [
      "a negative price",
      zipOf(withEpisode({ price: -1 })),
      [{ code: "episode_field_invalid", episode: "#1", field: "price" }],
    ],
    [
      "a price with more decimals than the currency has",
      zipOf(withEpisode({ price: 1.5 })),
      [{ code: "episode_field_invalid", episode: "E", field: "price" }],
    ],
    [
      "a scheduled_at without an offset",
      zipOf(withEpisode({ scheduled_at: "2030-01-01T00:00:00" })),
      [{ code: "episode_field_invalid", episode: "E", field: "scheduled_at" }],
    ],
    [
      "a scheduled_at that has passed",
      zipOf(withEpisode({ scheduled_at: "2026-11-01T00:00:00+09:00" })),
      [{ code: "scheduled_at_passed", episode: "E" }],
    ],
    [
      "an episode with no pages",
      zipOf(withEpisode({ pages: [] })),
      [{ code: "pages_required", episode: "E" }],
    ],
    [
      "a page not in the ZIP",
      zipOf(withEpisode({ pages: ["ep01/001.png", "nope.png"] })),
      [{ code: "page_missing", episode: "E", path: "nope.png" }],
    ],
    [
      "a path listed twice",
      zipOf(withEpisode({ pages: ["ep01/001.png", "ep01/001.png"] })),
      [{ code: "page_duplicated", episode: "E", path: "ep01/001.png" }],
    ],
    [
      "a page that is not an image",
      zipOf(withEpisode({ pages: ["notes.txt"] }), { "notes.txt": page }),
      [{ code: "page_not_image", episode: "E", path: "notes.txt" }],
    ],
    [
      "an empty page",
      zipOf(withEpisode({ pages: ["a.png"] }), { "a.png": new Uint8Array() }),
      [{ code: "page_unreadable", episode: "E", path: "a.png" }],
    ],
    [
      "a page over 20MB",
      zipOf(withEpisode({ pages: ["a.png"] }), {
        "a.png": new Uint8Array(20 * 1024 * 1024 + 1),
      }),
      [{ code: "page_too_large", episode: "E", path: "a.png" }],
    ],
  ])("refuses %s", (_name, zip, problems) => {
    expect(problemsOf(zip)).toEqual(problems);
  });

  it("refuses a path listed by two episodes, naming the second", () => {
    expect(
      problemsOf(
        zipOf(
          manifest({
            episodes: [
              { pages: ["ep01/001.png"], title: "One" },
              { pages: ["ep01/001.png"], title: "Two" },
            ],
          })
        )
      )
    ).toEqual([
      { code: "page_duplicated", episode: "Two", path: "ep01/001.png" },
    ]);
  });

  it("refuses more pages than an episode takes", () => {
    const pages = Array.from(
      { length: SERIES_IMPORT_MAX_EPISODE_PAGES + 1 },
      (_, index) => `p${index}.png`
    );

    expect(
      problemsOf(
        zipOf(
          withEpisode({ pages }),
          Object.fromEntries(pages.map((path) => [path, page]))
        )
      )
    ).toEqual([{ code: "pages_too_many", episode: "E" }]);
  });

  it("reports every problem it finds rather than the first", () => {
    expect(
      problemsOf(
        zipOf(
          manifest({
            episodes: [
              { pages: ["gone-1.png"], title: "One" },
              { pages: ["gone-2.png"], title: "Two" },
            ],
          })
        )
      )
    ).toEqual([
      { code: "page_missing", episode: "One", path: "gone-1.png" },
      { code: "page_missing", episode: "Two", path: "gone-2.png" },
    ]);
  });

  describe("on a series' episode list", () => {
    it("takes the manifest naming that series", () => {
      expect(
        check(zipOf(manifest({ series: { id: "SERIES001" } })), "SERIES001").ok
      ).toBe(true);
    });

    it("refuses another series and a new one", () => {
      const problem = [{ code: "series_mismatch" }];

      expect(
        problemsOf(zipOf(manifest({ series: { id: "OTHER" } })), "SERIES001")
      ).toEqual(problem);
      expect(problemsOf(zipOf(manifest()), "SERIES001")).toEqual(problem);
    });
  });
});

describe("readSeriesImportPages", () => {
  it("inflates only the pages asked for", () => {
    const zip = zipSync({
      "a.png": strToU8("page a"),
      "b.png": strToU8("page b"),
    });

    expect(
      Object.keys(readSeriesImportPages(zip, [{ bytes: 6, path: "b.png" }]))
    ).toEqual(["b.png"]);
  });
});
