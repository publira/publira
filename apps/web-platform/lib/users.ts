import { rpcErrorMessage } from "@publira/api-client/error-messages";
import { rethrowUnclassifiedRpcError } from "@publira/api-client/errors";
import { forEachPageWithToken } from "@publira/api-client/pagination";
import type { CursorPageVisitResult } from "@publira/api-client/pagination";
import { parseInstant } from "@publira/utils";

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
}): PlatformEndUserSummary => ({
  createdAt: user.createdAt,
  email: user.email,
  name: user.name,
  publicId: user.publicId,
  status: user.status,
  tenantIds: user.tenantIds ?? [],
});

/** Inclusive on both ends; `createdAfter` / `createdBefore` are absolute instants. */
const createdAtInRange = (
  createdAt: string,
  createdAfter?: string,
  createdBefore?: string
): boolean => {
  if (!(createdAfter || createdBefore)) {
    return true;
  }

  const timestamp = parseInstant(createdAt);
  if (!timestamp) {
    return false;
  }

  const after = createdAfter ? parseInstant(createdAfter) : null;
  if (after && Temporal.Instant.compare(timestamp, after) < 0) {
    return false;
  }

  const before = createdBefore ? parseInstant(createdBefore) : null;
  if (before && Temporal.Instant.compare(timestamp, before) > 0) {
    return false;
  }

  return true;
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

const shouldSkipFallbackMember = (
  member: {
    createdAt: string;
    status: string;
    userPublicId: string;
  },
  input: ListPlatformEndUsersInput,
  publicIdsSet: Set<string>,
  allUsers: Map<string, PlatformEndUserSummary>
): boolean => {
  const publicId = member.userPublicId;
  if (!publicId || allUsers.has(publicId)) {
    return true;
  }
  if (publicIdsSet.size > 0 && !publicIdsSet.has(publicId)) {
    return true;
  }
  if (input.status && member.status !== input.status) {
    return true;
  }

  return !createdAtInRange(
    member.createdAt,
    input.createdAfter,
    input.createdBefore
  );
};

const addFallbackMemberUser = (
  allUsers: Map<string, PlatformEndUserSummary>,
  member: {
    createdAt: string;
    email: string;
    name: string;
    status: string;
    userPublicId: string;
  },
  tenant: {
    name: string;
    publicId: string;
  }
): void => {
  const publicId = member.userPublicId;
  allUsers.set(publicId, {
    createdAt: member.createdAt,
    email: member.email,
    name: member.name,
    primaryTenantName: tenant.name ?? tenant.publicId,
    primaryTenantPublicId: tenant.publicId,
    publicId,
    status: member.status,
    tenantIds: [tenant.publicId],
  });
};

const mergeUsers = (
  mappedUsers: PlatformEndUserSummary[],
  tenantScopedUsers: PlatformEndUserSummary[]
): Map<string, PlatformEndUserSummary> => {
  const mergedUsers = new Map<string, PlatformEndUserSummary>();
  for (const user of mappedUsers) {
    mergedUsers.set(user.publicId, user);
  }
  for (const user of tenantScopedUsers) {
    const existing = mergedUsers.get(user.publicId);
    if (!existing) {
      mergedUsers.set(user.publicId, user);
      continue;
    }

    const tenantIds = new Set([
      ...(existing.tenantIds ?? []),
      ...(user.tenantIds ?? []),
    ]);
    mergedUsers.set(user.publicId, {
      ...existing,
      primaryTenantName: existing.primaryTenantName ?? user.primaryTenantName,
      primaryTenantPublicId:
        existing.primaryTenantPublicId ?? user.primaryTenantPublicId,
      tenantIds: [...tenantIds],
    });
  }

  return mergedUsers;
};

const enrichUsersWithTenantInfo = (
  mergedUsers: Map<string, PlatformEndUserSummary>,
  tenantNameMap: Map<string, string>,
  normalizedTenantId: string
): PlatformEndUserSummary[] =>
  [...mergedUsers.values()].map((user) => {
    const preferredTenantId = normalizedTenantId
      ? user.tenantIds.find((tenantId) => tenantId === normalizedTenantId)
      : user.tenantIds[0];
    const resolvedTenantId =
      preferredTenantId ?? user.primaryTenantPublicId ?? "";

    if (!resolvedTenantId) {
      return user;
    }

    return {
      ...user,
      primaryTenantName:
        user.primaryTenantName ?? tenantNameMap.get(resolvedTenantId),
      primaryTenantPublicId: resolvedTenantId,
    };
  });

const paginateUsers = (
  users: PlatformEndUserSummary[],
  input: ListPlatformEndUsersInput
): PlatformEndUserSummary[] => {
  const sortedUsers = users.toSorted((left, right) =>
    right.createdAt.localeCompare(left.createdAt)
  );
  const offset = Math.max(0, input.offset ?? 0);
  const limit = Math.max(1, input.limit ?? 20);
  return sortedUsers.slice(offset, offset + limit);
};

const walkPlatformTenants = async (
  sid: string,
  onPage: (
    tenants: readonly { name: string; publicId: string }[]
  ) => CursorPageVisitResult | Promise<CursorPageVisitResult>
): Promise<void> => {
  await forEachPageWithToken(async (token, limit) => {
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
};

const membersPerPage = 100;

const walkTenantMembers = async (
  sid: string,
  tenantPublicId: string,
  onMembers: (
    members: readonly {
      createdAt: string;
      email: string;
      name: string;
      status: string;
      userPublicId: string;
    }[]
  ) => void
): Promise<void> => {
  for (let page = 0; page < 100; page += 1) {
    // Sequential pagination depends on previous page results.
    // oxlint-disable-next-line no-await-in-loop
    const response = await apiClient.tenants.listTenantMembers(
      {
        limit: membersPerPage,
        offset: page * membersPerPage,
        tenantPublicId,
      },
      buildSessionHeaders(sid)
    );

    const members = response.members ?? [];
    if (members.length === 0) {
      break;
    }
    onMembers(members);
    if (members.length < membersPerPage) {
      break;
    }
  }
};

const listTenantScopedUsersFallback = async (
  sid: string,
  input: ListPlatformEndUsersInput,
  publicIdsSet: Set<string>
): Promise<{
  tenantNameMap: Map<string, string>;
  users: PlatformEndUserSummary[];
}> => {
  const normalizedTenantId = normalizeTenantId(input);
  const allUsers = new Map<string, PlatformEndUserSummary>();
  const tenantNameMap = new Map<string, string>();

  await walkPlatformTenants(sid, async (tenants) => {
    for (const tenant of tenants) {
      tenantNameMap.set(tenant.publicId, tenant.name ?? tenant.publicId);
      if (normalizedTenantId && tenant.publicId !== normalizedTenantId) {
        continue;
      }

      // Sequential: the first tenant a user belongs to wins on the shared map.
      // oxlint-disable-next-line no-await-in-loop, react-doctor/async-await-in-loop
      await walkTenantMembers(sid, tenant.publicId, (members) => {
        for (const member of members) {
          if (shouldSkipFallbackMember(member, input, publicIdsSet, allUsers)) {
            continue;
          }
          addFallbackMemberUser(allUsers, member, tenant);
        }
      });
    }
  });

  return {
    tenantNameMap,
    users: [...allUsers.values()],
  };
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
    };
  }

  try {
    const normalizedTenantId = normalizeTenantId(input);
    const publicIds = normalizePublicIds(input);
    const publicIdsSet = new Set(publicIds);

    const response = await apiClient.users.listEndUsers(
      {
        createdAfter: input.createdAfter ?? "",
        createdBefore: input.createdBefore ?? "",
        limit: Math.max(1, input.limit ?? 20),
        offset: Math.max(0, input.offset ?? 0),
        publicIds,
        status: input.status ?? "",
      },
      buildSessionHeaders(sid)
    );

    const mappedUsers = (response.users ?? []).flatMap((rawUser) => {
      const user = mapEndUser(rawUser);
      if (normalizedTenantId) {
        const tenantIds = new Set(user.tenantIds);
        if (!tenantIds.has(normalizedTenantId)) {
          return [];
        }
      }
      return [user];
    });
    const { tenantNameMap, users: tenantScopedUsers } =
      await listTenantScopedUsersFallback(sid, input, publicIdsSet);

    const mergedUsers = mergeUsers(mappedUsers, tenantScopedUsers);
    const usersWithTenantInfo = enrichUsersWithTenantInfo(
      mergedUsers,
      tenantNameMap,
      normalizedTenantId
    );

    return {
      ok: true,
      users: paginateUsers(usersWithTenantInfo, input),
    };
  } catch (error) {
    rethrowUnclassifiedRpcError(error);
    return {
      message: rpcErrorMessage(
        error,
        "ユーザー一覧の取得に失敗しました。時間をおいて再試行してください。"
      ),
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

    await walkPlatformTenants(sid, (tenants) => {
      options.push(
        ...tenants.map((tenant) => ({
          name: tenant.name,
          publicId: tenant.publicId,
        }))
      );
    });

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
