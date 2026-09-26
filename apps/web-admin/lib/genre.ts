import type { Genre } from "@publira/api-client/admin/types";
import { rpcErrorMessage } from "@publira/api-client/error-messages";
import type { RpcErrorMessageOverrides } from "@publira/api-client/error-messages";
import { rethrowUnclassifiedRpcError } from "@publira/api-client/errors";
import { forEachPageWithToken } from "@publira/api-client/pagination";
import type { Locale } from "@publira/i18n";
import { cacheTag } from "next/cache";

import {
  isUnauthenticatedError,
  rethrowUnauthenticatedRpcError,
} from "./admin-auth-shared";
import { apiClient, withSessionHeaders } from "./api";
import { CATALOG_NAME_MAX_LENGTH } from "./catalog-name";
import type { CropRect } from "./crop-rect";
import {
  mentionsAspectImageRejection,
  mentionsImageRejection,
  mentionsStorageNotConfigured,
} from "./image-rejection";
import { getMessagesFor } from "./messages";
import { getAccessToken } from "./session";

export interface GenreItem {
  publicId: string;
  name: string;
  slug: string;
  eyeCatchImageUpdatedAt: string;
  eyeCatchImageVariants: {
    variantType: string;
    label: string;
    url: string;
    contentType: string;
    width: number;
    height: number;
    fileSizeBytes: number;
  }[];
}

export type ListGenresResult =
  | { ok: true; genres: GenreItem[] }
  | {
      ok: false;
      message: string;
      genres: GenreItem[];
      /** The API rejected the session — the page raises the login redirect. */
      requiresSignIn: boolean;
    };

export type CreateGenreResult =
  | { ok: true; genre: GenreItem }
  | { ok: false; message: string };

export type UpdateGenreResult =
  | { ok: true; genre: GenreItem }
  | { ok: false; message: string };

/**
 * `notFound: true` is the "there is nothing to show here" failure the genre
 * screen turns into `notFound()`, carrying no message for the same reason
 * `GetLabelResult` carries none.
 */
export type GetGenreResult =
  | { ok: true; genre: GenreItem }
  | { notFound: true; ok: false }
  | {
      message: string;
      notFound?: false;
      ok: false;
      /** The API rejected the session — the page raises the login redirect. */
      requiresSignIn: boolean;
    };

export type GenreEyeCatchAspectResult =
  | { ok: true; genre: GenreItem }
  /** The API refused the image itself; the slot that submitted words it. */
  | { ok: false; imageRejected: true }
  | { ok: false; message: string };

export type ReorderGenresResult =
  | { ok: true; genres: GenreItem[] }
  | { ok: false; message: string };

export type DeleteGenreResult = { ok: true } | { ok: false; message: string };

/** The tag every genre read is filed under, and every genre write drops. */
export const genresCacheTag = (tenantId: string): string =>
  `genres-${tenantId}`;

/**
 * The rules the API enforces on the writes that carry a name and an eye-catch.
 * `invalid-argument` is the image when a field violation names it, and
 * otherwise one of the three name rules — empty, too long, and no letter or
 * digit to derive a slug from. `conflict` is another genre whose slug this name
 * would collide with, which the two names need not look alike to do.
 */
const saveOverrides = async (
  error: unknown,
  locale: Locale
): Promise<RpcErrorMessageOverrides> => {
  const t = await getMessagesFor(locale);

  return {
    conflict: t("admin.genres.name_taken"),
    "invalid-argument": mentionsImageRejection(error)
      ? t("admin.genres.image_invalid")
      : t("admin.genres.name_invalid", {
          count: String(CATALOG_NAME_MAX_LENGTH),
        }),
    precondition: mentionsStorageNotConfigured(error)
      ? t("admin.errors.storage_not_configured")
      : undefined,
  };
};

const mapErrorToMessage = (
  error: unknown,
  fallbackMessage: string,
  locale: Locale,
  overrides?: RpcErrorMessageOverrides
): string => rpcErrorMessage(error, fallbackMessage, { locale, overrides });

/** The generated `Genre` fields {@link mapGenre} reads (see `label.ts`). */
type RawGenre = Pick<
  Genre,
  | "eyeCatchImageUpdatedAt"
  | "eyeCatchImageVariants"
  | "name"
  | "publicId"
  | "slug"
>;

const mapGenre = (genre: RawGenre): GenreItem => ({
  eyeCatchImageUpdatedAt: genre.eyeCatchImageUpdatedAt ?? "",
  eyeCatchImageVariants: (genre.eyeCatchImageVariants ?? []).flatMap(
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
  name: genre.name ?? "",
  publicId: genre.publicId ?? "",
  slug: genre.slug ?? "",
});

/**
 * Every genre of the tenant, in the order the tenant put them in.
 *
 * The whole list rather than one page, because `ReorderGenres` compares the
 * order the client posts against the tenant's entire order and refuses a
 * mismatch: a screen holding one page could not name an order to send. Genres
 * are a hand-curated vocabulary, so the walk is a page or two in practice.
 *
 * An incomplete walk fails with an empty list rather than a partial one. A
 * partial list would not only hide genres — it would make every move button on
 * screen post an order that is missing rows, which the API refuses.
 */
export const listGenres = async (
  tenantId: string,
  locale: Locale
): Promise<ListGenresResult> => {
  "use cache: private";
  cacheTag(genresCacheTag(tenantId));

  const [t, sessionId] = await Promise.all([
    getMessagesFor(locale),
    getAccessToken(),
  ]);
  if (!sessionId) {
    return {
      genres: [],
      message: t("errors.rpc.unauthenticated"),
      ok: false,
      requiresSignIn: true,
    };
  }

  try {
    const genres: GenreItem[] = [];
    const walkStop = await forEachPageWithToken(
      async (token, limit) => {
        const response = await apiClient.genre.listGenres(
          {
            limit,
            tenant: { tenantId },
            token,
          },
          withSessionHeaders(sessionId)
        );
        return {
          items: response.genres ?? [],
          nextToken: response.nextToken ?? "",
        };
      },
      (items) => {
        for (const item of items) {
          genres.push(mapGenre(item));
        }
      }
    );

    if (walkStop !== "completed") {
      return {
        genres: [],
        message: t("admin.genres.list_failed"),
        ok: false,
        requiresSignIn: false,
      };
    }

    return { genres, ok: true };
  } catch (error) {
    rethrowUnclassifiedRpcError(error);
    return {
      genres: [],
      message: await mapErrorToMessage(
        error,
        t("admin.genres.list_failed"),
        locale
      ),
      ok: false,
      requiresSignIn: isUnauthenticatedError(error),
    };
  }
};

/**
 * One genre of the tenant, for the screen its eye-catch is edited on.
 *
 * There is no `GetGenre` RPC: the genre is picked out of {@link listGenres},
 * which the console already reads whole and files under the same tag.
 */
export const getGenre = async (
  input: { tenantId: string; publicId: string },
  locale: Locale
): Promise<GetGenreResult> => {
  const result = await listGenres(input.tenantId, locale);
  if (!result.ok) {
    return {
      message: result.message,
      ok: false,
      requiresSignIn: result.requiresSignIn,
    };
  }

  const genre = result.genres.find(
    (candidate) => candidate.publicId === input.publicId
  );
  return genre ? { genre, ok: true } : { notFound: true, ok: false };
};

export const createGenre = async (
  input: { tenantId: string; name: string },
  locale: Locale
): Promise<CreateGenreResult> => {
  const [t, sessionId] = await Promise.all([
    getMessagesFor(locale),
    getAccessToken(),
  ]);
  if (!sessionId) {
    return { message: t("errors.rpc.unauthenticated"), ok: false };
  }

  try {
    const response = await apiClient.genre.createGenre(
      {
        name: input.name,
        tenant: { tenantId: input.tenantId },
      },
      withSessionHeaders(sessionId)
    );

    if (!response.genre?.publicId?.trim()) {
      return { message: t("admin.genres.save_failed"), ok: false };
    }

    return { genre: mapGenre(response.genre), ok: true };
  } catch (error) {
    rethrowUnauthenticatedRpcError(error);
    rethrowUnclassifiedRpcError(error);
    return {
      message: await mapErrorToMessage(
        error,
        t("admin.genres.save_failed"),
        locale,
        await saveOverrides(error, locale)
      ),
      ok: false,
    };
  }
};

export const updateGenre = async (
  input: {
    tenantId: string;
    publicId: string;
    name: string;
    clearEyeCatchImage?: boolean;
    eyeCatchImageContentType?: string;
    eyeCatchImageData?: Uint8Array;
  },
  locale: Locale
): Promise<UpdateGenreResult> => {
  const [t, sessionId] = await Promise.all([
    getMessagesFor(locale),
    getAccessToken(),
  ]);
  if (!sessionId) {
    return { message: t("errors.rpc.unauthenticated"), ok: false };
  }

  try {
    const response = await apiClient.genre.updateGenre(
      {
        clearEyeCatchImage: input.clearEyeCatchImage,
        eyeCatchImageContentType: input.eyeCatchImageContentType,
        eyeCatchImageData: input.eyeCatchImageData,
        name: input.name,
        publicId: input.publicId,
        tenant: { tenantId: input.tenantId },
      },
      withSessionHeaders(sessionId)
    );

    if (!response.genre?.publicId?.trim()) {
      return { message: t("admin.genres.save_failed"), ok: false };
    }

    return { genre: mapGenre(response.genre), ok: true };
  } catch (error) {
    rethrowUnauthenticatedRpcError(error);
    rethrowUnclassifiedRpcError(error);
    return {
      message: await mapErrorToMessage(
        error,
        t("admin.genres.save_failed"),
        locale,
        await saveOverrides(error, locale)
      ),
      ok: false,
    };
  }
};

/**
 * Writes the tenant's genre order.
 *
 * `expectedPublicIds` is the order the screen was showing when the editor
 * pressed the button. The API locks the tenant's genres, re-reads their order,
 * and refuses with a failed precondition when it no longer matches — a console
 * left open while someone else added or moved a genre therefore reports the
 * conflict instead of writing an order composed from a stale list.
 */
export const reorderGenres = async (
  input: {
    tenantId: string;
    publicIds: string[];
    expectedPublicIds: string[];
  },
  locale: Locale
): Promise<ReorderGenresResult> => {
  const [t, sessionId] = await Promise.all([
    getMessagesFor(locale),
    getAccessToken(),
  ]);
  if (!sessionId) {
    return { message: t("errors.rpc.unauthenticated"), ok: false };
  }

  try {
    const response = await apiClient.genre.reorderGenres(
      {
        expectedGenrePublicIds: input.expectedPublicIds,
        genrePublicIds: input.publicIds,
        tenant: { tenantId: input.tenantId },
      },
      withSessionHeaders(sessionId)
    );

    return {
      genres: (response.genres ?? []).map((genre) => mapGenre(genre)),
      ok: true,
    };
  } catch (error) {
    rethrowUnauthenticatedRpcError(error);
    rethrowUnclassifiedRpcError(error);
    return {
      message: await mapErrorToMessage(
        error,
        t("admin.genres.reorder_failed"),
        locale,
        {
          precondition: t("admin.genres.reorder_conflict"),
        }
      ),
      ok: false,
    };
  }
};

/**
 * Removes a genre no series carries.
 *
 * A genre still assigned comes back as a failed precondition: deleting it would
 * reclassify every series holding it without anyone saying so, so the editor is
 * told to unassign it first.
 */
export const deleteGenre = async (
  input: { tenantId: string; publicId: string },
  locale: Locale
): Promise<DeleteGenreResult> => {
  const [t, sessionId] = await Promise.all([
    getMessagesFor(locale),
    getAccessToken(),
  ]);
  if (!sessionId) {
    return { message: t("errors.rpc.unauthenticated"), ok: false };
  }

  try {
    await apiClient.genre.deleteGenre(
      {
        publicId: input.publicId,
        tenant: { tenantId: input.tenantId },
      },
      withSessionHeaders(sessionId)
    );

    return { ok: true };
  } catch (error) {
    rethrowUnauthenticatedRpcError(error);
    rethrowUnclassifiedRpcError(error);
    return {
      message: await mapErrorToMessage(
        error,
        t("admin.genres.delete_failed"),
        locale,
        {
          precondition: t("admin.genres.delete_in_use"),
        }
      ),
      ok: false,
    };
  }
};

/**
 * Replaces the image of one aspect ratio of the genre eye-catch. The other
 * ratios keep the images they already hold, so the eye-catch has to exist
 * before one ratio can be swapped on its own.
 */
export const uploadGenreEyeCatchAspectImage = async (
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
): Promise<GenreEyeCatchAspectResult> => {
  const [t, sessionId] = await Promise.all([
    getMessagesFor(locale),
    getAccessToken(),
  ]);
  if (!sessionId) {
    return { message: t("errors.rpc.unauthenticated"), ok: false };
  }

  try {
    const response = await apiClient.genre.uploadGenreEyeCatchAspectImage(
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

    if (!response.genre?.publicId?.trim()) {
      return { message: t("admin.genres.save_failed"), ok: false };
    }

    return { genre: mapGenre(response.genre), ok: true };
  } catch (error) {
    rethrowUnauthenticatedRpcError(error);
    rethrowUnclassifiedRpcError(error);
    if (mentionsAspectImageRejection(error)) {
      return { imageRejected: true, ok: false };
    }
    return {
      message: await mapErrorToMessage(
        error,
        t("admin.genres.save_failed"),
        locale,
        {
          precondition: mentionsStorageNotConfigured(error)
            ? t("admin.errors.storage_not_configured")
            : undefined,
        }
      ),
      ok: false,
    };
  }
};
