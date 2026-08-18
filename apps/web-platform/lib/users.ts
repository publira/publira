import { rpcErrorMessage } from "@publira/api-client/error-messages";
import {
  isMissingResourceRpcError,
  rethrowUnclassifiedRpcError,
} from "@publira/api-client/errors";

import {
  apiClient,
  buildSessionHeaders,
  resolveAccessToken,
} from "./api-client";
import {
  isUnauthenticatedError,
  rethrowUnauthenticatedRpcError,
} from "./auth-shared";

export interface PlatformEndUserSummary {
  createdAt: string;
  email: string;
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
  offset?: number;
  publicIds?: string[];
  status?: string;
  tenantId?: string;
}

export type ListPlatformEndUsersResult =
  | { ok: true; users: PlatformEndUserSummary[] }
  | {
      ok: false;
      message: string;
      /** The API rejected the session — the page raises the login redirect. */
      requiresSignIn: boolean;
    };

const genericErrorMessage =
  "処理に失敗しました。時間をおいて再試行してください。";

const normalizePublicId = (publicId: string): string => publicId.trim();

const mapEndUser = (user: {
  createdAt: string;
  email: string;
  name: string;
  publicId: string;
  status: string;
  tenantIds: string[];
  tenantName?: string;
}): PlatformEndUserSummary => {
  const tenantIds = user.tenantIds ?? [];
  const tenantName = user.tenantName?.trim() ?? "";

  return {
    createdAt: user.createdAt,
    email: user.email,
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

const normalizePublicIds = (input: ListPlatformEndUsersInput): string[] => [
  ...new Set(
    (input.publicIds ?? []).flatMap((value) => {
      const trimmed = value.trim();
      return trimmed ? [trimmed] : [];
    })
  ),
];

const listErrorMessage =
  "ユーザー一覧の取得に失敗しました。時間をおいて再試行してください。";

const tenantFilterSearchErrorMessage =
  "テナント候補の取得に失敗しました。時間をおいて再試行してください。";

// One page of ListTenants. The picker searches instead of walking every tenant.
const platformTenantFilterSearchLimit = 20;

// public_id is 12 Base58 characters (`server/internal/publicid`). A query of
// that length may be an exact id, so the picker also tries GetTenant.
const publicIdLength = 12;

const toTenantFilterOption = (tenant: {
  name: string;
  publicId: string;
}): PlatformTenantFilterOption => ({
  name: tenant.name,
  publicId: tenant.publicId,
});

const mergeTenantFilterOptions = (
  tenants: readonly { name: string; publicId: string }[]
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

export const listPlatformEndUsers = async (
  input: ListPlatformEndUsersInput
): Promise<ListPlatformEndUsersResult> => {
  "use cache: private";

  const sid = await resolveAccessToken();
  if (!sid) {
    return {
      message: "セッションが無効です。再ログインしてください。",
      ok: false,
      requiresSignIn: true,
    };
  }

  try {
    const response = await apiClient.users.listEndUsers(
      {
        createdAfter: input.createdAfter ?? "",
        createdBefore: input.createdBefore ?? "",
        limit: Math.max(1, input.limit ?? 20),
        offset: Math.max(0, input.offset ?? 0),
        publicIds: normalizePublicIds(input),
        status: input.status ?? "",
        tenantPublicId: normalizeTenantId(input),
      },
      buildSessionHeaders(sid)
    );

    return {
      ok: true,
      users: (response.users ?? []).map((user) => mapEndUser(user)),
    };
  } catch (error) {
    rethrowUnclassifiedRpcError(error);
    return {
      message: rpcErrorMessage(error, listErrorMessage),
      ok: false,
      requiresSignIn: isUnauthenticatedError(error),
    };
  }
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
      /** The API rejected the session — the page raises the login redirect. */
      requiresSignIn: boolean;
      tenants: [];
    };

export const searchPlatformTenantFilterOptions = async (
  query: string
): Promise<SearchPlatformTenantFilterOptionsResult> => {
  "use cache: private";

  const normalized = query.trim();
  if (!normalized) {
    return { hasMore: false, ok: true, tenants: [] };
  }

  const sid = await resolveAccessToken();
  if (!sid) {
    return {
      hasMore: false,
      message: "セッションが無効です。再ログインしてください。",
      ok: false,
      requiresSignIn: true,
      tenants: [],
    };
  }

  const headers = buildSessionHeaders(sid);

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
          publicId: "",
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
    rethrowUnclassifiedRpcError(error);
    return {
      hasMore: false,
      message: rpcErrorMessage(error, tenantFilterSearchErrorMessage),
      ok: false,
      requiresSignIn: isUnauthenticatedError(error),
      tenants: [],
    };
  }
};

export type GetPlatformEndUserResult =
  | { ok: true; user: PlatformEndUserSummary | null }
  | {
      ok: false;
      message: string;
      /** The API rejected the session — the page raises the login redirect. */
      requiresSignIn: boolean;
    };

export const getPlatformEndUser = async (
  publicId: string
): Promise<GetPlatformEndUserResult> => {
  "use cache: private";

  const normalizedPublicId = normalizePublicId(publicId);
  if (!normalizedPublicId) {
    return { ok: true, user: null };
  }

  const sid = await resolveAccessToken();
  if (!sid) {
    return {
      message: "セッションが無効です。再ログインしてください。",
      ok: false,
      requiresSignIn: true,
    };
  }

  try {
    const response = await apiClient.users.getEndUser(
      { publicId: normalizedPublicId } as never,
      buildSessionHeaders(sid)
    );
    return {
      ok: true,
      user: response.user ? mapEndUser(response.user) : null,
    };
  } catch (error) {
    rethrowUnclassifiedRpcError(error);
    return {
      message: rpcErrorMessage(
        error,
        "ユーザー情報の取得に失敗しました。時間をおいて再試行してください。"
      ),
      ok: false,
      requiresSignIn: isUnauthenticatedError(error),
    };
  }
};

export const suspendPlatformEndUser = async (
  publicId: string
): Promise<boolean> => {
  const normalizedPublicId = normalizePublicId(publicId);
  if (!normalizedPublicId) {
    return false;
  }

  const sid = await resolveAccessToken();
  if (!sid) {
    return false;
  }

  try {
    await apiClient.users.suspendEndUser(
      { publicId: normalizedPublicId } as never,
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
  publicId: string
): Promise<boolean> => {
  const normalizedPublicId = normalizePublicId(publicId);
  if (!normalizedPublicId) {
    return false;
  }

  const sid = await resolveAccessToken();
  if (!sid) {
    return false;
  }

  try {
    await apiClient.users.unsuspendEndUser(
      { publicId: normalizedPublicId } as never,
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
  publicId: string
): Promise<{ ok: true } | { ok: false; message: string }> => {
  const normalizedPublicId = normalizePublicId(publicId);
  if (!normalizedPublicId) {
    return { message: "ユーザーIDが不正です。", ok: false };
  }

  const sid = await resolveAccessToken();
  if (!sid) {
    return {
      message: "セッションが無効です。再ログインしてください。",
      ok: false,
    };
  }

  try {
    await apiClient.users.deleteEndUser(
      { publicId: normalizedPublicId } as never,
      buildSessionHeaders(sid)
    );
    return { ok: true };
  } catch (error) {
    rethrowUnauthenticatedRpcError(error);
    rethrowUnclassifiedRpcError(error);
    return { message: genericErrorMessage, ok: false };
  }
};
