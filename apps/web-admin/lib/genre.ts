import type { Genre } from "@publira/api-client/admin/types";
import { rpcErrorMessage } from "@publira/api-client/error-messages";
import type { RpcErrorMessageOverrides } from "@publira/api-client/error-messages";
import { rethrowUnclassifiedRpcError } from "@publira/api-client/errors";
import { forEachPageWithToken } from "@publira/api-client/pagination";
import { getMessage } from "@publira/i18n";
import type { Locale } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import type { SharedMessages } from "@publira/i18n/catalog";
import { cacheTag } from "next/cache";

import {
  isUnauthenticatedError,
  rethrowUnauthenticatedRpcError,
} from "./admin-auth-shared";
import { apiClient, withSessionHeaders } from "./api";
import { GENRE_NAME_MAX_LENGTH } from "./genre-shared";
import { getAccessToken } from "./session";

export interface GenreItem {
  publicId: string;
  name: string;
  slug: string;
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

export type ReorderGenresResult =
  | { ok: true; genres: GenreItem[] }
  | { ok: false; message: string };

export type DeleteGenreResult = { ok: true } | { ok: false; message: string };

/** The tag every genre read is filed under, and every genre write drops. */
export const genresCacheTag = (tenantId: string): string =>
  `genres-${tenantId}`;

const sessionErrorMessage = (messages: SharedMessages): string =>
  getMessage(messages, "errors.rpc.unauthenticated");
const listErrorMessage = (messages: SharedMessages): string =>
  getMessage(messages, "admin.genres.list_failed");
const saveErrorMessage = (messages: SharedMessages): string =>
  getMessage(messages, "admin.genres.save_failed");

/**
 * The name rules the API enforces, worded once for both writes that carry a
 * name. `invalid-argument` covers all three of them — empty, too long, and no
 * letter or digit to derive a slug from — and `conflict` is another genre whose
 * slug this name would collide with, which the two names need not look alike
 * to do.
 */
const nameOverrides = (messages: SharedMessages): RpcErrorMessageOverrides => ({
  conflict: getMessage(messages, "admin.genres.name_taken"),
  "invalid-argument": getMessage(messages, "admin.genres.name_invalid", {
    count: String(GENRE_NAME_MAX_LENGTH),
  }),
});

const mapErrorToMessage = (
  error: unknown,
  fallbackMessage: string,
  locale: Locale,
  overrides?: RpcErrorMessageOverrides
): string => rpcErrorMessage(error, fallbackMessage, { locale, overrides });

/** The generated `Genre` fields {@link mapGenre} reads (see `label.ts`). */
type RawGenre = Pick<Genre, "name" | "publicId" | "slug">;

const mapGenre = (genre: RawGenre): GenreItem => ({
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

  const messages = sharedCatalog(locale);
  const sessionId = await getAccessToken();
  if (!sessionId) {
    return {
      genres: [],
      message: sessionErrorMessage(messages),
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
        message: listErrorMessage(messages),
        ok: false,
        requiresSignIn: false,
      };
    }

    return { genres, ok: true };
  } catch (error) {
    rethrowUnclassifiedRpcError(error);
    return {
      genres: [],
      message: mapErrorToMessage(error, listErrorMessage(messages), locale),
      ok: false,
      requiresSignIn: isUnauthenticatedError(error),
    };
  }
};

export const createGenre = async (
  input: { tenantId: string; name: string },
  locale: Locale
): Promise<CreateGenreResult> => {
  const messages = sharedCatalog(locale);
  const sessionId = await getAccessToken();
  if (!sessionId) {
    return { message: sessionErrorMessage(messages), ok: false };
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
      return { message: saveErrorMessage(messages), ok: false };
    }

    return { genre: mapGenre(response.genre), ok: true };
  } catch (error) {
    rethrowUnauthenticatedRpcError(error);
    rethrowUnclassifiedRpcError(error);
    return {
      message: mapErrorToMessage(
        error,
        saveErrorMessage(messages),
        locale,
        nameOverrides(messages)
      ),
      ok: false,
    };
  }
};

export const updateGenre = async (
  input: { tenantId: string; publicId: string; name: string },
  locale: Locale
): Promise<UpdateGenreResult> => {
  const messages = sharedCatalog(locale);
  const sessionId = await getAccessToken();
  if (!sessionId) {
    return { message: sessionErrorMessage(messages), ok: false };
  }

  try {
    const response = await apiClient.genre.updateGenre(
      {
        name: input.name,
        publicId: input.publicId,
        tenant: { tenantId: input.tenantId },
      },
      withSessionHeaders(sessionId)
    );

    if (!response.genre?.publicId?.trim()) {
      return { message: saveErrorMessage(messages), ok: false };
    }

    return { genre: mapGenre(response.genre), ok: true };
  } catch (error) {
    rethrowUnauthenticatedRpcError(error);
    rethrowUnclassifiedRpcError(error);
    return {
      message: mapErrorToMessage(
        error,
        saveErrorMessage(messages),
        locale,
        nameOverrides(messages)
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
  const messages = sharedCatalog(locale);
  const sessionId = await getAccessToken();
  if (!sessionId) {
    return { message: sessionErrorMessage(messages), ok: false };
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
      message: mapErrorToMessage(
        error,
        getMessage(messages, "admin.genres.reorder_failed"),
        locale,
        {
          precondition: getMessage(messages, "admin.genres.reorder_conflict"),
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
  const messages = sharedCatalog(locale);
  const sessionId = await getAccessToken();
  if (!sessionId) {
    return { message: sessionErrorMessage(messages), ok: false };
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
      message: mapErrorToMessage(
        error,
        getMessage(messages, "admin.genres.delete_failed"),
        locale,
        {
          precondition: getMessage(messages, "admin.genres.delete_in_use"),
        }
      ),
      ok: false,
    };
  }
};
