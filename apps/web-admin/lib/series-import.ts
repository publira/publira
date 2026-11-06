import type { Locale } from "@publira/i18n";

import { isUnauthenticatedError } from "./admin-auth-shared";
import { createEpisode, uploadEpisodePages } from "./episode";
import { getMessagesFor } from "./messages";
import { DEFAULT_SPREAD_START_INDEX } from "./reading-layout";
import { createSeries, getSeriesForTenant } from "./series";
import {
  DEFAULT_SERIES_AGE_RATING,
  DEFAULT_SERIES_STATUS,
} from "./series-classification";
import {
  readSeriesImportPages,
  seriesImportPageContentType,
} from "./series-import-manifest";
import type {
  SeriesImportEpisode,
  SeriesImportPage,
  SeriesImportPlan,
  SeriesImportRow,
} from "./series-import-manifest";
import { DEFAULT_SURFACE_AVAILABILITY } from "./surface-availability";

/**
 * The most one `UploadEpisodeImages` carries (`episodeimages.MaxUploadBytes`).
 * An episode over it goes up in several calls, each adding its pages after the
 * last, so the limit an import states is the size of its ZIP alone.
 */
export const EPISODE_IMAGES_RPC_MAX_BYTES = 128 * 1024 * 1024;

/** The pages in order, cut into runs one upload can carry. */
export const batchSeriesImportPages = (
  pages: readonly SeriesImportPage[],
  maxBytes = EPISODE_IMAGES_RPC_MAX_BYTES
): SeriesImportPage[][] => {
  const batches: SeriesImportPage[][] = [];
  let batch: SeriesImportPage[] = [];
  let bytes = 0;

  for (const page of pages) {
    if (batch.length > 0 && bytes + page.bytes > maxBytes) {
      batches.push(batch);
      batch = [];
      bytes = 0;
    }

    batch.push(page);
    bytes += page.bytes;
  }

  if (batch.length > 0) {
    batches.push(batch);
  }

  return batches;
};

const pageFile = (path: string, data: Uint8Array) =>
  new File([new Uint8Array(data)], path.slice(path.lastIndexOf("/") + 1), {
    type: seriesImportPageContentType(path),
  });

interface SeriesImportContext {
  currency: string;
  locale: Locale;
  tenantId: string;
  /** The language the episodes' titles are written in. */
  translationLocale?: Locale;
  zip: Uint8Array;
}

/** The series the plan names, which the first step creates when it is new. */
const resolveSeries = (
  plan: SeriesImportPlan,
  { locale, tenantId }: SeriesImportContext
) => {
  const { target } = plan;

  if (target.kind === "existing") {
    return getSeriesForTenant({ publicId: target.publicId, tenantId }, locale);
  }

  return createSeries(
    {
      ageRating: DEFAULT_SERIES_AGE_RATING,
      availability: DEFAULT_SURFACE_AVAILABILITY,
      bundleDiscountPercent: 0,
      commentMode: "",
      creatorCredits: [],
      genreIds: [],
      isPublished: false,
      labelId: "",
      purchaseAvailability: "",
      readingDirection: target.readingDirection,
      readingPeriodHours: 0,
      rentalPeriodHours: 0,
      scheduleWeekdays: [],
      spreadStartIndex: DEFAULT_SPREAD_START_INDEX,
      status: DEFAULT_SERIES_STATUS,
      synopsis: target.synopsis,
      tagNames: [],
      tenantId,
      title: target.title,
      translationLocale: target.locale,
    },
    locale
  );
};

/** Creates one episode and sends its pages, stopping at the first failure. */
const importEpisode = async (
  episode: SeriesImportEpisode,
  position: number,
  series: { id: string; readingPeriodHours: number },
  context: SeriesImportContext
): Promise<SeriesImportRow> => {
  const { currency, locale, tenantId, translationLocale, zip } = context;

  const row: SeriesImportRow = {
    pageCount: episode.pages.length,
    position,
    status: "failed",
    title: episode.title,
  };

  const created = await createEpisode(
    {
      availability: "",
      currency,
      previewPageCount: 0,
      price: episode.price,
      publishAt: episode.scheduledAt,
      purchaseAvailability: "",
      readingPeriodHours: series.readingPeriodHours,
      rentalPeriodHours: 0,
      rentalPrice: 0,
      seriesId: series.id,
      tenantId,
      title: episode.title,
      translationLocale,
    },
    locale
  );

  if (!created.ok) {
    return { ...row, message: created.message };
  }

  const started = { ...row, episodePublicId: created.episode.publicId };

  for (const batch of batchSeriesImportPages(episode.pages)) {
    const inflated = readSeriesImportPages(zip, batch);

    // oxlint-disable-next-line no-await-in-loop, react-doctor/async-await-in-loop -- each batch adds its pages after the one before it
    const uploaded = await uploadEpisodePages(
      {
        episodeId: created.episode.id,
        pages: batch.map(({ path }) => pageFile(path, inflated[path])),
        tenantId,
      },
      locale
    );

    if (!uploaded.ok) {
      return { ...started, message: uploaded.message };
    }
  }

  return { ...started, status: "imported" };
};

/**
 * Runs a checked import: the series once, then each episode in manifest order.
 *
 * It is not atomic. Episodes are created in turn and the first failure stops
 * the rest, so the rows say how far it got; what was created stays, and a
 * rerun of the manifest without the finished episodes carries on from there.
 * A failure after the first episode is therefore a row rather than a throw,
 * since the rows are the only account of what now exists.
 *
 * A failure on the series itself leaves nothing behind and is answered as
 * `{ ok: false }`. An expired session there throws, as it does to any caller.
 */
export const runSeriesImport = async (
  plan: SeriesImportPlan,
  input: {
    currency: string;
    locale: Locale;
    tenantId: string;
    zip: Uint8Array;
  }
) => {
  const context: SeriesImportContext = {
    ...input,
    translationLocale:
      plan.target.kind === "new" ? plan.target.locale : undefined,
  };

  const resolved = await resolveSeries(plan, context);

  if (!resolved.ok) {
    return resolved;
  }

  const { series } = resolved;
  const t = await getMessagesFor(input.locale);
  const rows: SeriesImportRow[] = [];
  let stopped = false;

  for (const [index, episode] of plan.episodes.entries()) {
    const position = index + 1;

    const notImported = {
      pageCount: episode.pages.length,
      position,
      title: episode.title,
    };

    if (stopped) {
      rows.push({ ...notImported, status: "not_started" });
      continue;
    }

    try {
      // oxlint-disable-next-line no-await-in-loop, react-doctor/async-await-in-loop -- episodes are created in manifest order, and a failure stops the rest
      const row = await importEpisode(episode, position, series, context);

      rows.push(row);
      stopped = row.status === "failed";
    } catch (error) {
      rows.push({
        ...notImported,
        message: isUnauthenticatedError(error)
          ? t("errors.rpc.unauthenticated")
          : t("admin.series.import.episode_failed"),
        status: "failed",
      });
      stopped = true;
    }
  }

  return {
    ok: true as const,
    rows,
    seriesPublicId: series.publicId,
  };
};
