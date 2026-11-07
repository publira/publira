import { getLocales } from "@publira/i18n";
import type { Locale } from "@publira/i18n";
import { unzipSync } from "fflate";
import { z } from "zod";

import { EPISODE_PAGE_IMAGE_MAX_BYTES } from "./episode-pages-upload";
import { MAX_INT32 } from "./int32";
import type { AdminClientMessageAccessor } from "./messages";
import { parsePriceInput } from "./price";
import {
  DEFAULT_READING_DIRECTION,
  READING_DIRECTIONS,
} from "./reading-layout";
import type { ReadingDirectionValue } from "./reading-layout";

/**
 * Where the import from a ZIP is posted. It is a Route Handler left out of
 * `proxy.ts` for the reason `EPISODE_PAGES_UPLOAD_PATH` is, and it takes the
 * same limit on the body.
 */
export const SERIES_IMPORT_PATH = "/api/v1/series-import";

/**
 * The largest request body the import takes. It is unpacked here and goes up in
 * several `UploadEpisodeImages`, so it can be larger than one upload; the
 * screen's help text and the refusal state it as 256MB.
 */
export const SERIES_IMPORT_MAX_BYTES = 256 * 1024 * 1024;

/** The file at the root of the ZIP that says what to import. */
export const SERIES_IMPORT_MANIFEST_NAME = "publira-import.json";

/** The manifest versions this console reads. */
const SERIES_IMPORT_MANIFEST_VERSION = 1;

/** The most pages one episode may list, as an archive upload takes. */
export const SERIES_IMPORT_MAX_EPISODE_PAGES = 1000;

/**
 * Well past a manifest listing every page a 256 MiB ZIP can hold, and a bound
 * on what a small ZIP can make the screen and the route inflate and parse.
 */
const MANIFEST_MAX_BYTES = 1024 * 1024;

const PAGE_CONTENT_TYPES = new Map([
  ["gif", "image/gif"],
  ["jpeg", "image/jpeg"],
  ["jpg", "image/jpeg"],
  ["png", "image/png"],
  ["webp", "image/webp"],
]);

const COMPRESSION_STORED = 0;
const COMPRESSION_DEFLATE = 8;

/** The fixed part of a central directory header, the least an entry takes. */
const ZIP_CENTRAL_HEADER_MIN_BYTES = 46;

/** The compression methods `fflate` reads. */
const READABLE_COMPRESSIONS = new Set([
  COMPRESSION_STORED,
  COMPRESSION_DEFLATE,
]);

/** One page to send, with the most bytes reading its ZIP entry yields. */
export interface SeriesImportPage {
  bytes: number;
  path: string;
}

export interface SeriesImportEpisode {
  pages: SeriesImportPage[];
  /** In the minor unit of the tenant's currency. */
  price: number;
  /** An instant, or empty for a draft. */
  scheduledAt: string;
  title: string;
}

export type SeriesImportTarget =
  | { kind: "existing"; publicId: string }
  | {
      kind: "new";
      /** Absent writes the tenant's default language. */
      locale?: Locale;
      readingDirection: ReadingDirectionValue;
      synopsis: string;
      title: string;
    };

export interface SeriesImportPlan {
  episodes: SeriesImportEpisode[];
  target: SeriesImportTarget;
}

/** What is wrong with a ZIP, named so the operator can find it. */
export type SeriesImportProblem =
  | { code: "episodes_required" }
  | { code: "manifest_duplicated" }
  | { code: "manifest_invalid" }
  | { code: "manifest_missing" }
  | { code: "manifest_too_large" }
  | { code: "series_mismatch" }
  | { code: "series_required" }
  | { code: "version_unsupported" }
  | { code: "zip_invalid" }
  | { code: "episode_field_invalid"; episode: string; field: string }
  | { code: "episode_unknown_key"; episode: string; key: string }
  | { code: "page_duplicated"; episode: string; path: string }
  | { code: "page_missing"; episode: string; path: string }
  | { code: "page_not_image"; episode: string; path: string }
  | { code: "page_too_large"; episode: string; path: string }
  | { code: "page_unreadable"; episode: string; path: string }
  | { code: "pages_required"; episode: string }
  | { code: "pages_too_many"; episode: string }
  | { code: "scheduled_at_passed"; episode: string }
  | { code: "series_field_invalid"; field: string }
  | { code: "series_unknown_key"; key: string }
  | { code: "unknown_key"; key: string };

export type SeriesImportCheck =
  | { ok: true; plan: SeriesImportPlan }
  | { ok: false; problems: SeriesImportProblem[] };

interface ZipEntry {
  compression: number;
  /** Set when the ZIP holds two entries of this name. */
  duplicated: boolean;
  /** The most bytes `fflate` returns for it, which every limit is held to. */
  size: number;
}

/** Reads the entries from the central directory, inflating none of them. */
const listZipEntries = (zip: Uint8Array): Map<string, ZipEntry> | null => {
  const entries = new Map<string, ZipEntry>();
  // `fflate` walks the count the ZIP states, up to 32 bits of it, past the end
  // of the data if that is where the count leads. Stopping here keeps the walk
  // to what the ZIP's length explains.
  let entriesLeft = Math.floor(zip.length / ZIP_CENTRAL_HEADER_MIN_BYTES);

  try {
    unzipSync(zip, {
      filter: ({ compression, name, originalSize, size }) => {
        if (entriesLeft === 0) {
          throw new Error("The ZIP states more entries than it can hold.");
        }

        entriesLeft -= 1;

        entries.set(name, {
          compression,
          duplicated: entries.has(name),
          // `fflate` copies a stored entry at its compressed size whatever size
          // it states, and entries of one ZIP can share the same bytes, so the
          // ZIP's own length does not bound that copy either.
          size: compression === COMPRESSION_STORED ? size : originalSize,
        });

        return false;
      },
    });
  } catch {
    return null;
  }

  return entries;
};

const readManifestJson = (
  zip: Uint8Array,
  entries: ReadonlyMap<string, ZipEntry>
): { json: unknown } | { problem: SeriesImportProblem } => {
  const entry = entries.get(SERIES_IMPORT_MANIFEST_NAME);

  if (!entry) {
    return { problem: { code: "manifest_missing" } };
  }

  // The filter below takes every entry of this name, and `entry` is only the
  // last of them, so nothing has held the others to the limit.
  if (entry.duplicated) {
    return { problem: { code: "manifest_duplicated" } };
  }

  if (entry.size > MANIFEST_MAX_BYTES) {
    return { problem: { code: "manifest_too_large" } };
  }

  try {
    const bytes = unzipSync(zip, {
      filter: ({ name }) => name === SERIES_IMPORT_MANIFEST_NAME,
    })[SERIES_IMPORT_MANIFEST_NAME];

    return { json: JSON.parse(new TextDecoder().decode(bytes)) };
  } catch {
    return { problem: { code: "manifest_invalid" } };
  }
};

const manifestSchema = z.strictObject({
  episodes: z.array(z.unknown()),
  series: z.record(z.string(), z.unknown()),
  version: z.number(),
});

const existingSeriesSchema = z.strictObject({
  id: z.string().trim().min(1),
});

const newSeriesSchema = z.strictObject({
  locale: z.enum(getLocales()).optional(),
  reading_direction: z.enum(READING_DIRECTIONS).optional(),
  synopsis: z.string().trim().optional(),
  title: z.string().trim().min(1),
});

const episodeSchema = z.strictObject({
  pages: z.array(z.string()),
  price: z.number().nonnegative().optional(),
  scheduled_at: z.string().optional(),
  title: z.string().trim().min(1),
});

/** Sorts one schema's issues into the keys it does not know and the fields it refuses. */
const sortIssues = (issues: readonly z.core.$ZodIssue[]) => ({
  fields: [
    ...new Set(
      issues.flatMap((issue) =>
        issue.code === "unrecognized_keys" ? [] : [String(issue.path[0] ?? "")]
      )
    ),
  ],
  keys: issues.flatMap((issue) =>
    issue.code === "unrecognized_keys" ? issue.keys : []
  ),
});

const planTarget = (
  series: z.output<typeof manifestSchema>["series"],
  seriesPublicId: string | undefined
): { target: SeriesImportTarget } | { problems: SeriesImportProblem[] } => {
  const schema = "id" in series ? existingSeriesSchema : newSeriesSchema;

  if (seriesPublicId !== undefined && !("id" in series)) {
    return { problems: [{ code: "series_mismatch" }] };
  }

  const parsed = schema.safeParse(series);

  if (!parsed.success) {
    const { fields, keys } = sortIssues(parsed.error.issues);

    return {
      problems: [
        ...keys.map((key) => ({ code: "series_unknown_key" as const, key })),
        ...fields.map((field) => ({
          code: "series_field_invalid" as const,
          field,
        })),
      ],
    };
  }

  if ("id" in parsed.data) {
    return seriesPublicId !== undefined && parsed.data.id !== seriesPublicId
      ? { problems: [{ code: "series_mismatch" }] }
      : { target: { kind: "existing", publicId: parsed.data.id } };
  }

  return {
    target: {
      kind: "new",
      locale: parsed.data.locale,
      readingDirection:
        parsed.data.reading_direction ?? DEFAULT_READING_DIRECTION,
      synopsis: parsed.data.synopsis ?? "",
      title: parsed.data.title,
    },
  };
};

const readPrice = (price: number, currency: string): number | null => {
  const amount = parsePriceInput(String(price), currency);

  return amount !== null && amount <= MAX_INT32 ? amount : null;
};

/**
 * The instant to schedule an episode for, or why it cannot be. A time that has
 * passed would publish the episode and tell its followers as soon as its pages
 * are in, which a manifest that asks for a schedule did not ask for.
 */
const readScheduledAt = (
  value: string,
  now: Temporal.Instant
): { instant: string } | { problem: "invalid" | "passed" } => {
  let instant: Temporal.Instant;

  try {
    instant = Temporal.Instant.from(value);
  } catch {
    return { problem: "invalid" };
  }

  return Temporal.Instant.compare(instant, now) > 0
    ? { instant: instant.toString() }
    : { problem: "passed" };
};

const pageExtension = (path: string): string =>
  path.slice(path.lastIndexOf(".") + 1).toLowerCase();

/** The content type of a page, read from its path. */
export const seriesImportPageContentType = (path: string): string =>
  PAGE_CONTENT_TYPES.get(pageExtension(path)) ?? "application/octet-stream";

const checkPage = (
  path: string,
  episode: string,
  entry: ZipEntry | undefined,
  seen: ReadonlySet<string>
): SeriesImportProblem | null => {
  if (seen.has(path) || entry?.duplicated) {
    return { code: "page_duplicated", episode, path };
  }

  if (!entry) {
    return { code: "page_missing", episode, path };
  }

  if (!PAGE_CONTENT_TYPES.has(pageExtension(path))) {
    return { code: "page_not_image", episode, path };
  }

  if (entry.size > EPISODE_PAGE_IMAGE_MAX_BYTES) {
    return { code: "page_too_large", episode, path };
  }

  if (entry.size === 0 || !READABLE_COMPRESSIONS.has(entry.compression)) {
    return { code: "page_unreadable", episode, path };
  }

  return null;
};

interface PlannedEpisode {
  /** Absent when `problems` lists why it cannot be imported. */
  episode?: SeriesImportEpisode;
  problems: SeriesImportProblem[];
}

const planEpisode = (
  parsed: ReturnType<typeof episodeSchema.safeParse>,
  index: number,
  context: {
    currency: string;
    entries: ReadonlyMap<string, ZipEntry>;
    now: Temporal.Instant;
    seen: Set<string>;
  }
): PlannedEpisode => {
  const named = parsed.success ? parsed.data.title : `#${index + 1}`;

  if (!parsed.success) {
    const { fields, keys } = sortIssues(parsed.error.issues);

    return {
      problems: [
        ...keys.map((key) => ({
          code: "episode_unknown_key" as const,
          episode: named,
          key,
        })),
        ...fields.map((field) => ({
          code: "episode_field_invalid" as const,
          episode: named,
          field,
        })),
      ],
    };
  }

  const { pages, price, scheduled_at: scheduledAt, title } = parsed.data;
  const problems: SeriesImportProblem[] = [];
  const amount = readPrice(price ?? 0, context.currency);

  if (amount === null) {
    problems.push({
      code: "episode_field_invalid",
      episode: title,
      field: "price",
    });
  }

  const schedule =
    scheduledAt === undefined
      ? { instant: "" }
      : readScheduledAt(scheduledAt, context.now);

  if ("problem" in schedule) {
    problems.push(
      schedule.problem === "passed"
        ? { code: "scheduled_at_passed", episode: title }
        : {
            code: "episode_field_invalid",
            episode: title,
            field: "scheduled_at",
          }
    );
  }

  if (pages.length === 0) {
    problems.push({ code: "pages_required", episode: title });
  }

  if (pages.length > SERIES_IMPORT_MAX_EPISODE_PAGES) {
    problems.push({ code: "pages_too_many", episode: title });
  }

  const planned: SeriesImportPage[] = [];

  for (const path of pages) {
    const entry = context.entries.get(path);
    const problem = checkPage(path, title, entry, context.seen);

    context.seen.add(path);

    if (problem) {
      problems.push(problem);
    } else if (entry) {
      planned.push({ bytes: entry.size, path });
    }
  }

  return problems.length > 0 || amount === null || "problem" in schedule
    ? { problems }
    : {
        episode: {
          pages: planned,
          price: amount,
          scheduledAt: schedule.instant,
          title,
        },
        problems,
      };
};

/**
 * Checks a ZIP against its manifest, and what to do with it when nothing is
 * wrong. The screen runs this before it sends anything, and the route again
 * before it creates anything, since a request need not have come from the
 * screen.
 *
 * Only the manifest is inflated. A page is judged by what the central
 * directory says of it, and that is not trusted past this:
 * `readSeriesImportPages` cannot get more from an entry than the size kept.
 */
export const checkSeriesImport = (
  zip: Uint8Array,
  options: {
    /** The tenant's, which a `price` is written in. */
    currency: string;
    /** Set on a series' episode list: the only series this import may add to. */
    seriesPublicId?: string;
    now?: Temporal.Instant;
  }
): SeriesImportCheck => {
  const entries = listZipEntries(zip);

  if (!entries) {
    return { ok: false, problems: [{ code: "zip_invalid" }] };
  }

  const manifest = readManifestJson(zip, entries);

  if ("problem" in manifest) {
    return { ok: false, problems: [manifest.problem] };
  }

  const parsed = manifestSchema.safeParse(manifest.json);

  if (!parsed.success) {
    const { fields, keys } = sortIssues(parsed.error.issues);

    const problems: SeriesImportProblem[] = [
      ...keys.map((key) => ({ code: "unknown_key" as const, key })),
      ...fields.flatMap((field): SeriesImportProblem[] => {
        if (field === "series") {
          return [{ code: "series_required" }];
        }

        return [
          field === "episodes"
            ? { code: "episodes_required" }
            : { code: "manifest_invalid" },
        ];
      }),
    ];

    return { ok: false, problems };
  }

  const { episodes, series, version } = parsed.data;

  if (version !== SERIES_IMPORT_MANIFEST_VERSION) {
    return { ok: false, problems: [{ code: "version_unsupported" }] };
  }

  const target = planTarget(series, options.seriesPublicId);

  const problems: SeriesImportProblem[] =
    "problems" in target ? [...target.problems] : [];

  if (episodes.length === 0) {
    problems.push({ code: "episodes_required" });
  }

  const context = {
    currency: options.currency,
    entries,
    now: options.now ?? Temporal.Now.instant(),
    seen: new Set<string>(),
  };

  const planned = episodes.map((episode, index) =>
    planEpisode(episodeSchema.safeParse(episode), index, context)
  );

  problems.push(...planned.flatMap((episode) => episode.problems));

  if (problems.length > 0 || "problems" in target) {
    return { ok: false, problems };
  }

  return {
    ok: true,
    plan: {
      episodes: planned.flatMap(({ episode }) => (episode ? [episode] : [])),
      target: target.target,
    },
  };
};

/**
 * Inflates the named pages of a checked ZIP.
 *
 * A deflated entry goes into a buffer of the size it states and a stored one
 * is copied at its compressed size, and those are the sizes the check held to
 * one page's limit and the batches add up, so no entry can yield more than
 * that.
 */
export const readSeriesImportPages = (
  zip: Uint8Array,
  pages: readonly SeriesImportPage[]
): Record<string, Uint8Array> => {
  const paths = new Set(pages.map((page) => page.path));

  return unzipSync(zip, { filter: ({ name }) => paths.has(name) });
};

/** One line of copy for a problem, on the screen and from the route alike. */
export const seriesImportProblemText = (
  t: AdminClientMessageAccessor,
  problem: SeriesImportProblem
): string =>
  t(`admin.series.import.problem.${problem.code}`, {
    ...problem,
    count: SERIES_IMPORT_MAX_EPISODE_PAGES,
  });

/** The outcome of one episode of the manifest, in its order. */
export interface SeriesImportRow {
  /** Set once the episode exists, so a failed row can link to what is left. */
  episodePublicId?: string;
  /** Why the row failed. */
  message?: string;
  pageCount: number;
  /** Its place in the manifest, from 1. */
  position: number;
  status: "failed" | "imported" | "not_started";
  title: string;
}

/**
 * What the route answers. `problems` lists why nothing was created; `rows` is
 * set once the import ran, however far it got, and `seriesPublicId` is the
 * series it ran on.
 */
export interface SeriesImportResponse {
  location?: string;
  message: string;
  ok: boolean;
  problems?: string[];
  rows?: SeriesImportRow[];
  seriesPublicId?: string;
}
