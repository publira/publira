import type { Locale } from "@publira/i18n";

import { isUnauthenticatedError } from "./admin-auth-shared";
import {
  createEpisode,
  updateEpisodePublishSchedule,
  uploadEpisodePages,
} from "./episode";
import { EPISODE_PAGES_UPLOAD_MAX_BYTES } from "./episode-pages-upload";
import { getMessagesFor } from "./messages";
import type { AdminMessageAccessor } from "./messages";
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
 * The pages in order, cut into runs one upload can carry. An episode over that
 * goes up in several calls, each adding its pages after the last, so the limit
 * an import states is the size of its ZIP alone.
 */
export const batchSeriesImportPages = (
  pages: readonly SeriesImportPage[],
  maxBytes = EPISODE_PAGES_UPLOAD_MAX_BYTES
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
  t: AdminMessageAccessor;
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

/**
 * Creates one episode as a draft, sends its pages, and only then gives it its
 * publication time. A time given to `CreateEpisode` would be in force while the
 * pages are on their way, so one falling due during the import, or an upload
 * that fails, would put an episode without all its pages in front of readers.
 *
 * Whatever goes wrong, thrown or answered, is returned as the row: once the
 * episode exists the row has to name it, since a rerun of the manifest with
 * that episode still in it would create it a second time.
 */
const importEpisode = async (
  episode: SeriesImportEpisode,
  position: number,
  series: { id: string; readingPeriodHours: number },
  context: SeriesImportContext
): Promise<SeriesImportRow> => {
  const { currency, locale, t, tenantId, translationLocale, zip } = context;

  let row: SeriesImportRow = {
    pageCount: episode.pages.length,
    position,
    status: "failed",
    title: episode.title,
  };

  try {
    const created = await createEpisode(
      {
        availability: "",
        currency,
        previewPageCount: 0,
        price: episode.price,
        publishAt: "",
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

    row = { ...row, episodePublicId: created.episode.publicId };

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
        return { ...row, message: uploaded.message };
      }
    }

    if (episode.scheduledAt) {
      const scheduled = await updateEpisodePublishSchedule(
        {
          episodeId: created.episode.id,
          publishAt: episode.scheduledAt,
          tenantId,
        },
        locale
      );

      if (!scheduled.ok) {
        return { ...row, message: scheduled.message };
      }
    }
  } catch (error) {
    if (isUnauthenticatedError(error)) {
      return { ...row, message: t("errors.rpc.unauthenticated") };
    }

    // Not rethrown, unlike any other unclassified error: by now the series or
    // an episode exists, and the rows are the only account of which. The
    // answer keeps them and the error goes to the log.
    console.error("[web-admin] series import stopped", error);

    return { ...row, message: t("admin.series.import.episode_failed") };
  }

  return { ...row, status: "imported" };
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
    t: await getMessagesFor(input.locale),
    translationLocale:
      plan.target.kind === "new" ? plan.target.locale : undefined,
  };

  const resolved = await resolveSeries(plan, context);

  if (!resolved.ok) {
    return resolved;
  }

  const { series } = resolved;
  const rows: SeriesImportRow[] = [];
  let stopped = false;

  for (const [index, episode] of plan.episodes.entries()) {
    const position = index + 1;

    if (stopped) {
      rows.push({
        pageCount: episode.pages.length,
        position,
        status: "not_started",
        title: episode.title,
      });
      continue;
    }

    // oxlint-disable-next-line no-await-in-loop, react-doctor/async-await-in-loop -- episodes are created in manifest order, and a failure stops the rest
    const row = await importEpisode(episode, position, series, context);

    rows.push(row);
    stopped = row.status === "failed";
  }

  return {
    ok: true as const,
    rows,
    seriesPublicId: series.publicId,
  };
};
