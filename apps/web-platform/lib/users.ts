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
  tenantPublicId?: string;
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

const createdAtInRange = (
  createdAt: string,
  createdAfter?: string,
  createdBefore?: string
): boolean => {
  if (!createdAfter && !createdBefore) {
    return true;
  }

  const timestamp = Date.parse(createdAt);
  if (Number.isNaN(timestamp)) {
    return false;
  }

  if (createdAfter) {
    const after = Date.parse(createdAfter);
    if (!Number.isNaN(after) && timestamp < after) {
      return false;
    }
  }

  if (createdBefore) {
    const before = Date.parse(createdBefore);
    if (!Number.isNaN(before) && timestamp > before) {
      return false;
    }
  }

  return true;
};

const normalizeTenantPublicId = (input: ListPlatformEndUsersInput): string =>
  input.tenantPublicId?.trim() ?? "";

const normalizePublicIds = (input: ListPlatformEndUsersInput): string[] => [
  ...new Set(
    (input.publicIds ?? []).map((value) => value.trim()).filter(Boolean)
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
  normalizedTenantPublicId: string
): PlatformEndUserSummary[] =>
  [...mergedUsers.values()].map((user) => {
    const preferredTenantId = normalizedTenantPublicId
      ? user.tenantIds.find((tenantId) => tenantId === normalizedTenantPublicId)
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

const listTenantScopedUsersFallback = async (
  sid: string,
  input: ListPlatformEndUsersInput,
  publicIdsSet: Set<string>
): Promise<{
  tenantNameMap: Map<string, string>;
  users: PlatformEndUserSummary[];
}> => {
  const normalizedTenantPublicId = normalizeTenantPublicId(input);
  const tenantsPerPage = 200;
  const membersPerPage = 200;
  const allUsers = new Map<string, PlatformEndUserSummary>();
  const tenantNameMap = new Map<string, string>();

  for (let tenantPage = 0; tenantPage < 20; tenantPage += 1) {
    const tenantOffset = tenantPage * tenantsPerPage;
    const tenantResponse = await apiClient.tenants.listTenants(
      {
        limit: tenantsPerPage,
        name: "",
        offset: tenantOffset,
        status: "",
      } as never,
      buildSessionHeaders(sid)
    );

    const tenants = tenantResponse.tenants ?? [];
    if (tenants.length === 0) {
      break;
    }

    for (const tenant of tenants) {
      tenantNameMap.set(tenant.publicId, tenant.name ?? tenant.publicId);
      if (
        normalizedTenantPublicId &&
        tenant.publicId !== normalizedTenantPublicId
      ) {
        continue;
      }

      for (let memberPage = 0; memberPage < 20; memberPage += 1) {
        const memberOffset = memberPage * membersPerPage;
        const memberResponse = await apiClient.tenants.listTenantMembers(
          {
            limit: membersPerPage,
            offset: memberOffset,
            tenantPublicId: tenant.publicId,
          } as never,
          buildSessionHeaders(sid)
        );

        const members = memberResponse.members ?? [];
        if (members.length === 0) {
          break;
        }

        for (const member of members) {
          if (shouldSkipFallbackMember(member, input, publicIdsSet, allUsers)) {
            continue;
          }
          addFallbackMemberUser(allUsers, member, tenant);
        }

        if (members.length < membersPerPage) {
          break;
        }
      }
    }

    if (tenants.length < tenantsPerPage) {
      break;
    }
  }

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
    const normalizedTenantPublicId = normalizeTenantPublicId(input);
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
      } as never,
      buildSessionHeaders(sid)
    );

    const mappedUsers = (response.users ?? [])
      .map(mapEndUser)
      .filter((user) =>
        normalizedTenantPublicId
          ? (user.tenantIds ?? []).includes(normalizedTenantPublicId)
          : true
      );
    const { tenantNameMap, users: tenantScopedUsers } =
      await listTenantScopedUsersFallback(sid, input, publicIdsSet);

    const mergedUsers = mergeUsers(mappedUsers, tenantScopedUsers);
    const usersWithTenantInfo = enrichUsersWithTenantInfo(
      mergedUsers,
      tenantNameMap,
      normalizedTenantPublicId
    );

    return {
      ok: true,
      users: paginateUsers(usersWithTenantInfo, input),
    };
  } catch (error) {
    console.error("[listPlatformEndUsers] API error:", error);
    const message =
      error instanceof Error ? error.message : "不明なエラーが発生しました。";
    return { message, ok: false };
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
    const tenantsPerPage = 200;
    const options: PlatformTenantFilterOption[] = [];

    for (let tenantPage = 0; tenantPage < 20; tenantPage += 1) {
      const offset = tenantPage * tenantsPerPage;
      const response = await apiClient.tenants.listTenants(
        {
          limit: tenantsPerPage,
          name: "",
          offset,
          status: "",
        } as never,
        buildSessionHeaders(sid)
      );

      const tenants = response.tenants ?? [];
      if (tenants.length === 0) {
        break;
      }

      options.push(
        ...tenants.map((tenant) => ({
          name: tenant.name,
          publicId: tenant.publicId,
        }))
      );

      if (tenants.length < tenantsPerPage) {
        break;
      }
    }

    return options;
  } catch {
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
    console.error("[getPlatformEndUser] API error:", error);
    const message =
      error instanceof Error ? error.message : "不明なエラーが発生しました。";
    return { message, ok: false };
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
  } catch {
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
  } catch {
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
  } catch {
    return { message: genericErrorMessage, ok: false };
  }
};
