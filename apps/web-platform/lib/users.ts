import { rpcErrorMessage } from "@publira/api-client/error-messages";
import { rethrowUnclassifiedRpcError } from "@publira/api-client/errors";
import { forEachPageWithToken } from "@publira/api-client/pagination";
import type { CursorPageVisitResult } from "@publira/api-client/pagination";

import {
  apiClient,
  buildSessionHeaders,
  resolveAccessToken,
} from "./api-client";

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
  | { ok: false; message: string };

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

interface PlatformTenantRef {
  name: string;
  publicId: string;
}

const walkPlatformTenants = (
  sid: string,
  onPage: (
    tenants: readonly PlatformTenantRef[]
  ) => CursorPageVisitResult | Promise<CursorPageVisitResult>
) =>
  forEachPageWithToken(async (token, limit) => {
    const response = await apiClient.tenants.listTenants(
      {
        limit,
        name: "",
        publicId: "",
        status: "",
        token,
      },
      buildSessionHeaders(sid)
    );
    return {
      items: response.tenants ?? [],
      nextToken: response.nextToken ?? "",
    };
  }, onPage);

export const listPlatformEndUsers = async (
  input: ListPlatformEndUsersInput
): Promise<ListPlatformEndUsersResult> => {
  "use cache: private";

  const sid = await resolveAccessToken();
  if (!sid) {
    return {
      message: "セッションが無効です。再ログインしてください。",
      ok: false,
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
    };
  }
};

export const listPlatformTenantFilterOptions = async (): Promise<
  PlatformTenantFilterOption[]
> => {
  "use cache: private";

  const sid = await resolveAccessToken();
  if (!sid) {
    return [];
  }

  try {
    const options: PlatformTenantFilterOption[] = [];

    const tenantStop = await walkPlatformTenants(sid, (tenants) => {
      options.push(
        ...tenants.map((tenant) => ({
          name: tenant.name,
          publicId: tenant.publicId,
        }))
      );
    });

    // A partial option list would look like the complete tenant set.
    if (tenantStop !== "completed") {
      return [];
    }

    return options;
  } catch (error) {
    rethrowUnclassifiedRpcError(error);
    return [];
  }
};

export type GetPlatformEndUserResult =
  | { ok: true; user: PlatformEndUserSummary | null }
  | { ok: false; message: string };

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
    rethrowUnclassifiedRpcError(error);
    return { message: genericErrorMessage, ok: false };
  }
};
