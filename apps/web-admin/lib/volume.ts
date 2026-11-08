import type { AdminVolume } from "@publira/api-client/admin/types";
import { rpcErrorMessage } from "@publira/api-client/error-messages";
import type { RpcErrorMessageOverrides } from "@publira/api-client/error-messages";
import {
  rethrowUnclassifiedRpcError,
  rpcErrorDisposition,
  rpcErrorHasFieldViolation,
} from "@publira/api-client/errors";
import type { Locale } from "@publira/i18n";
import { dropFailedCacheEntry } from "@publira/utils/cached-read";
import { cacheTag } from "next/cache";

import {
  isUnauthenticatedError,
  rethrowUnauthenticatedRpcError,
} from "./admin-auth-shared";
import { apiClient, withSessionHeaders } from "./api";
import type { CachedRead } from "./cached-read";
import { settleCachedRead } from "./cached-read";
import { mentionsStorageNotConfigured } from "./image-rejection";
import { getMessagesFor } from "./messages";
import type { AdminMessageAccessor } from "./messages";
import { getAccessToken } from "./session";
import {
  bookstoreLinkFieldName,
  MAX_BOOKSTORE_LINK_LABEL_LENGTH,
  MAX_BOOKSTORE_LINK_URL_LENGTH,
  MAX_VOLUME_BOOKSTORE_LINKS,
} from "./volume-bookstore-links";

export interface VolumeItem {
  /** The primary key every volume write addresses the volume by. */
  id: string;
  /** What the volume's edit screen is addressed by in the URL. */
  publicId: string;
  title: string;
  /** In the minor unit of the tenant currency, as an episode's price is. */
  price: number;
  /** The episodes the volume holds, by id, in the volume's own order. */
  episodeIds: string[];
  /** Whether the volume is on sale now. */
  published: boolean;
  /**
   * When the volume was first put on sale, kept when it is taken off, and
   * empty for a volume never on sale. Once set, no episode can be taken out.
   */
  publishedAt: string;
  /** Where the volume's printed book is sold, in the volume's own order. */
  bookstoreLinks: { label: string; url: string }[];
  coverImageUpdatedAt: string;
  coverImageVariants: {
    variantType: string;
    label: string;
    url: string;
    contentType: string;
    width: number;
    height: number;
    fileSizeBytes: bigint;
  }[];
}

export type ListVolumesResult =
  | { ok: true; volumes: VolumeItem[] }
  | {
      ok: false;
      message: string;
      volumes: VolumeItem[];
      /** The API rejected the session — the page raises the login redirect. */
      requiresSignIn: boolean;
    };

/**
 * `notFound: true` is the "there is nothing to show here" failure the edit
 * screen turns into `notFound()`, carrying no message for the same reason
 * `GetCampaignBannerResult` carries none.
 */
export type GetVolumeResult =
  | { ok: true; volume: VolumeItem; volumes: VolumeItem[] }
  | { notFound: true; ok: false }
  | {
      message: string;
      notFound?: false;
      ok: false;
      /** The API rejected the session — the page raises the login redirect. */
      requiresSignIn: boolean;
    };

/**
 * What a refused write says of single fields, keyed by the field path the API
 * named, which is also the name the form gives the field's message.
 */
export type VolumeFieldErrors = Record<string, string>;

export type SaveVolumeResult =
  | { ok: true; volume: VolumeItem }
  | {
      ok: false;
      message: string;
      fieldErrors?: VolumeFieldErrors;
    };

export type ReorderVolumesResult =
  | { ok: true }
  | { ok: false; message: string };

/**
 * The tag every volume read of a series is filed under, and every write to
 * one of its volumes drops.
 */
export const volumesCacheTag = (tenantId: string, seriesId: string): string =>
  `volumes-${tenantId}-${seriesId}`;

/** The generated `AdminVolume` fields {@link mapVolume} reads. */
type RawVolume = Pick<
  AdminVolume,
  | "bookstoreLinks"
  | "coverImageUpdatedAt"
  | "coverImageVariants"
  | "episodeIds"
  | "id"
  | "price"
  | "publicId"
  | "published"
  | "publishedAt"
  | "title"
>;

const mapVolume = (volume: RawVolume): VolumeItem => ({
  bookstoreLinks: (volume.bookstoreLinks ?? []).map((link) => ({
    label: link.label ?? "",
    url: link.url ?? "",
  })),
  coverImageUpdatedAt: volume.coverImageUpdatedAt ?? "",
  coverImageVariants: (volume.coverImageVariants ?? []).flatMap((variant) => {
    const mappedVariant = {
      contentType: variant.contentType ?? "",
      fileSizeBytes: variant.fileSizeBytes ?? 0n,
      height: variant.height ?? 0,
      label: variant.label ?? "",
      url: variant.url ?? "",
      variantType: variant.variantType ?? "",
      width: variant.width ?? 0,
    };

    return mappedVariant.label.length > 0 && mappedVariant.url.length > 0
      ? [mappedVariant]
      : [];
  }),
  episodeIds: [...(volume.episodeIds ?? [])],
  id: volume.id ?? "",
  price: volume.price ?? 0,
  publicId: volume.publicId ?? "",
  published: volume.published ?? false,
  publishedAt: volume.publishedAt ?? "",
  title: volume.title ?? "",
});

/**
 * The wording of a refused create or update: the field the API named, or a
 * price entered in a currency the tenant no longer sells in.
 */
const saveOverrides = async (
  cause: unknown,
  locale: Locale
): Promise<RpcErrorMessageOverrides> => {
  const t = await getMessagesFor(locale);

  const invalidArgument = (): string => {
    if (rpcErrorHasFieldViolation(cause, "currency")) {
      return t("admin.series.episodes.currency_changed");
    }

    if (rpcErrorHasFieldViolation(cause, "title")) {
      return t("admin.series.volumes.validation.title_invalid");
    }

    if (rpcErrorHasFieldViolation(cause, "price")) {
      return t("admin.series.volumes.validation.price_invalid");
    }

    return t("errors.validation");
  };

  return {
    "invalid-argument": invalidArgument(),
    "not-found": t("admin.series.volumes.not_found"),
  };
};

const listVolumesForSession = async (
  input: { seriesId: string; tenantId: string },
  locale: Locale,
  sessionId: string
): Promise<CachedRead<ListVolumesResult>> => {
  "use cache: private";
  cacheTag(volumesCacheTag(input.tenantId, input.seriesId));

  const t = await getMessagesFor(locale);

  if (!sessionId) {
    dropFailedCacheEntry();

    return {
      message: t("errors.rpc.unauthenticated"),
      ok: false,
      requiresSignIn: true,
      volumes: [],
    };
  }

  try {
    const response = await apiClient.series.listVolumes(
      { seriesId: input.seriesId, tenant: { tenantId: input.tenantId } },
      withSessionHeaders(sessionId)
    );

    return {
      ok: true,
      volumes: (response.volumes ?? []).map((volume) => mapVolume(volume)),
    };
  } catch (error) {
    // A `"use cache"` scope cannot rethrow: the fill would fail the whole
    // request. The entry is dropped instead, so the list comes back as soon
    // as the API does, and an unexpected failure is thrown by the caller.
    dropFailedCacheEntry();

    return {
      message: rpcErrorMessage(error, t("admin.series.volumes.list_failed"), {
        locale,
        overrides: { "not-found": t("admin.series.volumes.series_not_found") },
      }),
      ok: false,
      requiresSignIn: isUnauthenticatedError(error),
      unexpected: rpcErrorDisposition(error) === "unexpected",
      volumes: [],
    };
  }
};

/**
 * Every volume of the series, unpublished ones included, in the series' order.
 *
 * The API caps a series at 100 volumes and answers them in one response,
 * which is also what lets a reorder post the whole order it was showing.
 *
 * Read with the operator's session: the API admits no service credential on
 * `ListVolumes`, so the read stays private to the operator.
 */
export const listVolumes = async (
  input: { seriesId: string; tenantId: string },
  locale: Locale
): Promise<ListVolumesResult> =>
  settleCachedRead(
    await listVolumesForSession(input, locale, await getAccessToken())
  );

/**
 * One volume of the series, for the screen it is edited on, beside the rest
 * of the series' volumes, which say which episodes are already taken.
 *
 * Picked out of {@link listVolumes}, which the console already reads whole and
 * files under the same tag, since the API has no RPC that reads one volume.
 */
export const getVolume = async (
  input: { publicId: string; seriesId: string; tenantId: string },
  locale: Locale
): Promise<GetVolumeResult> => {
  const result = await listVolumes(input, locale);

  if (!result.ok) {
    return {
      message: result.message,
      ok: false,
      requiresSignIn: result.requiresSignIn,
    };
  }

  const volume = result.volumes.find(
    (candidate) => candidate.publicId === input.publicId
  );

  return volume
    ? { ok: true, volume, volumes: result.volumes }
    : { notFound: true, ok: false };
};

/** What a create and an update both carry. */
interface VolumeFields {
  tenantId: string;
  title: string;
  price: number;
  /** The currency the price was entered in, which the API checks it against. */
  currency: string;
}

/**
 * Runs one volume write with the operator's session, and words its failure
 * with `fallback` and the screen's own `overrides`. A refusal `fieldErrors`
 * places on single fields is worded by the first of them, which is the one
 * the API stopped at.
 */
const writeVolume = async (
  locale: Locale,
  write: (sessionId: string) => Promise<{ volume?: RawVolume }>,
  failure: {
    fallback: (t: AdminMessageAccessor) => string;
    fieldErrors?: (
      cause: unknown,
      t: AdminMessageAccessor
    ) => VolumeFieldErrors;
    overrides?: (cause: unknown) => Promise<RpcErrorMessageOverrides>;
  }
): Promise<SaveVolumeResult> => {
  const [t, sessionId] = await Promise.all([
    getMessagesFor(locale),
    getAccessToken(),
  ]);

  if (!sessionId) {
    return { message: t("errors.rpc.unauthenticated"), ok: false };
  }

  try {
    const response = await write(sessionId);

    if (!response.volume?.id?.trim()) {
      return { message: failure.fallback(t), ok: false };
    }

    return { ok: true, volume: mapVolume(response.volume) };
  } catch (error) {
    rethrowUnauthenticatedRpcError(error);
    rethrowUnclassifiedRpcError(error);

    const fieldErrors = failure.fieldErrors?.(error, t) ?? {};
    const [fieldMessage] = Object.values(fieldErrors);

    if (fieldMessage) {
      return { fieldErrors, message: fieldMessage, ok: false };
    }

    return {
      message: rpcErrorMessage(error, failure.fallback(t), {
        locale,
        overrides: await failure.overrides?.(error),
      }),
      ok: false,
    };
  }
};

/**
 * Creates an unpublished volume at the end of the series' volumes, holding no
 * episodes yet.
 */
export const createVolume = (
  input: VolumeFields & { seriesId: string },
  locale: Locale
): Promise<SaveVolumeResult> =>
  writeVolume(
    locale,
    (sessionId) =>
      apiClient.series.createVolume(
        {
          currency: input.currency,
          price: input.price,
          seriesId: input.seriesId,
          tenant: { tenantId: input.tenantId },
          title: input.title,
        },
        withSessionHeaders(sessionId)
      ),
    {
      fallback: (t) => t("admin.series.volumes.save_failed"),
      overrides: async (error) => {
        const t = await getMessagesFor(locale);

        return {
          ...(await saveOverrides(error, locale)),
          "not-found": t("admin.series.volumes.series_not_found"),
          precondition: t("admin.series.volumes.limit_reached"),
        };
      },
    }
  );

/**
 * Replaces the title and the price together. A purchase already made keeps the
 * price it was made at.
 */
export const updateVolume = (
  input: VolumeFields & { id: string },
  locale: Locale
): Promise<SaveVolumeResult> =>
  writeVolume(
    locale,
    (sessionId) =>
      apiClient.series.updateVolume(
        {
          currency: input.currency,
          price: input.price,
          tenant: { tenantId: input.tenantId },
          title: input.title,
          volumeId: input.id,
        },
        withSessionHeaders(sessionId)
      ),
    {
      fallback: (t) => t("admin.series.volumes.save_failed"),
      overrides: (error) => saveOverrides(error, locale),
    }
  );

/**
 * Puts the volume on sale, or takes it off. The API refuses to put a volume
 * holding no episodes on sale.
 */
export const publishVolume = (
  input: { id: string; published: boolean; tenantId: string },
  locale: Locale
): Promise<SaveVolumeResult> =>
  writeVolume(
    locale,
    (sessionId) =>
      apiClient.series.publishVolume(
        {
          published: input.published,
          tenant: { tenantId: input.tenantId },
          volumeId: input.id,
        },
        withSessionHeaders(sessionId)
      ),
    {
      fallback: (t) => t("admin.series.volumes.sale.failed"),
      overrides: async () => {
        const t = await getMessagesFor(locale);

        return {
          "not-found": t("admin.series.volumes.not_found"),
          precondition: t("admin.series.volumes.sale.no_episodes"),
        };
      },
    }
  );

/**
 * Replaces the episodes the volume holds, in the order given.
 *
 * The API refuses with a failed precondition an episode another volume holds,
 * an episode taken out of a volume that has been on sale, and an emptied
 * volume that has: each is a list composed from a screen that no longer
 * matches what is stored, since the screen offers none of them.
 */
export const setVolumeEpisodes = (
  input: { episodeIds: string[]; id: string; tenantId: string },
  locale: Locale
): Promise<SaveVolumeResult> =>
  writeVolume(
    locale,
    (sessionId) =>
      apiClient.series.setVolumeEpisodes(
        {
          episodeIds: input.episodeIds,
          tenant: { tenantId: input.tenantId },
          volumeId: input.id,
        },
        withSessionHeaders(sessionId)
      ),
    {
      fallback: (t) => t("admin.series.volumes.episodes.save_failed"),
      overrides: async () => {
        const t = await getMessagesFor(locale);

        return {
          "invalid-argument": t("admin.series.volumes.episodes.invalid"),
          "not-found": t("admin.series.volumes.not_found"),
          precondition: t("admin.series.volumes.episodes.conflict"),
        };
      },
    }
  );

/**
 * The field of the link the API refused, worded with the row's number. The
 * API stops at the first link it cannot store, so this is at most one field.
 */
const bookstoreLinkFieldErrors = (
  cause: unknown,
  t: AdminMessageAccessor,
  count: number
) => {
  for (let index = 0; index < count; index += 1) {
    const number = index + 1;
    const label = bookstoreLinkFieldName(index, "label");
    const url = bookstoreLinkFieldName(index, "url");

    if (rpcErrorHasFieldViolation(cause, label)) {
      return {
        [label]: t(
          "admin.series.volumes.bookstore_links.validation.label_invalid",
          { max: MAX_BOOKSTORE_LINK_LABEL_LENGTH, number }
        ),
      };
    }

    if (rpcErrorHasFieldViolation(cause, url)) {
      return {
        [url]: t(
          "admin.series.volumes.bookstore_links.validation.url_invalid",
          {
            max: MAX_BOOKSTORE_LINK_URL_LENGTH,
            number,
          }
        ),
      };
    }
  }

  return {};
};

/**
 * Replaces the volume's bookstore links, in the order given; an empty list
 * leaves it with none. The title, the price, and the episodes stay as they
 * are.
 */
export const setVolumeBookstoreLinks = (
  input: {
    bookstoreLinks: { label: string; url: string }[];
    id: string;
    tenantId: string;
  },
  locale: Locale
): Promise<SaveVolumeResult> =>
  writeVolume(
    locale,
    (sessionId) =>
      apiClient.series.setVolumeBookstoreLinks(
        {
          bookstoreLinks: input.bookstoreLinks,
          tenant: { tenantId: input.tenantId },
          volumeId: input.id,
        },
        withSessionHeaders(sessionId)
      ),
    {
      fallback: (t) => t("admin.series.volumes.bookstore_links.save_failed"),
      fieldErrors: (cause, t) =>
        bookstoreLinkFieldErrors(cause, t, input.bookstoreLinks.length),
      overrides: async (cause) => {
        const t = await getMessagesFor(locale);

        return {
          "invalid-argument": rpcErrorHasFieldViolation(
            cause,
            "bookstore_links"
          )
            ? t("admin.series.volumes.bookstore_links.limit", {
                max: MAX_VOLUME_BOOKSTORE_LINKS,
              })
            : undefined,
          "not-found": t("admin.series.volumes.not_found"),
        };
      },
    }
  );

/**
 * Writes the series' volume order.
 *
 * `expectedIds` is the order the screen was showing when the operator dropped
 * the row. The API locks the series' volumes, re-reads their order, and
 * refuses with a failed precondition when it no longer matches, so a console
 * left open while someone else added or moved a volume reports the conflict
 * instead of writing an order composed from a stale list.
 */
export const reorderVolumes = async (
  input: {
    expectedIds: string[];
    ids: string[];
    seriesId: string;
    tenantId: string;
  },
  locale: Locale
): Promise<ReorderVolumesResult> => {
  const [t, sessionId] = await Promise.all([
    getMessagesFor(locale),
    getAccessToken(),
  ]);

  if (!sessionId) {
    return { message: t("errors.rpc.unauthenticated"), ok: false };
  }

  try {
    await apiClient.series.reorderVolumes(
      {
        expectedVolumeIds: input.expectedIds,
        seriesId: input.seriesId,
        tenant: { tenantId: input.tenantId },
        volumeIds: input.ids,
      },
      withSessionHeaders(sessionId)
    );

    return { ok: true };
  } catch (error) {
    rethrowUnauthenticatedRpcError(error);
    rethrowUnclassifiedRpcError(error);

    return {
      message: rpcErrorMessage(
        error,
        t("admin.series.volumes.reorder_failed"),
        {
          locale,
          overrides: {
            "not-found": t("admin.series.volumes.series_not_found"),
            precondition: t("admin.series.volumes.reorder_conflict"),
          },
        }
      ),
      ok: false,
    };
  }
};

/** The wording of a refused cover upload or removal. */
const coverOverrides = async (
  cause: unknown,
  locale: Locale
): Promise<RpcErrorMessageOverrides> => {
  const t = await getMessagesFor(locale);

  return {
    "invalid-argument": t("admin.series.volumes.cover.image_invalid"),
    "not-found": t("admin.series.volumes.not_found"),
    precondition: mentionsStorageNotConfigured(cause)
      ? t("admin.errors.storage_not_configured")
      : undefined,
  };
};

/**
 * Gives the volume a cover, replacing the one it has. All four ratios are cut
 * out of the one image, from its centre.
 */
export const uploadVolumeCoverImage = (
  input: {
    id: string;
    imageContentType?: string;
    imageData: Uint8Array;
    tenantId: string;
  },
  locale: Locale
): Promise<SaveVolumeResult> =>
  writeVolume(
    locale,
    (sessionId) =>
      apiClient.series.uploadVolumeCoverImage(
        {
          imageContentType: input.imageContentType,
          imageData: input.imageData,
          tenant: { tenantId: input.tenantId },
          volumeId: input.id,
        },
        withSessionHeaders(sessionId)
      ),
    {
      fallback: (t) => t("admin.series.volumes.cover.failed"),
      overrides: (error) => coverOverrides(error, locale),
    }
  );

/**
 * Takes the volume's cover away, so the series' cover image is shown in its
 * place.
 */
export const deleteVolumeCoverImage = (
  input: { id: string; tenantId: string },
  locale: Locale
): Promise<SaveVolumeResult> =>
  writeVolume(
    locale,
    (sessionId) =>
      apiClient.series.deleteVolumeCoverImage(
        { tenant: { tenantId: input.tenantId }, volumeId: input.id },
        withSessionHeaders(sessionId)
      ),
    {
      fallback: (t) => t("admin.series.volumes.cover.failed"),
      overrides: (error) => coverOverrides(error, locale),
    }
  );
