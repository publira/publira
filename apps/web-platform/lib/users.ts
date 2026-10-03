import { rpcErrorMessage } from "@publira/api-client/error-messages";
import {
  isMissingResourceRpcError,
  rethrowUnclassifiedRpcError,
} from "@publira/api-client/errors";
import type { EndUser, Tenant } from "@publira/api-client/platform/types";
import type { Locale } from "@publira/i18n";
import { dropFailedCacheEntry } from "@publira/utils/cached-read";
import { cacheLife, cacheTag } from "next/cache";

import {
  SHARED_READ_CACHE_LIFE,
  apiClient,
  buildSessionHeaders,
  resolveAccessToken,
  withServiceHeaders,
} from "./api-client";
import { verifyPlatformSession } from "./auth-session";
import { rethrowUnauthenticatedRpcError } from "./auth-shared";
import { getPlatformLocale } from "./locale";
import { getMessagesFor } from "./messages";
import { platformTenantsCacheTag } from "./tenants";

export interface PlatformEndUserSummary {
  createdAt: string;
  email: string;
  id: string;
  name: string;
  primaryTenantName?: string;
  primaryTenantPublicId?: string;
  publicId: string;
  status: string;
  tenantIds: string[];
}

export interface PlatformTenantFilterOption {
  name: string;
  publicId: string;
}

export interface ListPlatformEndUsersInput {
  createdAfter?: string;
  createdBefore?: string;
  limit?: number;
  status?: string;
  tenantId?: string;
  token?: string;
  userIds?: string[];
}

export type ListPlatformEndUsersResult =
  | {
      nextToken: string;
      ok: true;
      previousToken: string;
      users: PlatformEndUserSummary[];
    }
  | {
      ok: false;
      message: string;
      nextToken: string;
      previousToken: string;
      users: PlatformEndUserSummary[];
    };

const normalizePublicId = (publicId: string): string => publicId.trim();

/**
 * The generated `EndUser` fields {@link mapEndUser} reads. Naming them against
 * the message type is what makes a proto rename fail here — a restated
 * structural type keeps compiling, and the user row then shows no tenant at all
 * with nothing pointing at the cause.
 */
type RawEndUser = Pick<
  EndUser,
  | "createdAt"
  | "email"
  | "id"
  | "name"
  | "publicId"
  | "status"
  | "tenantIds"
  | "tenantName"
>;

const mapEndUser = (user: RawEndUser): PlatformEndUserSummary => {
  const tenantIds = user.tenantIds ?? [];
  const tenantName = user.tenantName?.trim() ?? "";

  return {
    createdAt: user.createdAt,
    email: user.email,
    id: user.id,
    name: user.name,
    primaryTenantName: tenantName || undefined,
    primaryTenantPublicId: tenantIds[0],
    publicId: user.publicId,
    status: user.status,
    tenantIds,
  };
};

const normalizeTenantId = (input: ListPlatformEndUsersInput): string =>
  input.tenantId?.trim() ?? "";

const normalizeUserIds = (input: ListPlatformEndUsersInput): string[] => [
  ...new Set(
    (input.userIds ?? []).flatMap((value) => {
      const trimmed = value.trim();
      return trimmed ? [trimmed] : [];
    })
  ),
];

// One page of ListTenants. The picker searches instead of walking every tenant.
const platformTenantFilterSearchLimit = 20;

// public_id is 12 Base58 characters (`server/internal/publicid`). A query of
// that length may be an exact id, so the picker also tries GetTenant.
const publicIdLength = 12;

/** The generated `Tenant` fields {@link toTenantFilterOption} reads. */
type RawTenantFilterOption = Pick<Tenant, "name" | "publicId">;

const toTenantFilterOption = (
  tenant: RawTenantFilterOption
): PlatformTenantFilterOption => ({
  name: tenant.name,
  publicId: tenant.publicId,
});

const mergeTenantFilterOptions = (
  tenants: readonly RawTenantFilterOption[]
): PlatformTenantFilterOption[] => {
  const options: PlatformTenantFilterOption[] = [];
  const seen = new Set<string>();

  for (const tenant of tenants) {
    if (seen.has(tenant.publicId)) {
      continue;
    }
    seen.add(tenant.publicId);
    options.push(toTenantFilterOption(tenant));
  }

  return options;
};

/**
 * The tag every end-user read is filed under. A tenant write that renames a
 * tenant or changes who holds a tenant role clears it too.
 */
export const platformEndUsersCacheTag = "platform:users";

/** What {@link listPlatformEndUsersForLocale} is keyed on besides the locale. */
interface ListPlatformEndUsersQuery {
  createdAfter: string;
  createdBefore: string;
  limit: number;
  status: string;
  tenantPublicId: string;
  token: string;
  userIds: string[];
}

const listPlatformEndUsersForLocale = async (
  locale: Locale,
  query: ListPlatformEndUsersQuery
): Promise<ListPlatformEndUsersResult> => {
  "use cache";
  cacheLife(SHARED_READ_CACHE_LIFE);
  cacheTag(platformEndUsersCacheTag);

  try {
    const response = await apiClient.users.listEndUsers(
      query,
      withServiceHeaders()
    );

    return {
      nextToken: response.nextToken ?? "",
      ok: true,
      previousToken: response.previousToken ?? "",
      users: (response.users ?? []).map((user) => mapEndUser(user)),
    };
  } catch (error) {
    // A `"use cache"` scope cannot rethrow: the fill would fail the whole
    // request. The entry is dropped instead, so the list comes back as soon
    // as the API does.
    dropFailedCacheEntry();
    const t = await getMessagesFor(locale);
    return {
      message: rpcErrorMessage(error, t("platform.users.list_failed"), {
        locale,
      }),
      nextToken: "",
      ok: false,
      previousToken: "",
      users: [],
    };
  }
};

/**
 * One page of the platform's end users, filtered as the users screen asks.
 *
 * Read with the service credential: the list is the same for every operator,
 * so one entry per filter serves all of them.
 */
export const listPlatformEndUsers = async (
  input: ListPlatformEndUsersInput = {}
): Promise<ListPlatformEndUsersResult> => {
  await verifyPlatformSession();
  return listPlatformEndUsersForLocale(await getPlatformLocale(), {
    createdAfter: input.createdAfter ?? "",
    createdBefore: input.createdBefore ?? "",
    limit: Math.max(1, input.limit ?? 20),
    status: input.status ?? "",
    tenantPublicId: normalizeTenantId(input),
    token: input.token ?? "",
    userIds: normalizeUserIds(input),
  });
};

export type SearchPlatformTenantFilterOptionsResult =
  | {
      hasMore: boolean;
      ok: true;
      tenants: PlatformTenantFilterOption[];
    }
  | {
      hasMore: false;
      message: string;
      ok: false;
      tenants: [];
    };

const searchPlatformTenantFilterOptionsForLocale = async (
  locale: Locale,
  normalized: string
): Promise<SearchPlatformTenantFilterOptionsResult> => {
  "use cache";
  cacheLife(SHARED_READ_CACHE_LIFE);
  cacheTag(platformTenantsCacheTag);

  const headers = withServiceHeaders();

  const lookupExactTenant = async () => {
    if (normalized.length !== publicIdLength) {
      return null;
    }

    try {
      return await apiClient.tenants.getTenant(
        { publicId: normalized } as never,
        headers
      );
    } catch (error) {
      if (isMissingResourceRpcError(error)) {
        return null;
      }
      throw error;
    }
  };

  try {
    const [listResponse, exactTenant] = await Promise.all([
      apiClient.tenants.listTenants(
        {
          limit: platformTenantFilterSearchLimit,
          name: normalized,
          status: "",
          token: "",
        },
        headers
      ),
      lookupExactTenant(),
    ]);

    return {
      hasMore: Boolean(listResponse.nextToken),
      ok: true,
      tenants: mergeTenantFilterOptions([
        ...(exactTenant?.tenant ? [exactTenant.tenant] : []),
        ...(listResponse.tenants ?? []),
      ]),
    };
  } catch (error) {
    // A `"use cache"` scope cannot rethrow: the fill would fail the whole
    // request. The entry is dropped instead, so the suggestions come back as
    // soon as the API does.
    dropFailedCacheEntry();
    const t = await getMessagesFor(locale);
    return {
      hasMore: false,
      message: rpcErrorMessage(
        error,
        t("platform.users.tenant_candidates_failed"),
        { locale }
      ),
      ok: false,
      tenants: [],
    };
  }
};

/**
 * The tenants the users screen's tenant filter suggests for what the operator
 * typed, read with the service credential like the tenant list itself.
 */
export const searchPlatformTenantFilterOptions = async (
  query: string
): Promise<SearchPlatformTenantFilterOptionsResult> => {
  await verifyPlatformSession();

  const normalized = query.trim();
  if (!normalized) {
    return { hasMore: false, ok: true, tenants: [] };
  }

  return searchPlatformTenantFilterOptionsForLocale(
    await getPlatformLocale(),
    normalized
  );
};

export type GetPlatformEndUserResult =
  | { ok: true; user: PlatformEndUserSummary | null }
  | { ok: false; message: string };

const getPlatformEndUserForLocale = async (
  locale: Locale,
  publicId: string
): Promise<GetPlatformEndUserResult> => {
  "use cache";
  cacheLife(SHARED_READ_CACHE_LIFE);
  cacheTag(platformEndUsersCacheTag);

  try {
    const response = await apiClient.users.getEndUser(
      { publicId },
      withServiceHeaders()
    );
    return {
      ok: true,
      user: response.user ? mapEndUser(response.user) : null,
    };
  } catch (error) {
    // A `"use cache"` scope cannot rethrow: the fill would fail the whole
    // request. The entry is dropped instead, so the user comes back as soon
    // as the API does.
    dropFailedCacheEntry();
    const t = await getMessagesFor(locale);
    return {
      message: rpcErrorMessage(error, t("platform.users.get_failed"), {
        locale,
      }),
      ok: false,
    };
  }
};

/**
 * One end user, read with the service credential like
 * {@link listPlatformEndUsers}.
 */
export const getPlatformEndUser = async (
  publicId: string
): Promise<GetPlatformEndUserResult> => {
  await verifyPlatformSession();

  const normalizedPublicId = normalizePublicId(publicId);
  if (!normalizedPublicId) {
    return { ok: true, user: null };
  }

  return getPlatformEndUserForLocale(
    await getPlatformLocale(),
    normalizedPublicId
  );
};

export const suspendPlatformEndUser = async (
  userId: string
): Promise<boolean> => {
  const normalizedUserId = userId.trim();
  if (!normalizedUserId) {
    return false;
  }

  const sid = await resolveAccessToken();
  if (!sid) {
    return false;
  }

  try {
    await apiClient.users.suspendEndUser(
      { userId: normalizedUserId },
      buildSessionHeaders(sid)
    );
    return true;
  } catch (error) {
    rethrowUnauthenticatedRpcError(error);
    rethrowUnclassifiedRpcError(error);
    return false;
  }
};

export const unsuspendPlatformEndUser = async (
  userId: string
): Promise<boolean> => {
  const normalizedUserId = userId.trim();
  if (!normalizedUserId) {
    return false;
  }

  const sid = await resolveAccessToken();
  if (!sid) {
    return false;
  }

  try {
    await apiClient.users.unsuspendEndUser(
      { userId: normalizedUserId },
      buildSessionHeaders(sid)
    );
    return true;
  } catch (error) {
    rethrowUnauthenticatedRpcError(error);
    rethrowUnclassifiedRpcError(error);
    return false;
  }
};

export const deletePlatformEndUser = async (
  userId: string,
  locale: Locale
): Promise<{ ok: true } | { ok: false; message: string }> => {
  const t = await getMessagesFor(locale);
  const normalizedUserId = userId.trim();
  if (!normalizedUserId) {
    return {
      message: t("platform.users.invalid_id"),
      ok: false,
    };
  }

  const sid = await resolveAccessToken();
  if (!sid) {
    return {
      message: t("errors.rpc.unauthenticated"),
      ok: false,
    };
  }

  try {
    await apiClient.users.deleteEndUser(
      { userId: normalizedUserId },
      buildSessionHeaders(sid)
    );
    return { ok: true };
  } catch (error) {
    rethrowUnauthenticatedRpcError(error);
    rethrowUnclassifiedRpcError(error);
    return {
      message: rpcErrorMessage(error, t("platform.common.generic_failed"), {
        locale,
      }),
      ok: false,
    };
  }
};
