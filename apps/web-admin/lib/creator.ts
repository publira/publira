import type {
  Creator,
  CreatorAccount,
  CreatorCredit,
  CreditedEpisode,
  CreditedSeries,
} from "@publira/api-client/admin/types";
import { rpcErrorMessage } from "@publira/api-client/error-messages";
import {
  isMissingResourceRpcError,
  RPC_ERROR_REASON,
  rethrowUnclassifiedRpcError,
  rpcErrorDisposition,
  rpcErrorHasReason,
} from "@publira/api-client/errors";
import type { RpcErrorReason } from "@publira/api-client/errors";
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
import type { CachedRead } from "./cached-read";
import { settleCachedRead } from "./cached-read";
import { creatorRolesCacheTag } from "./creator-roles";
import type { CropRect } from "./crop-rect";
import type { CursorPageOptions, CursorPageTokens } from "./cursor-page";
import {
  cursorPageRequest,
  cursorPageTokens,
  emptyCursorPageTokens,
} from "./cursor-page";
import { episodesCacheTag } from "./episode";
import { mentionsStorageNotConfigured } from "./image-rejection";
import { getMessagesFor } from "./messages";
import type { AdminMessageKey } from "./messages";
import { mapReader } from "./reader";
import { seriesListCacheTag } from "./series";
import { getAccessToken } from "./session";

export interface CreatorItem {
  /** The primary key an edit addresses the creator by. */
  id: string;
  /** What the creator's page is addressed by in the URL. */
  publicId: string;
  name: string;
  profileText: string;
  iconImageUrl: string;
  iconImageFileSizeBytes: bigint;
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
 * Where the console sends a staff member to clear what keeps an Author from
 * being deleted, for a refusal it can point to: `credits` is the Credits
 * section of the Author's own screen.
 */
export type CreatorDeletionReference = "credits";

export type DeleteCreatorResult =
  | { ok: true }
  | { ok: false; message: string; reference?: CreatorDeletionReference };

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
  cause: unknown,
  fallbackMessage: string,
  locale: Locale
): Promise<string> => {
  const t = await getMessagesFor(locale);

  return rpcErrorMessage(cause, fallbackMessage, {
    locale,
    overrides: {
      precondition: mentionsStorageNotConfigured(cause)
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
  iconImageFileSizeBytes: creator.iconImageFileSizeBytes ?? 0n,
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
): Promise<CachedRead<GetCreatorResult>> => {
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
      unexpected: rpcErrorDisposition(error) === "unexpected",
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
  settleCachedRead(
    await getCreatorForSession(input, locale, await getAccessToken())
  );

/** A series or an episode a credit names, as far as a row links to it. */
export interface CreditedItem {
  /** The primary key the admin API addresses it by. */
  id: string;
  /** What its console screen is addressed by in the URL. */
  publicId: string;
  /** In the tenant's default locale; empty when it has no translation. */
  title: string;
}

/**
 * One credit naming an Author: on the series when `episode` is unset, on that
 * episode of the series when it is set.
 */
export interface CreatorCreditItem {
  series: CreditedItem;
  episode?: CreditedItem;
  /** The role's primary key, or empty where {@link roleName} is. */
  roleId: string;
  /**
   * The role's name, or empty for a credit written before the tenant had
   * roles, which states none.
   */
  roleName: string;
}

export type ListCreatorCreditsResult = CursorPageTokens &
  (
    | { ok: true; credits: CreatorCreditItem[] }
    | {
        ok: false;
        message: string;
        credits: CreatorCreditItem[];
        /** The API rejected the session — the page raises the login redirect. */
        requiresSignIn?: boolean;
      }
  );

/** The generated `CreatorCredit` fields {@link mapCreatorCredits} reads. */
type RawCreatorCredit = Pick<CreatorCredit, "episode" | "role" | "series">;

/** The generated `CreditedSeries` / `CreditedEpisode` fields a row reads. */
type RawCreditedItem =
  | Pick<CreditedEpisode, "id" | "publicId" | "title">
  | Pick<CreditedSeries, "id" | "publicId" | "title">;

const mapCreditedItem = ({
  id,
  publicId,
  title,
}: RawCreditedItem): CreditedItem => ({
  id: id ?? "",
  publicId: publicId ?? "",
  title: title ?? "",
});

const mapCreatorCredits = (
  credits: RawCreatorCredit[] | undefined
): CreatorCreditItem[] =>
  // A credit whose series the response left out has nowhere to link to.
  (credits ?? []).flatMap(({ episode, role, series }) =>
    series
      ? [
          {
            episode: episode ? mapCreditedItem(episode) : undefined,
            roleId: role?.id ?? "",
            roleName: role?.name ?? "",
            series: mapCreditedItem(series),
          },
        ]
      : []
  );

const listCreatorCreditsForSession = async (
  input: {
    tenantId: string;
    /** The creator's primary key. */
    creatorId: string;
    token: string;
  },
  locale: Locale,
  sessionId: string
): Promise<CachedRead<ListCreatorCreditsResult>> => {
  "use cache: private";
  // A credit is written with the series or the episode it is on, and a row
  // shows their titles and the role's name, so the writes that clear these
  // tags are the ones that change what the list reports.
  cacheTag(`creators-${input.tenantId}`);
  cacheTag(seriesListCacheTag(input.tenantId));
  cacheTag(episodesCacheTag(input.tenantId));
  cacheTag(creatorRolesCacheTag(input.tenantId));

  const t = await getMessagesFor(locale);

  if (!sessionId) {
    dropFailedCacheEntry();

    return {
      ...emptyCursorPageTokens,
      credits: [],
      message: t("errors.rpc.unauthenticated"),
      ok: false,
      requiresSignIn: true,
    };
  }

  try {
    const response = await apiClient.creator.listCreatorCredits(
      {
        ...cursorPageRequest({ token: input.token }),
        creatorId: input.creatorId,
        tenant: { tenantId: input.tenantId },
      },
      withSessionHeaders(sessionId)
    );

    return {
      ...cursorPageTokens(response),
      // Keep the server's order: grouped by series, the series' own credit
      // first and then its episodes in reading order.
      credits: mapCreatorCredits(response.credits),
      ok: true,
    };
  } catch (error) {
    dropFailedCacheEntry();

    return {
      ...emptyCursorPageTokens,
      credits: [],
      message: rpcErrorMessage(error, t("admin.creators.credits.list_failed"), {
        locale,
      }),
      ok: false,
      requiresSignIn: isUnauthenticatedError(error),
      unexpected: rpcErrorDisposition(error) === "unexpected",
    };
  }
};

/**
 * One page of the series and episode credits naming an Author, read with the
 * operator's session: the service credential is not admitted on this RPC.
 */
export const listCreatorCredits = async (
  input: {
    tenantId: string;
    /** The creator's primary key. */
    creatorId: string;
    token?: string;
  },
  locale: Locale
): Promise<ListCreatorCreditsResult> =>
  settleCachedRead(
    await listCreatorCreditsForSession(
      { ...input, token: input.token ?? "" },
      locale,
      await getAccessToken()
    )
  );

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

/**
 * What `DeleteCreator` refuses an Author for, in the order the API checks
 * them, with the sentence each is worded in and, where there is one, the
 * place to clear it from. A credit points to the Credits section of the
 * Author's own screen, whose rows open each series and episode crediting them;
 * a linked account is cleared under **Reader accounts** on the same screen,
 * and a royalty statement line is never cleared.
 */
const CREATOR_DELETION_REFUSALS: readonly {
  message: AdminMessageKey;
  reason: RpcErrorReason;
  reference?: CreatorDeletionReference;
}[] = [
  {
    message: "admin.creators.delete.refused.credited",
    reason: RPC_ERROR_REASON.creatorCredited,
    reference: "credits",
  },
  {
    message: "admin.creators.delete.refused.on_royalty_statement",
    reason: RPC_ERROR_REASON.creatorOnRoyaltyStatement,
  },
  {
    message: "admin.creators.delete.refused.has_linked_account",
    reason: RPC_ERROR_REASON.creatorHasLinkedAccount,
  },
];

/**
 * Deletes an Author that nothing refers to. Tenant admins only. A refusal
 * names what refers to them from the ErrorInfo reason rather than the server's
 * English message, and one with no reason this console knows is still worded
 * as a refusal rather than a failure.
 */
export const deleteCreator = async (
  input: { tenantId: string; id: string },
  locale: Locale
): Promise<DeleteCreatorResult> => {
  const [t, sessionId] = await Promise.all([
    getMessagesFor(locale),
    getAccessToken(),
  ]);

  if (!sessionId) {
    return { message: t("errors.rpc.unauthenticated"), ok: false };
  }

  try {
    await apiClient.creator.deleteCreator(
      { creatorId: input.id, tenant: { tenantId: input.tenantId } },
      withSessionHeaders(sessionId)
    );

    return { ok: true };
  } catch (error) {
    rethrowUnauthenticatedRpcError(error);
    rethrowUnclassifiedRpcError(error);

    const refusal = CREATOR_DELETION_REFUSALS.find(({ reason }) =>
      rpcErrorHasReason(error, reason)
    );

    if (refusal) {
      return {
        message: t(refusal.message),
        ok: false,
        reference: refusal.reference,
      };
    }

    return {
      message: rpcErrorMessage(error, t("admin.creators.delete.failed"), {
        locale,
        overrides: {
          "not-found": t("admin.creators.delete.not_found"),
          precondition: t("admin.creators.delete.refused.referenced"),
        },
      }),
      ok: false,
    };
  }
};
