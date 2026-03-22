import { apiClient, buildSessionHeaders, resolveSessionId } from "./api-client";

export interface PlatformEndUserSummary {
  createdAt: string;
  email: string;
  name: string;
  publicId: string;
  status: string;
  tenantIds: string[];
}

export interface ListPlatformEndUsersInput {
  createdAfter?: string;
  createdBefore?: string;
  limit?: number;
  offset?: number;
  status?: string;
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

export const listPlatformEndUsers = async (
  input: ListPlatformEndUsersInput
): Promise<ListPlatformEndUsersResult> => {
  const sid = await resolveSessionId();
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
        status: input.status ?? "",
      } as never,
      buildSessionHeaders(sid)
    );
    return {
      ok: true,
      users: (response.users ?? []).map(mapEndUser),
    };
  } catch (error) {
    console.error("[listPlatformEndUsers] API error:", error);
    const message =
      error instanceof Error ? error.message : "不明なエラーが発生しました。";
    return { message, ok: false };
  }
};

export type GetPlatformEndUserResult =
  | { ok: true; user: PlatformEndUserSummary | null }
  | { ok: false; message: string };

export const getPlatformEndUser = async (
  publicId: string
): Promise<GetPlatformEndUserResult> => {
  const normalizedPublicId = normalizePublicId(publicId);
  if (!normalizedPublicId) {
    return { ok: true, user: null };
  }

  const sid = await resolveSessionId();
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

  const sid = await resolveSessionId();
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

  const sid = await resolveSessionId();
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

  const sid = await resolveSessionId();
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
