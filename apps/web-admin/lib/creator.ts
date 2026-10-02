import type { Creator, CreatorAccount } from "@publira/api-client/admin/types";
import { rpcErrorMessage } from "@publira/api-client/error-messages";
import {
  isMissingResourceRpcError,
  rethrowUnclassifiedRpcError,
} from "@publira/api-client/errors";
import { forEachPageWithToken } from "@publira/api-client/pagination";
import { toIntlLocale } from "@publira/i18n";
import type { Locale } from "@publira/i18n";
import { dropFailedCacheEntry } from "@publira/utils/cached-read";
import { cacheTag } from "next/cache";

import type { ReaderItem } from "../app/[tenant_id]/(protected)/readers/reader-types";
import {
  isUnauthenticatedError,
  rethrowUnauthenticatedRpcError,
} from "./admin-auth-shared";
import { verifyAdminPageSession } from "./admin-page-session";
import { apiClient, withServiceHeaders, withSessionHeaders } from "./api";
import type { CropRect } from "./crop-rect";
import type { CursorPageOptions, CursorPageTokens } from "./cursor-page";
import {
  cursorPageRequest,
  cursorPageTokens,
  emptyCursorPageTokens,
} from "./cursor-page";
import { mentionsStorageNotConfigured } from "./image-rejection";
import { getMessagesFor } from "./messages";
import { mapReader } from "./reader";
import { getAccessToken } from "./session";

export interface CreatorItem {
  /** The primary key an edit addresses the creator by. */
  id: string;
  /** What the creator's page is addressed by in the URL. */
  publicId: string;
  name: string;
  profileText: string;
  iconImageUrl: string;
  iconImageFileSizeBytes: number;
  iconImageUpdatedAt: string;
}

/** A reader account linked to a creator, and when the link was made. */
export type CreatorAccountItem = ReaderItem & {
  linkedAt: string;
};

export type ListCreatorsResult = CursorPageTokens &
  (
    | { ok: true; creators: CreatorItem[] }
    | {
        ok: false;
        message: string;
        creators: CreatorItem[];
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
 * scope, where a thrown `notFound()` is not observable by the caller.
 * The interrupt has to be raised by the caller, outside the cache scope.
 */
export type GetCreatorResult =
  | {
      ok: true;
      creator: CreatorItem;
      /** Always empty unless the session is a tenant admin's. */
      accounts: CreatorAccountItem[];
    }
  | { notFound: true; ok: false }
  | {
      message: string;
      notFound?: false;
      ok: false;
      /** The API rejected the session — the page raises the login redirect. */
      requiresSignIn?: boolean;
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
      precondition: mentionsStorageNotConfigured(error)
        ? t("admin.errors.storage_not_configured")
        : undefined,
    },
  });
};

/** The generated `Creator` fields {@link mapCreator} reads (see `series.ts`). */
type RawCreator = Pick<
  Creator,
  | "iconImageFileSizeBytes"
  | "iconImageUpdatedAt"
  | "iconImageUrl"
  | "id"
  | "name"
  | "profileText"
  | "publicId"
>;

const mapCreator = (creator: RawCreator): CreatorItem => ({
  iconImageFileSizeBytes: Number(creator.iconImageFileSizeBytes ?? 0),
  iconImageUpdatedAt: creator.iconImageUpdatedAt ?? "",
  iconImageUrl: creator.iconImageUrl ?? "",
  id: creator.id,
  name: creator.name,
  profileText: creator.profileText,
  publicId: creator.publicId,
});

/** The generated `CreatorAccount` fields {@link mapCreatorAccounts} reads. */
type RawCreatorAccount = Pick<CreatorAccount, "linkedAt" | "reader">;

const mapCreatorAccounts = (
  accounts: RawCreatorAccount[] | undefined
): CreatorAccountItem[] =>
  (accounts ?? []).flatMap(({ linkedAt, reader }) =>
    reader ? [{ ...mapReader(reader), linkedAt: linkedAt ?? "" }] : []
  );

const listCreatorsForTenant = async (
  tenantId: string,
  locale: Locale,
  options: CursorPageOptions
): Promise<ListCreatorsResult> => {
  "use cache";
  cacheTag(`creators-${tenantId}`);

  const t = await getMessagesFor(locale);

  try {
    const response = await apiClient.creator.listCreators(
      {
        ...cursorPageRequest(options),
        tenant: { tenantId },
      },
      withServiceHeaders()
    );

    return {
      ...cursorPageTokens(response),
      // Keep the server's keyset order; client re-sorting would break paging.
      creators: (response.creators ?? []).map((item) => mapCreator(item)),
      ok: true,
    };
  } catch (error) {
    // A `"use cache"` scope cannot rethrow: the fill would fail the whole
    // request. The entry is dropped instead, so the answer comes back as soon
    // as the API does.
    dropFailedCacheEntry();
    return {
      ...emptyCursorPageTokens,
      creators: [],
      message: await mapErrorToMessage(
        error,
        t("admin.creators.list_failed"),
        locale
      ),
      ok: false,
    };
  }
};

export const listCreators = async (
  options: CursorPageOptions = {}
): Promise<ListCreatorsResult> => {
  const { locale, tenantId } = await verifyAdminPageSession();
  return listCreatorsForTenant(tenantId, locale, options);
};

/**
 * The cached body of {@link listAllCreators}, keyed on the tenant and locale it is given.
 *
 * Exported for a Server Action, which cannot read the `[tenant_id]` segment
 * and is given the tenant by the client: it calls `verifyAdminSession` with
 * that tenant first, because the service credential this reads with answers
 * for any tenant.
 */
export const listAllCreatorsForTenant = async (
  tenantId: string,
  locale: Locale
): Promise<ListCreatorsResult> => {
  "use cache";
  cacheTag(`creators-${tenantId}`);

  const t = await getMessagesFor(locale);

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
          withServiceHeaders()
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
      dropFailedCacheEntry();
      return {
        ...emptyCursorPageTokens,
        creators: [],
        message: t("admin.creators.list_failed"),
        ok: false,
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
    // A `"use cache"` scope cannot rethrow: the fill would fail the whole
    // request. The entry is dropped instead, so the answer comes back as soon
    // as the API does.
    dropFailedCacheEntry();
    return {
      ...emptyCursorPageTokens,
      creators: [],
      message: await mapErrorToMessage(
        error,
        t("admin.creators.list_failed"),
        locale
      ),
      ok: false,
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
export const listAllCreators = async (): Promise<ListCreatorsResult> => {
  const { locale, tenantId } = await verifyAdminPageSession();
  return listAllCreatorsForTenant(tenantId, locale);
};

export const createCreator = async (
  input: {
    tenantId: string;
    name: string;
    profileText: string;
    iconImageContentType?: string;
    iconImageData?: Uint8Array;
    /** Where in the upload the square is cut; omitted, the API centres it. */
    iconImageCrop?: CropRect;
  },
  locale: Locale
): Promise<CreateCreatorResult> => {
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
    const response = await apiClient.creator.createCreator(
      {
        iconImageContentType: input.iconImageContentType,
        iconImageCrop: input.iconImageCrop,
        iconImageData: input.iconImageData,
        name: input.name,
        profileText: input.profileText,
        tenant: { tenantId: input.tenantId },
      },
      withSessionHeaders(sessionId)
    );

    if (!response.creator?.publicId?.trim()) {
      return {
        message: t("admin.creators.save_failed"),
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
      message: await mapErrorToMessage(
        error,
        t("admin.creators.save_failed"),
        locale
      ),
      ok: false,
    };
  }
};

export const updateCreator = async (
  input: {
    tenantId: string;
    id: string;
    name: string;
    profileText: string;
    clearIconImage?: boolean;
    iconImageContentType?: string;
    iconImageData?: Uint8Array;
    /** Where in the upload the square is cut; omitted, the API centres it. */
    iconImageCrop?: CropRect;
  },
  locale: Locale
): Promise<UpdateCreatorResult> => {
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
    const response = await apiClient.creator.updateCreator(
      {
        clearIconImage: input.clearIconImage,
        creatorId: input.id,
        iconImageContentType: input.iconImageContentType,
        iconImageCrop: input.iconImageCrop,
        iconImageData: input.iconImageData,
        name: input.name,
        profileText: input.profileText,
        tenant: { tenantId: input.tenantId },
      },
      withSessionHeaders(sessionId)
    );

    if (!response.creator?.publicId?.trim()) {
      return {
        message: t("admin.creators.save_failed"),
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
      message: await mapErrorToMessage(
        error,
        t("admin.creators.save_failed"),
        locale
      ),
      ok: false,
    };
  }
};

const getCreatorForSession = async (
  input: {
    tenantId: string;
    publicId: string;
  },
  locale: Locale,
  sessionId: string
): Promise<GetCreatorResult> => {
  "use cache: private";
  cacheTag(`creators-${input.tenantId}`);
  cacheTag(`creator-${input.tenantId}-${input.publicId}`);

  const t = await getMessagesFor(locale);
  if (!sessionId) {
    dropFailedCacheEntry();
    return {
      message: t("errors.rpc.unauthenticated"),
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
      dropFailedCacheEntry();
      return {
        message: t("admin.creators.list_failed"),
        ok: false,
      };
    }

    return {
      accounts: mapCreatorAccounts(response.accounts),
      creator: mapCreator(response.creator),
      ok: true,
    };
  } catch (error) {
    rethrowUnclassifiedRpcError(error);
    if (isMissingResourceRpcError(error)) {
      return { notFound: true, ok: false };
    }
    dropFailedCacheEntry();
    return {
      message: await mapErrorToMessage(
        error,
        t("admin.creators.list_failed"),
        locale
      ),
      ok: false,
      requiresSignIn: isUnauthenticatedError(error),
    };
  }
};

export const getCreator = async (
  input: {
    tenantId: string;
    publicId: string;
  },
  locale: Locale
): Promise<GetCreatorResult> =>
  getCreatorForSession(input, locale, await getAccessToken());

export interface CreatorAccountInput {
  tenantId: string;
  /** The creator's primary key. */
  creatorId: string;
  /** The reader's primary key. */
  readerId: string;
}

export type ChangeCreatorAccountResult =
  | { ok: true; accounts: CreatorAccountItem[] }
  | { ok: false; message: string };

/** Links a reader account to a creator. Tenant admins only. */
export const linkCreatorAccount = async (
  input: CreatorAccountInput,
  locale: Locale
): Promise<ChangeCreatorAccountResult> => {
  const [t, sessionId] = await Promise.all([
    getMessagesFor(locale),
    getAccessToken(),
  ]);
  if (!sessionId) {
    return { message: t("errors.rpc.unauthenticated"), ok: false };
  }

  try {
    const response = await apiClient.creator.linkCreatorAccount(
      {
        creatorId: input.creatorId,
        readerId: input.readerId,
        tenant: { tenantId: input.tenantId },
      },
      withSessionHeaders(sessionId)
    );

    return { accounts: mapCreatorAccounts(response.accounts), ok: true };
  } catch (error) {
    rethrowUnauthenticatedRpcError(error);
    rethrowUnclassifiedRpcError(error);
    return {
      message: rpcErrorMessage(
        error,
        t("admin.creators.accounts.link_failed"),
        {
          locale,
          overrides: {
            // The API's one precondition: the reader is suspended, or has not
            // confirmed their address yet.
            precondition: t("admin.creators.accounts.reader_not_active"),
          },
        }
      ),
      ok: false,
    };
  }
};

/** Removes a link between a reader account and a creator. Tenant admins only. */
export const unlinkCreatorAccount = async (
  input: CreatorAccountInput,
  locale: Locale
): Promise<ChangeCreatorAccountResult> => {
  const [t, sessionId] = await Promise.all([
    getMessagesFor(locale),
    getAccessToken(),
  ]);
  if (!sessionId) {
    return { message: t("errors.rpc.unauthenticated"), ok: false };
  }

  try {
    const response = await apiClient.creator.unlinkCreatorAccount(
      {
        creatorId: input.creatorId,
        readerId: input.readerId,
        tenant: { tenantId: input.tenantId },
      },
      withSessionHeaders(sessionId)
    );

    return { accounts: mapCreatorAccounts(response.accounts), ok: true };
  } catch (error) {
    rethrowUnauthenticatedRpcError(error);
    rethrowUnclassifiedRpcError(error);
    return {
      message: rpcErrorMessage(
        error,
        t("admin.creators.accounts.unlink_failed"),
        { locale }
      ),
      ok: false,
    };
  }
};
