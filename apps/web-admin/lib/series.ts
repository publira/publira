import type {
  GetSeriesResponse,
  SeriesCreatorCredit as SeriesCreatorCreditMessage,
} from "@publira/api-client/admin/series";
import {
  CommentMode,
  SeriesAgeRating,
  SeriesStatus,
} from "@publira/api-client/admin/types";
import type { Series } from "@publira/api-client/admin/types";
import { rpcErrorMessage } from "@publira/api-client/error-messages";
import {
  isMissingResourceRpcError,
  rethrowUnclassifiedRpcError,
} from "@publira/api-client/errors";
import { forEachPageWithToken } from "@publira/api-client/pagination";
import { toIntlLocale } from "@publira/i18n";
import type { Locale } from "@publira/i18n";
import { cacheTag } from "next/cache";

import {
  isUnauthenticatedError,
  rethrowUnauthenticatedRpcError,
} from "./admin-auth-shared";
import { apiClient, withSessionHeaders } from "./api";
import type { CropRect } from "./crop-rect";
import type { CursorPageOptions, CursorPageTokens } from "./cursor-page";
import {
  cursorPageRequest,
  cursorPageTokens,
  emptyCursorPageTokens,
} from "./cursor-page";
import {
  mentionsAspectImageRejection,
  mentionsImageRejection,
  mentionsStorageNotConfigured,
} from "./image-rejection";
import { getMessagesFor } from "./messages";
import type { PurchaseAvailabilityOverride } from "./purchase-availability";
import {
  READING_DIRECTION_ENUM,
  toReadingDirectionValue,
} from "./reading-direction-enum";
import {
  DEFAULT_READING_DIRECTION,
  DEFAULT_SPREAD_START_INDEX,
} from "./reading-layout";
import type { ReadingLayout } from "./reading-layout";
import {
  DEFAULT_SERIES_AGE_RATING,
  DEFAULT_SERIES_STATUS,
  SERIES_AGE_RATING_VALUES,
  SERIES_STATUS_VALUES,
} from "./series-classification";
import type {
  SeriesAgeRatingValue,
  SeriesStatusValue,
} from "./series-classification";
import { SERIES_COMMENT_MODES } from "./series-comment-mode";
import type { SeriesCommentMode } from "./series-comment-mode";
import { getAccessToken } from "./session";
import { DEFAULT_SURFACE_AVAILABILITY } from "./surface-availability";
import type { SurfaceAvailabilityValue } from "./surface-availability";
import {
  SURFACE_AVAILABILITY_ENUM,
  toSurfaceAvailabilityOverrideEnum,
  toSurfaceAvailabilityValue,
} from "./surface-availability-enum";

/**
 * The tag `getSeries()` caches one series under. Every Action that changes a
 * stored series clears it, which is what carries the change back to the screen
 * that submitted — the forms do not refresh the router themselves.
 */
export const seriesCacheTag = (tenantId: string, publicId: string): string =>
  `series-${tenantId}-${publicId}`;

/**
 * The tag the tenant's series lists are filed under. The tag above reaches one
 * series, so on its own it carries a save back to the form that submitted it
 * and leaves `/series` showing the row as it stood until the entry expired.
 */
export const seriesListCacheTag = (tenantId: string): string =>
  `series-list-${tenantId}`;

/**
 * One credit line of a series: who, and in what role. The pair is the identity
 * of a credit, which is why one person can appear twice under two roles and
 * never twice under the same one.
 */
export interface SeriesCreatorCredit {
  creatorPublicId: string;
  rolePublicId: string;
  /**
   * The share of each episode's sales this credit is baked onto new episodes
   * with, in basis points. 0 on a read that returns no credit records — the
   * list — which nothing posts a credit list back from.
   */
  shareBps: number;
}

export interface SeriesItem {
  publicId: string;
  title: string;
  synopsis: string;
  readingPeriodHours: number;
  publishedAt: string;
  labelPublicId: string;
  labelName: string;
  /**
   * In role priority order, then the order the editor gave within a role —
   * the order the API reads them back in and the order a credit list is shown
   * in everywhere.
   */
  creatorCredits: SeriesCreatorCredit[];
  isPublished: boolean;
  status: SeriesStatusValue;
  /**
   * The weekdays a new episode is expected, as `EXTRACT(DOW)` numbers: 0 is
   * Sunday and 6 is Saturday. Empty is the series keeping no weekly schedule,
   * which is a statement rather than a gap.
   */
  scheduleWeekdays: number[];
  ageRating: SeriesAgeRatingValue;
  /** In the tenant's genre order, which is the order the picker offers. */
  genrePublicIds: string[];
  tagNames: string[];
  eyeCatchImageVariants: {
    variantType: string;
    label: string;
    url: string;
    contentType: string;
    width: number;
    height: number;
    fileSizeBytes: number;
  }[];
  eyeCatchImageUpdatedAt: string;
  /** Which surfaces the series may be shown on, and every episode with it. */
  availability: SurfaceAvailabilityValue;
}

export type ListSeriesResult = CursorPageTokens &
  (
    | {
        ok: true;
        series: SeriesItem[];
        defaultReadingPeriodHours: number;
      }
    | {
        ok: false;
        message: string;
        series: SeriesItem[];
        defaultReadingPeriodHours: number;
        /** The API rejected the session — the page raises the login redirect. */
        requiresSignIn: boolean;
      }
  );

export type ListSeriesOptions = CursorPageOptions & {
  ageRating?: SeriesAgeRatingValue;
  status?: SeriesStatusValue;
};

export type CreateSeriesResult =
  | { ok: true; series: SeriesItem }
  | { ok: false; message: string };

export type UpdateSeriesResult =
  | { ok: true; series: SeriesItem }
  | { ok: false; message: string };

/**
 * `notFound: true` is the "there is nothing to show here" failure the edit
 * screen turns into `notFound()`. It carries no message: the screen is replaced
 * by `not-found.tsx`, and wording that distinguished a missing series from
 * another tenant's series would leak whether it exists.
 *
 * The flag exists because `getSeries()` runs inside a `"use cache: private"`
 * scope, where a thrown `notFound()` is not observable by the caller.
 * The interrupt has to be raised by the caller, outside the cache scope.
 */
export type GetSeriesResult =
  | {
      ok: true;
      series: SeriesItem;
      /**
       * The series' own comment mode, empty while it follows its tenant's. It
       * rides beside the series rather than in it because the API answers it
       * that way: `Series` is the message the storefront reads too, and there
       * the answer a page needs is the tenant and the series resolved
       * together.
       */
      commentMode: SeriesCommentMode;
      /**
       * The layout the series' episodes follow. It rides beside the series for
       * the reason the comment mode does: the API answers it beside `Series`.
       */
      readingLayout: ReadingLayout;
      /**
       * Where the series' episodes may be bought, empty while it follows its
       * tenant's default. It rides beside the series for the reason the
       * comment mode does.
       */
      purchaseAvailability: PurchaseAvailabilityOverride;
    }
  | { notFound: true; ok: false }
  | {
      message: string;
      notFound?: false;
      ok: false;
      /** The API rejected the session — the page raises the login redirect. */
      requiresSignIn?: boolean;
    };

const invalidArgumentMessage = async (
  error: unknown,
  locale: Locale
): Promise<string> => {
  const t = await getMessagesFor(locale);

  return mentionsImageRejection(error)
    ? t("admin.series.image_invalid")
    : t("admin.series.input_invalid");
};

const mapErrorToMessage = async (
  error: unknown,
  fallbackMessage: string,
  locale: Locale
): Promise<string> => {
  const t = await getMessagesFor(locale);

  return rpcErrorMessage(error, fallbackMessage, {
    locale,
    overrides: {
      "invalid-argument": await invalidArgumentMessage(error, locale),
      "not-found": t("admin.series.not_found"),
      precondition: mentionsStorageNotConfigured(error)
        ? t("admin.errors.storage_not_configured")
        : undefined,
    },
  });
};

/**
 * The generated `Series` fields {@link mapSeries} reads. Naming them against
 * the message type is what makes a proto rename fail here — a restated
 * structural type keeps compiling, and the mapper silently substitutes an empty
 * string for the field it can no longer find.
 */
type RawSeries = Pick<
  Series,
  | "ageRating"
  | "availability"
  | "creators"
  | "eyeCatchImageUpdatedAt"
  | "eyeCatchImageVariants"
  | "genres"
  | "isPublished"
  | "label"
  | "publicId"
  | "publishedAt"
  | "readingPeriodHours"
  | "scheduleWeekdays"
  | "status"
  | "synopsis"
  | "tags"
  | "title"
>;

/**
 * The proto enum each stored value stands for. One table per field, read in
 * both directions, so the two halves of the conversion cannot drift apart.
 */
const SERIES_STATUS_ENUM: Record<SeriesStatusValue, SeriesStatus> = {
  completed: SeriesStatus.COMPLETED,
  hiatus: SeriesStatus.HIATUS,
  ongoing: SeriesStatus.ONGOING,
};

const SERIES_AGE_RATING_ENUM: Record<SeriesAgeRatingValue, SeriesAgeRating> = {
  all: SeriesAgeRating.ALL,
  r15: SeriesAgeRating.R15,
  r18: SeriesAgeRating.R18,
};

/**
 * Unspecified is the one place the enum's zero value names something: a series
 * that states no mode of its own and so follows its tenant's, stored as no
 * value at all.
 */
const SERIES_COMMENT_MODE_ENUM: Record<SeriesCommentMode, CommentMode> = {
  "": CommentMode.UNSPECIFIED,
  approval_required: CommentMode.APPROVAL_REQUIRED,
  disabled: CommentMode.DISABLED,
  immediate: CommentMode.IMMEDIATE,
};

/**
 * Unspecified is the column default rather than a missing value — the API
 * documents a save that names no status as storing the default — so it reads
 * back as that default instead of as nothing.
 */
const toSeriesStatusValue = (
  status: SeriesStatus | undefined
): SeriesStatusValue =>
  SERIES_STATUS_VALUES.find((value) => SERIES_STATUS_ENUM[value] === status) ??
  DEFAULT_SERIES_STATUS;

const toSeriesAgeRatingValue = (
  ageRating: SeriesAgeRating | undefined
): SeriesAgeRatingValue =>
  SERIES_AGE_RATING_VALUES.find(
    (value) => SERIES_AGE_RATING_ENUM[value] === ageRating
  ) ?? DEFAULT_SERIES_AGE_RATING;

/**
 * Unspecified names the series following its tenant, so it reads back as the
 * empty value rather than as nothing — and so does a response that carried no
 * field at all, which is the same statement.
 *
 * A value naming none of the four is reported instead, the way an unresolvable
 * `tenant_config.comment_mode` is: the form would otherwise open on "follow the
 * tenant" and the next save would write that over the mode the series holds.
 */
const toSeriesCommentMode = (
  commentMode: CommentMode | undefined
): SeriesCommentMode | undefined => {
  if (commentMode === undefined) {
    return "";
  }
  return SERIES_COMMENT_MODES.find(
    (value) => SERIES_COMMENT_MODE_ENUM[value] === commentMode
  );
};

/**
 * A series always states a layout, so unspecified — which only a response that
 * carried no field at all can hold — reads back as the column default.
 *
 * A direction naming neither value is reported instead, for the reason an
 * unknown comment mode is: the form would open on the default and the next
 * save would write it over the direction the series holds.
 */
const toSeriesReadingLayout = (
  response: Partial<
    Pick<GetSeriesResponse, "readingDirection" | "spreadStartIndex">
  >
): ReadingLayout | undefined => {
  const readingDirection = toReadingDirectionValue(response.readingDirection);
  if (readingDirection === undefined) {
    return;
  }
  return {
    readingDirection: readingDirection || DEFAULT_READING_DIRECTION,
    spreadStartIndex: response.spreadStartIndex ?? DEFAULT_SPREAD_START_INDEX,
  };
};

const WEEKDAY_COUNT = 7;

type SeriesCreatorCreditRecord = Pick<
  SeriesCreatorCreditMessage,
  "creatorPublicId" | "rolePublicId" | "shareBps"
>;

const creditKey = (creatorPublicId: string, rolePublicId: string): string =>
  `${creatorPublicId}\u0000${rolePublicId}`;

/**
 * `creditRecords` is where the shares come from: `Creator` carries none,
 * because the storefront reads it too, so the reads that edit a series return
 * the records beside it.
 */
const mapSeries = (
  series: RawSeries,
  creditRecords: readonly SeriesCreatorCreditRecord[] = []
): SeriesItem => {
  const shares = new Map(
    creditRecords.map((record) => [
      creditKey(record.creatorPublicId.trim(), record.rolePublicId.trim()),
      record.shareBps,
    ])
  );
  return {
    ageRating: toSeriesAgeRatingValue(series.ageRating),
    // Unspecified is the column default, which the console's reads never
    // answer; a value naming none of the three is reported by `getSeries`.
    availability:
      toSurfaceAvailabilityValue(series.availability) ||
      DEFAULT_SURFACE_AVAILABILITY,
    creatorCredits: (series.creators ?? []).flatMap((creator) => {
      const creatorPublicId = creator.publicId.trim();
      // A credit written before roles existed states none. It is kept, so the
      // person stays credited and the form is where a role is chosen for them.
      const rolePublicId = creator.role?.publicId?.trim() ?? "";
      return creatorPublicId.length > 0
        ? [
            {
              creatorPublicId,
              rolePublicId,
              shareBps:
                shares.get(creditKey(creatorPublicId, rolePublicId)) ?? 0,
            },
          ]
        : [];
    }),
    eyeCatchImageUpdatedAt: series.eyeCatchImageUpdatedAt ?? "",
    eyeCatchImageVariants: (series.eyeCatchImageVariants ?? []).flatMap(
      (variant) => {
        const mappedVariant = {
          contentType: variant.contentType ?? "",
          fileSizeBytes: Number(variant.fileSizeBytes ?? 0),
          height: variant.height ?? 0,
          label: variant.label ?? "",
          url: variant.url ?? "",
          variantType: variant.variantType ?? "",
          width: variant.width ?? 0,
        };
        return mappedVariant.label.length > 0 && mappedVariant.url.length > 0
          ? [mappedVariant]
          : [];
      }
    ),
    genrePublicIds: (series.genres ?? []).flatMap((genre) => {
      const publicId = genre.publicId?.trim() ?? "";
      return publicId.length > 0 ? [publicId] : [];
    }),
    isPublished: series.isPublished ?? false,
    labelName: series.label?.name?.trim() ?? "",
    labelPublicId: series.label?.publicId?.trim() ?? "",
    publicId: series.publicId,
    publishedAt: series.publishedAt ?? "",
    readingPeriodHours: series.readingPeriodHours ?? 0,
    scheduleWeekdays: (series.scheduleWeekdays ?? []).filter(
      (weekday) =>
        Number.isInteger(weekday) && weekday >= 0 && weekday < WEEKDAY_COUNT
    ),
    status: toSeriesStatusValue(series.status),
    synopsis: series.synopsis,
    tagNames: (series.tags ?? []).flatMap((tag) => {
      const name = tag.name?.trim() ?? "";
      return name.length > 0 ? [name] : [];
    }),
    title: series.title,
  };
};

/**
 * One page of the tenant's series, newest first.
 *
 * The rows keep the server's keyset order (`created_at`, `id` descending).
 * Sorting them here would only sort the rows that happen to share a page, which
 * reads as a broken order as soon as the list spans more than one page.
 */
export const listSeries = async (
  tenantId: string,
  locale: Locale,
  options: ListSeriesOptions = {}
): Promise<ListSeriesResult> => {
  "use cache: private";
  cacheTag(seriesListCacheTag(tenantId));

  const [t, sessionId] = await Promise.all([
    getMessagesFor(locale),
    getAccessToken(),
  ]);
  if (!sessionId) {
    return {
      ...emptyCursorPageTokens,
      defaultReadingPeriodHours: 0,
      message: t("errors.rpc.unauthenticated"),
      ok: false,
      requiresSignIn: true,
      series: [],
    };
  }

  try {
    const response = await apiClient.series.listSeries(
      {
        ...cursorPageRequest(options),
        ...(options.ageRating
          ? { ageRating: SERIES_AGE_RATING_ENUM[options.ageRating] }
          : {}),
        ...(options.status
          ? { status: SERIES_STATUS_ENUM[options.status] }
          : {}),
        tenant: { tenantId },
      },
      withSessionHeaders(sessionId)
    );

    return {
      ...cursorPageTokens(response),
      defaultReadingPeriodHours: response.defaultReadingPeriodHours ?? 0,
      ok: true,
      series: (response.series ?? []).map((item) => mapSeries(item)),
    };
  } catch (error) {
    rethrowUnclassifiedRpcError(error);
    return {
      ...emptyCursorPageTokens,
      defaultReadingPeriodHours: 0,
      message: await mapErrorToMessage(
        error,
        t("admin.series.list_failed"),
        locale
      ),
      ok: false,
      requiresSignIn: isUnauthenticatedError(error),
      series: [],
    };
  }
};

/**
 * Every series in the tenant for combobox pickers (access-ticket form).
 *
 * Walks `ListSeries` cursor pages so the client-side Combobox can search
 * beyond a single RPC page. The `/series` list keeps {@link listSeries}
 * (one page) so list paging stays independent of picker loading.
 *
 * Sorted by title for readable search results. An incomplete walk (budget
 * exhausted or a repeated token) fails with an empty list rather than a
 * partial option set that would hide series beyond the rows already read.
 */
export const listAllSeries = async (
  tenantId: string,
  locale: Locale
): Promise<ListSeriesResult> => {
  "use cache: private";
  cacheTag(seriesListCacheTag(tenantId));

  const [t, sessionId] = await Promise.all([
    getMessagesFor(locale),
    getAccessToken(),
  ]);
  if (!sessionId) {
    return {
      ...emptyCursorPageTokens,
      defaultReadingPeriodHours: 0,
      message: t("errors.rpc.unauthenticated"),
      ok: false,
      requiresSignIn: true,
      series: [],
    };
  }

  try {
    const series: SeriesItem[] = [];
    let defaultReadingPeriodHours = 0;
    const walkStop = await forEachPageWithToken(
      async (token, limit) => {
        const response = await apiClient.series.listSeries(
          {
            limit,
            tenant: { tenantId },
            token,
          },
          withSessionHeaders(sessionId)
        );
        defaultReadingPeriodHours = response.defaultReadingPeriodHours ?? 0;
        return {
          items: response.series ?? [],
          nextToken: response.nextToken ?? "",
        };
      },
      (items) => {
        for (const item of items) {
          series.push(mapSeries(item));
        }
      }
    );

    // Match listAllCreators / episode reorder: never hand the form a partial
    // option list that operators treat as complete.
    if (walkStop !== "completed") {
      return {
        ...emptyCursorPageTokens,
        defaultReadingPeriodHours: 0,
        message: t("admin.series.list_failed"),
        ok: false,
        requiresSignIn: false,
        series: [],
      };
    }

    return {
      ...emptyCursorPageTokens,
      defaultReadingPeriodHours,
      ok: true,
      series: series.toSorted((a, b) =>
        a.title.localeCompare(b.title, toIntlLocale(locale))
      ),
    };
  } catch (error) {
    rethrowUnclassifiedRpcError(error);
    return {
      ...emptyCursorPageTokens,
      defaultReadingPeriodHours: 0,
      message: await mapErrorToMessage(
        error,
        t("admin.series.list_failed"),
        locale
      ),
      ok: false,
      requiresSignIn: isUnauthenticatedError(error),
      series: [],
    };
  }
};

export const getSeries = async (
  input: {
    tenantId: string;
    publicId: string;
  },
  locale: Locale
): Promise<GetSeriesResult> => {
  "use cache: private";
  cacheTag(seriesCacheTag(input.tenantId, input.publicId));

  const [t, sessionId] = await Promise.all([
    getMessagesFor(locale),
    getAccessToken(),
  ]);
  if (!sessionId) {
    return {
      message: t("errors.rpc.unauthenticated"),
      ok: false,
      requiresSignIn: true,
    };
  }

  try {
    const response = await apiClient.series.getSeries(
      {
        publicId: input.publicId,
        tenant: { tenantId: input.tenantId },
      },
      withSessionHeaders(sessionId)
    );

    if (!response.series?.publicId?.trim()) {
      return {
        message: t("admin.series.list_failed"),
        ok: false,
      };
    }

    const commentMode = toSeriesCommentMode(response.commentMode);
    const readingLayout = toSeriesReadingLayout(response);
    const purchaseAvailability = toSurfaceAvailabilityValue(
      response.purchaseAvailability
    );
    // An unknown availability would open the form on both surfaces, or on
    // following the tenant, and the next save would write that over the value
    // the series holds.
    if (
      commentMode === undefined ||
      readingLayout === undefined ||
      purchaseAvailability === undefined ||
      toSurfaceAvailabilityValue(response.series.availability) === undefined
    ) {
      return {
        message: t("admin.series.list_failed"),
        ok: false,
      };
    }

    return {
      commentMode,
      ok: true,
      purchaseAvailability,
      readingLayout,
      series: mapSeries(response.series, response.creatorCredits),
    };
  } catch (error) {
    rethrowUnclassifiedRpcError(error);
    if (isMissingResourceRpcError(error)) {
      return { notFound: true, ok: false };
    }
    return {
      message: await mapErrorToMessage(
        error,
        t("admin.series.list_failed"),
        locale
      ),
      ok: false,
      requiresSignIn: isUnauthenticatedError(error),
    };
  }
};

/**
 * The classification every save carries.
 *
 * Not optional, because `UpdateSeries` writes the whole listing row: a field
 * left out resets to the column default, so a form that omitted one would drop
 * the series' status or its genres every time somebody fixed a typo in the
 * title.
 */
interface SeriesClassificationInput {
  status: SeriesStatusValue;
  scheduleWeekdays: number[];
  ageRating: SeriesAgeRatingValue;
  genrePublicIds: string[];
  tagNames: string[];
}

/**
 * The comment mode every save carries, for the reason the classification is
 * carried: a save that left it out would put the series back on its tenant's
 * setting, so an editor fixing a typo would reopen commenting on a title that
 * had it turned off.
 */
interface SeriesCommentModeInput {
  commentMode: SeriesCommentMode;
}

/**
 * The layout every save carries: `UpdateSeries` stores the column default for
 * a direction or an index left out, so a save without it would turn a
 * left-to-right work back to right to left.
 */
type SeriesReadingLayoutInput = ReadingLayout;

export const createSeries = async (
  input: {
    tenantId: string;
    title: string;
    synopsis: string;
    readingPeriodHours: number;
    labelPublicId: string;
    creatorCredits: SeriesCreatorCredit[];
    isPublished: boolean;
    publishedAt?: string;
    eyeCatchImageContentType?: string;
    eyeCatchImageData?: Uint8Array;
    availability: SurfaceAvailabilityValue;
    /** The empty value follows the tenant's default. */
    purchaseAvailability: PurchaseAvailabilityOverride;
  } & SeriesClassificationInput &
    SeriesCommentModeInput &
    SeriesReadingLayoutInput,
  locale: Locale
): Promise<CreateSeriesResult> => {
  const [t, sessionId] = await Promise.all([
    getMessagesFor(locale),
    getAccessToken(),
  ]);
  if (!sessionId) {
    return {
      message: t("errors.rpc.unauthenticated"),
      ok: false,
    };
  }

  try {
    const response = await apiClient.series.createSeries(
      {
        ageRating: SERIES_AGE_RATING_ENUM[input.ageRating],
        availability: SURFACE_AVAILABILITY_ENUM[input.availability],
        commentMode: SERIES_COMMENT_MODE_ENUM[input.commentMode],
        creatorCredits: input.creatorCredits,
        eyeCatchImageContentType: input.eyeCatchImageContentType,
        eyeCatchImageData: input.eyeCatchImageData,
        genrePublicIds: input.genrePublicIds,
        isPublished: input.isPublished,
        labelPublicId: input.labelPublicId,
        publishedAt: input.publishedAt,
        purchaseAvailability: toSurfaceAvailabilityOverrideEnum(
          input.purchaseAvailability
        ),
        readingDirection: READING_DIRECTION_ENUM[input.readingDirection],
        readingPeriodHours: input.readingPeriodHours,
        scheduleWeekdays: input.scheduleWeekdays,
        spreadStartIndex: input.spreadStartIndex,
        status: SERIES_STATUS_ENUM[input.status],
        synopsis: input.synopsis,
        tagNames: input.tagNames,
        tenant: { tenantId: input.tenantId },
        title: input.title,
      },
      withSessionHeaders(sessionId)
    );

    if (!response.series?.publicId?.trim()) {
      return {
        message: t("admin.series.save_failed"),
        ok: false,
      };
    }

    return {
      ok: true,
      series: {
        ...mapSeries(response.series, response.creatorCredits),
        isPublished: input.isPublished,
      },
    };
  } catch (error) {
    rethrowUnauthenticatedRpcError(error);
    rethrowUnclassifiedRpcError(error);
    return {
      message: await mapErrorToMessage(
        error,
        t("admin.series.save_failed"),
        locale
      ),
      ok: false,
    };
  }
};

export const updateSeries = async (
  input: {
    tenantId: string;
    publicId: string;
    title: string;
    synopsis: string;
    readingPeriodHours: number;
    labelPublicId: string;
    creatorCredits: SeriesCreatorCredit[];
    isPublished: boolean;
    publishedAt?: string;
    clearEyeCatchImage?: boolean;
    eyeCatchImageContentType?: string;
    eyeCatchImageData?: Uint8Array;
    /**
     * Absent keeps the value stored, which is what the cover image tab
     * relies on: it saves the series without offering this choice.
     */
    availability?: SurfaceAvailabilityValue;
    /**
     * The empty value returns the series to following the tenant's default;
     * absent keeps the value stored, for the reason `availability` gives.
     */
    purchaseAvailability?: PurchaseAvailabilityOverride;
  } & SeriesClassificationInput &
    SeriesCommentModeInput &
    SeriesReadingLayoutInput,
  locale: Locale
): Promise<UpdateSeriesResult> => {
  const [t, sessionId] = await Promise.all([
    getMessagesFor(locale),
    getAccessToken(),
  ]);
  if (!sessionId) {
    return {
      message: t("errors.rpc.unauthenticated"),
      ok: false,
    };
  }

  try {
    const response = await apiClient.series.updateSeries(
      {
        ageRating: SERIES_AGE_RATING_ENUM[input.ageRating],
        availability:
          input.availability === undefined
            ? undefined
            : SURFACE_AVAILABILITY_ENUM[input.availability],
        clearEyeCatchImage: input.clearEyeCatchImage,
        commentMode: SERIES_COMMENT_MODE_ENUM[input.commentMode],
        creatorCredits: input.creatorCredits,
        eyeCatchImageContentType: input.eyeCatchImageContentType,
        eyeCatchImageData: input.eyeCatchImageData,
        genrePublicIds: input.genrePublicIds,
        isPublished: input.isPublished,
        labelPublicId: input.labelPublicId,
        publicId: input.publicId,
        publishedAt: input.publishedAt,
        purchaseAvailability:
          input.purchaseAvailability === undefined
            ? undefined
            : toSurfaceAvailabilityOverrideEnum(input.purchaseAvailability),
        readingDirection: READING_DIRECTION_ENUM[input.readingDirection],
        readingPeriodHours: input.readingPeriodHours,
        scheduleWeekdays: input.scheduleWeekdays,
        spreadStartIndex: input.spreadStartIndex,
        status: SERIES_STATUS_ENUM[input.status],
        synopsis: input.synopsis,
        tagNames: input.tagNames,
        tenant: { tenantId: input.tenantId },
        title: input.title,
      },
      withSessionHeaders(sessionId)
    );

    if (!response.series?.publicId?.trim()) {
      return {
        message: t("admin.series.save_failed"),
        ok: false,
      };
    }

    return {
      ok: true,
      series: {
        ...mapSeries(response.series, response.creatorCredits),
        isPublished: input.isPublished,
      },
    };
  } catch (error) {
    rethrowUnauthenticatedRpcError(error);
    rethrowUnclassifiedRpcError(error);
    return {
      message: await mapErrorToMessage(
        error,
        t("admin.series.save_failed"),
        locale
      ),
      ok: false,
    };
  }
};

export type SeriesEyeCatchAspectResult =
  | { ok: true; series: SeriesItem }
  /**
   * The API refused the image itself. It carries no message: the minimum to
   * name is the one of the ratio that was refused, and only the slot that
   * submitted knows which ratio that is and what size it asks for.
   */
  | { ok: false; imageRejected: true }
  | { ok: false; message: string };

/**
 * Replaces the image of one aspect ratio of the series eye-catch. The other
 * ratios keep the images they already hold, so the eye-catch has to exist
 * before one ratio can be swapped on its own.
 */
export const uploadSeriesEyeCatchAspectImage = async (
  input: {
    tenantId: string;
    publicId: string;
    variantType: string;
    imageContentType?: string;
    imageData: Uint8Array;
    /** Where in the upload the cut is taken; omitted, the API centres it. */
    crop?: CropRect;
  },
  locale: Locale
): Promise<SeriesEyeCatchAspectResult> => {
  const [t, sessionId] = await Promise.all([
    getMessagesFor(locale),
    getAccessToken(),
  ]);
  if (!sessionId) {
    return {
      message: t("errors.rpc.unauthenticated"),
      ok: false,
    };
  }

  try {
    const response = await apiClient.series.uploadSeriesEyeCatchAspectImage(
      {
        crop: input.crop,
        imageContentType: input.imageContentType,
        imageData: input.imageData,
        publicId: input.publicId,
        tenant: { tenantId: input.tenantId },
        variantType: input.variantType,
      },
      withSessionHeaders(sessionId)
    );

    if (!response.series?.publicId?.trim()) {
      return {
        message: t("admin.series.save_failed"),
        ok: false,
      };
    }

    return { ok: true, series: mapSeries(response.series) };
  } catch (error) {
    rethrowUnauthenticatedRpcError(error);
    rethrowUnclassifiedRpcError(error);
    if (mentionsAspectImageRejection(error)) {
      return { imageRejected: true, ok: false };
    }
    return {
      message: await mapErrorToMessage(
        error,
        t("admin.series.save_failed"),
        locale
      ),
      ok: false,
    };
  }
};
