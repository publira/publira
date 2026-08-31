import type { Creator } from "@publira/api-client/admin/types";
import { rpcErrorMessage } from "@publira/api-client/error-messages";
import {
  isMissingResourceRpcError,
  rethrowUnclassifiedRpcError,
} from "@publira/api-client/errors";
import { forEachPageWithToken } from "@publira/api-client/pagination";
import { getMessage, toIntlLocale } from "@publira/i18n";
import type { Locale } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import type { SharedMessages } from "@publira/i18n/catalog";
import { cacheTag } from "next/cache";

import {
  isUnauthenticatedError,
  rethrowUnauthenticatedRpcError,
} from "./admin-auth-shared";
import { apiClient, withSessionHeaders } from "./api";
import type { CursorPageOptions, CursorPageTokens } from "./cursor-page";
import {
  cursorPageRequest,
  cursorPageTokens,
  emptyCursorPageTokens,
} from "./cursor-page";
import { FALLBACK_LOCALE } from "./fallback-locale";
import { getAccessToken } from "./session";

export interface CreatorItem {
  publicId: string;
  name: string;
  profileText: string;
  iconImageUrl: string;
  iconImageFileSizeBytes: number;
  iconImageUpdatedAt: string;
}

export type ListCreatorsResult = CursorPageTokens &
  (
    | { ok: true; creators: CreatorItem[] }
    | {
        ok: false;
        message: string;
        creators: CreatorItem[];
        /** The API rejected the session — the page raises the login redirect. */
        requiresSignIn: boolean;
      }
  );

export type CreateCreatorResult =
  | { ok: true; creator: CreatorItem }
  | { ok: false; message: string };

export type UpdateCreatorResult =
  | { ok: true; creator: CreatorItem }
  | { ok: false; message: string };

/**
 * `notFound: true` is the "there is nothing to show here" failure the edit
 * screen turns into `notFound()`. It carries no message: the screen is replaced
 * by `not-found.tsx`, and wording that distinguished a missing creator from
 * another tenant's creator would leak whether it exists.
 *
 * The flag exists because `getCreator()` runs inside a `"use cache: private"`
 * scope, where a thrown `notFound()` is not observable by the caller (#672).
 * The interrupt has to be raised by the caller, outside the cache scope.
 */
export type GetCreatorResult =
  | { ok: true; creator: CreatorItem }
  | { notFound: true; ok: false }
  | {
      message: string;
      notFound?: false;
      ok: false;
      /** The API rejected the session — the page raises the login redirect. */
      requiresSignIn?: boolean;
    };

const sessionErrorMessage = (messages: SharedMessages): string =>
  getMessage(messages, "errors.rpc.unauthenticated");
const listErrorMessage = (messages: SharedMessages): string =>
  getMessage(messages, "admin.creators.list_failed");
const mutationErrorMessage = (messages: SharedMessages): string =>
  getMessage(messages, "admin.creators.save_failed");

const mapErrorToMessage = (
  error: unknown,
  fallbackMessage: string,
  locale: Locale
): string => rpcErrorMessage(error, fallbackMessage, { locale });

/** The generated `Creator` fields {@link mapCreator} reads (see `series.ts`). */
type RawCreator = Pick<
  Creator,
  | "iconImageFileSizeBytes"
  | "iconImageUpdatedAt"
  | "iconImageUrl"
  | "name"
  | "profileText"
  | "publicId"
>;

const mapCreator = (creator: RawCreator): CreatorItem => ({
  iconImageFileSizeBytes: Number(creator.iconImageFileSizeBytes ?? 0),
  iconImageUpdatedAt: creator.iconImageUpdatedAt ?? "",
  iconImageUrl: creator.iconImageUrl ?? "",
  name: creator.name,
  profileText: creator.profileText,
  publicId: creator.publicId,
});

export const listCreators = async (
  tenantId: string,
  options: CursorPageOptions = {},
  locale: Locale = FALLBACK_LOCALE
): Promise<ListCreatorsResult> => {
  "use cache: private";
  cacheTag(`creators-${tenantId}`);

  const messages = sharedCatalog(locale);
  const sessionId = await getAccessToken();
  if (!sessionId) {
    return {
      ...emptyCursorPageTokens,
      creators: [],
      message: sessionErrorMessage(messages),
      ok: false,
      requiresSignIn: true,
    };
  }

  try {
    const response = await apiClient.creator.listCreators(
      {
        ...cursorPageRequest(options),
        tenant: { tenantId },
      },
      withSessionHeaders(sessionId)
    );

    return {
      ...cursorPageTokens(response),
      // Keep the server's keyset order; client re-sorting would break paging.
      creators: (response.creators ?? []).map((item) => mapCreator(item)),
      ok: true,
    };
  } catch (error) {
    rethrowUnclassifiedRpcError(error);
    return {
      ...emptyCursorPageTokens,
      creators: [],
      message: mapErrorToMessage(error, listErrorMessage(messages), locale),
      ok: false,
      requiresSignIn: isUnauthenticatedError(error),
    };
  }
};

/**
 * Every creator in the tenant for combobox pickers (series form, etc.).
 *
 * Walks `ListCreators` cursor pages so the client-side Combobox can search
 * beyond a single RPC page. The `/creators` list keeps {@link listCreators}
 * (one page) so list paging stays independent of picker loading.
 *
 * Sorted by name for readable search results. An incomplete walk (budget
 * exhausted or a repeated token) fails with an empty list rather than a
 * partial option set that would hide creators beyond the rows already read.
 */
export const listAllCreators = async (
  tenantId: string,
  locale: Locale = FALLBACK_LOCALE
): Promise<ListCreatorsResult> => {
  "use cache: private";
  cacheTag(`creators-${tenantId}`);

  const messages = sharedCatalog(locale);
  const sessionId = await getAccessToken();
  if (!sessionId) {
    return {
      ...emptyCursorPageTokens,
      creators: [],
      message: sessionErrorMessage(messages),
      ok: false,
      requiresSignIn: true,
    };
  }

  try {
    const creators: CreatorItem[] = [];
    const walkStop = await forEachPageWithToken(
      async (token, limit) => {
        const response = await apiClient.creator.listCreators(
          {
            limit,
            tenant: { tenantId },
            token,
          },
          withSessionHeaders(sessionId)
        );
        return {
          items: response.creators ?? [],
          nextToken: response.nextToken ?? "",
        };
      },
      (items) => {
        for (const item of items) {
          creators.push(mapCreator(item));
        }
      }
    );

    // Match episode reorder: a partial walk must not surface a half-built
    // option list that operators treat as complete.
    if (walkStop !== "completed") {
      return {
        ...emptyCursorPageTokens,
        creators: [],
        message: listErrorMessage(messages),
        ok: false,
        requiresSignIn: false,
      };
    }

    return {
      ...emptyCursorPageTokens,
      creators: creators.toSorted((a, b) =>
        a.name.localeCompare(b.name, toIntlLocale(locale))
      ),
      ok: true,
    };
  } catch (error) {
    rethrowUnclassifiedRpcError(error);
    return {
      ...emptyCursorPageTokens,
      creators: [],
      message: mapErrorToMessage(error, listErrorMessage(messages), locale),
      ok: false,
      requiresSignIn: isUnauthenticatedError(error),
    };
  }
};

export const createCreator = async (
  input: {
    tenantId: string;
    name: string;
    profileText: string;
    iconImageContentType?: string;
    iconImageData?: Uint8Array;
  },
  locale: Locale = FALLBACK_LOCALE
): Promise<CreateCreatorResult> => {
  const messages = sharedCatalog(locale);
  const sessionId = await getAccessToken();
  if (!sessionId) {
    return {
      message: sessionErrorMessage(messages),
      ok: false,
    };
  }

  try {
    const response = await apiClient.creator.createCreator(
      {
        iconImageContentType: input.iconImageContentType,
        iconImageData: input.iconImageData,
        name: input.name,
        profileText: input.profileText,
        tenant: { tenantId: input.tenantId },
      },
      withSessionHeaders(sessionId)
    );

    if (!response.creator?.publicId?.trim()) {
      return {
        message: mutationErrorMessage(messages),
        ok: false,
      };
    }

    return {
      creator: mapCreator(response.creator),
      ok: true,
    };
  } catch (error) {
    rethrowUnauthenticatedRpcError(error);
    rethrowUnclassifiedRpcError(error);
    return {
      message: mapErrorToMessage(error, mutationErrorMessage(messages), locale),
      ok: false,
    };
  }
};

export const updateCreator = async (
  input: {
    tenantId: string;
    publicId: string;
    name: string;
    profileText: string;
    clearIconImage?: boolean;
    iconImageContentType?: string;
    iconImageData?: Uint8Array;
  },
  locale: Locale = FALLBACK_LOCALE
): Promise<UpdateCreatorResult> => {
  const messages = sharedCatalog(locale);
  const sessionId = await getAccessToken();
  if (!sessionId) {
    return {
      message: sessionErrorMessage(messages),
      ok: false,
    };
  }

  try {
    const response = await apiClient.creator.updateCreator(
      {
        clearIconImage: input.clearIconImage,
        iconImageContentType: input.iconImageContentType,
        iconImageData: input.iconImageData,
        name: input.name,
        profileText: input.profileText,
        publicId: input.publicId,
        tenant: { tenantId: input.tenantId },
      },
      withSessionHeaders(sessionId)
    );

    if (!response.creator?.publicId?.trim()) {
      return {
        message: mutationErrorMessage(messages),
        ok: false,
      };
    }

    return {
      creator: mapCreator(response.creator),
      ok: true,
    };
  } catch (error) {
    rethrowUnauthenticatedRpcError(error);
    rethrowUnclassifiedRpcError(error);
    return {
      message: mapErrorToMessage(error, mutationErrorMessage(messages), locale),
      ok: false,
    };
  }
};

export const getCreator = async (
  input: {
    tenantId: string;
    publicId: string;
  },
  locale: Locale = FALLBACK_LOCALE
): Promise<GetCreatorResult> => {
  "use cache: private";
  cacheTag(`creators-${input.tenantId}`);
  cacheTag(`creator-${input.tenantId}-${input.publicId}`);

  const messages = sharedCatalog(locale);
  const sessionId = await getAccessToken();
  if (!sessionId) {
    return {
      message: sessionErrorMessage(messages),
      ok: false,
      requiresSignIn: true,
    };
  }

  try {
    const response = await apiClient.creator.getCreator(
      {
        publicId: input.publicId,
        tenant: { tenantId: input.tenantId },
      },
      withSessionHeaders(sessionId)
    );

    if (!response.creator?.publicId?.trim()) {
      return {
        message: listErrorMessage(messages),
        ok: false,
      };
    }

    return {
      creator: mapCreator(response.creator),
      ok: true,
    };
  } catch (error) {
    rethrowUnclassifiedRpcError(error);
    if (isMissingResourceRpcError(error)) {
      return { notFound: true, ok: false };
    }
    return {
      message: mapErrorToMessage(error, listErrorMessage(messages), locale),
      ok: false,
      requiresSignIn: isUnauthenticatedError(error),
    };
  }
};
