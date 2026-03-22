import { apiClient, buildSessionHeaders, resolveSessionId } from "./api-client";

export interface PlatformTenantSummary {
  createdAt: string;
  domain: string;
  name: string;
  publicId: string;
  status: string;
  subdomain: string;
}

export interface ListPlatformTenantsInput {
  name?: string;
  status?: string;
}

export interface PlatformTenantDetail {
  createdAt: string;
  domain: string;
  name: string;
  publicId: string;
  status: string;
  subdomain: string;
}

export interface PlatformTenantMemberSummary {
  createdAt: string;
  email: string;
  name: string;
  role: string;
  status: string;
  userPublicId: string;
}

export interface CreatePlatformTenantInput {
  domain?: string;
  initialAdminEmails?: string[];
  name: string;
  subdomain: string;
}

export type CreatePlatformTenantResult =
  | { ok: true; publicId?: string }
  | { ok: false; message: string };

const genericErrorMessage =
  "テナント作成に失敗しました。時間をおいて再試行してください。";

export type ListPlatformTenantsResult =
  | { ok: true; tenants: PlatformTenantSummary[] }
  | { ok: false; message: string };

export const listPlatformTenants = async (
  input: ListPlatformTenantsInput
): Promise<ListPlatformTenantsResult> => {
  const sid = await resolveSessionId();
  if (!sid) {
    return {
      message: "セッションが無効です。再ログインしてください。",
      ok: false,
    };
  }

  try {
    const response = await apiClient.tenants.listTenants(
      {
        name: input.name ?? "",
        status: input.status ?? "",
      } as never,
      buildSessionHeaders(sid)
    );
    return {
      ok: true,
      tenants: (response.tenants ?? []).map((tenant) => ({
        createdAt: tenant.createdAt,
        domain: tenant.domain,
        name: tenant.name,
        publicId: tenant.publicId,
        status: tenant.status,
        subdomain: tenant.subdomain,
      })),
    };
  } catch (error) {
    console.error("[listPlatformTenants] API error:", error);
    const message =
      error instanceof Error ? error.message : "不明なエラーが発生しました。";
    return { message, ok: false };
  }
};

const mapTenant = (tenant?: {
  createdAt: string;
  domain: string;
  name: string;
  publicId: string;
  status: string;
  subdomain: string;
}): PlatformTenantDetail | null => {
  if (!tenant) {
    return null;
  }

  return {
    createdAt: tenant.createdAt,
    domain: tenant.domain,
    name: tenant.name,
    publicId: tenant.publicId,
    status: tenant.status,
    subdomain: tenant.subdomain,
  };
};

export const getPlatformTenant = async (
  publicId: string
): Promise<PlatformTenantDetail | null> => {
  // "use cache: private";

  const sid = await resolveSessionId();
  if (!publicId.trim() || !sid) {
    return null;
  }

  try {
    const response = await apiClient.tenants.getTenant(
      { publicId } as never,
      buildSessionHeaders(sid)
    );
    return mapTenant(response.tenant);
  } catch {
    return null;
  }
};

export const listPlatformTenantMembers = async (
  tenantPublicId: string
): Promise<PlatformTenantMemberSummary[]> => {
  // "use cache: private";

  const sid = await resolveSessionId();
  if (!tenantPublicId.trim() || !sid) {
    return [];
  }

  try {
    const response = await apiClient.tenants.listTenantMembers(
      { tenantPublicId } as never,
      buildSessionHeaders(sid)
    );
    return (response.members ?? []).map((member) => ({
      createdAt: member.createdAt,
      email: member.email,
      name: member.name,
      role: member.role,
      status: member.status,
      userPublicId: member.userPublicId,
    }));
  } catch {
    return [];
  }
};

export const suspendPlatformTenant = async (
  publicId: string
): Promise<boolean> => {
  const sid = await resolveSessionId();
  if (!publicId.trim() || !sid) {
    return false;
  }

  try {
    await apiClient.tenants.suspendTenant(
      { publicId } as never,
      buildSessionHeaders(sid)
    );
    return true;
  } catch {
    return false;
  }
};

export const resumePlatformTenant = async (
  publicId: string
): Promise<boolean> => {
  const sid = await resolveSessionId();
  if (!publicId.trim() || !sid) {
    return false;
  }

  try {
    await apiClient.tenants.resumeTenant(
      { publicId } as never,
      buildSessionHeaders(sid)
    );
    return true;
  } catch {
    return false;
  }
};

export const createPlatformTenant = async (
  input: CreatePlatformTenantInput
): Promise<CreatePlatformTenantResult> => {
  const sid = await resolveSessionId();
  if (!sid) {
    return {
      message: "セッションが無効です。再ログインしてください。",
      ok: false,
    };
  }

  const name = input.name.trim();
  const subdomain = input.subdomain.trim();
  const domain = (input.domain ?? "").trim();
  const initialAdminEmails = (input.initialAdminEmails ?? [])
    .map((email) => email.trim())
    .filter((email) => email.length > 0);

  try {
    const response = await apiClient.tenants.createTenant(
      {
        domain,
        initialAdminEmails,
        name,
        subdomain,
      } as never,
      buildSessionHeaders(sid)
    );

    return {
      ok: true,
      publicId: response.tenant?.publicId,
    };
  } catch (error) {
    if (!(error instanceof Error)) {
      return { message: genericErrorMessage, ok: false };
    }

    const message = error.message.toLowerCase();
    if (
      message.includes("already_exists") ||
      message.includes("already exists")
    ) {
      if (message.includes("subdomain")) {
        return {
          message: "サブドメインが既に使用されています。",
          ok: false,
        };
      }
      if (message.includes("domain")) {
        return {
          message: "ドメインが既に使用されています。",
          ok: false,
        };
      }
      return {
        message: "重複するデータがあるため作成できません。",
        ok: false,
      };
    }

    if (
      message.includes("unauthenticated") ||
      message.includes("permission_denied")
    ) {
      return {
        message: "セッションが無効です。再ログインしてください。",
        ok: false,
      };
    }

    if (
      message.includes("invalid_argument") ||
      message.includes("required") ||
      message.includes("invalid")
    ) {
      return { message: "入力内容に誤りがあります。", ok: false };
    }

    return { message: genericErrorMessage, ok: false };
  }
};

export type UpdatePlatformTenantResult =
  | { ok: true }
  | { ok: false; message: string };

export type UpdatePlatformTenantMemberRoleResult =
  | { ok: true }
  | { ok: false; message: string };

export interface AddPlatformTenantMemberInput {
  email: string;
  role: string;
  tenantPublicId: string;
}

export type AddPlatformTenantMemberResult =
  | { ok: true }
  | { ok: false; message: string };

export type RemovePlatformTenantMemberResult =
  | { ok: true }
  | { ok: false; message: string };

export const updatePlatformTenant = async (
  publicId: string,
  name: string,
  subdomain: string,
  domain: string
): Promise<UpdatePlatformTenantResult> => {
  const sid = await resolveSessionId();
  if (!sid) {
    return {
      message: "セッションが無効です。再ログインしてください。",
      ok: false,
    };
  }
  const trimmedName = name.trim();
  if (!trimmedName) {
    return { message: "テナント名は必須です。", ok: false };
  }

  try {
    await apiClient.tenants.updateTenant(
      {
        domain: domain.trim(),
        name: trimmedName,
        publicId,
        subdomain: subdomain.trim(),
      } as never,
      buildSessionHeaders(sid)
    );
    return { ok: true };
  } catch (error) {
    if (error instanceof Error) {
      const msg = error.message.toLowerCase();
      if (
        msg.includes("unauthenticated") ||
        msg.includes("permission_denied")
      ) {
        return {
          message: "セッションが無効です。再ログインしてください。",
          ok: false,
        };
      }
      if (msg.includes("not_found")) {
        return { message: "テナントが見つかりません。", ok: false };
      }
    }
    return {
      message: "更新に失敗しました。時間をおいて再試行してください。",
      ok: false,
    };
  }
};

const resolvePlatformUserPublicIdByEmail = async (
  email: string,
  sid: string
): Promise<
  { ok: true; userPublicId: string } | { ok: false; message: string }
> => {
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail) {
    return {
      message: "メールアドレスは必須です。",
      ok: false,
    };
  }

  try {
    const operatorsResponse = await apiClient.operators.listOperators(
      {} as never,
      buildSessionHeaders(sid)
    );
    const matchedOperator = (operatorsResponse.operators ?? []).find(
      (operator) => operator.email.trim().toLowerCase() === normalizedEmail
    );

    if (matchedOperator?.publicId) {
      return {
        ok: true,
        userPublicId: matchedOperator.publicId,
      };
    }
  } catch {
    // fallback to end-user search
  }

  const limit = 200;
  const maxPages = 10;

  try {
    for (let page = 0; page < maxPages; page += 1) {
      const offset = page * limit;
      const response = await apiClient.users.listEndUsers(
        {
          createdAfter: "",
          limit,
          offset,
          status: "",
        } as never,
        buildSessionHeaders(sid)
      );

      const users = response.users ?? [];
      const matchedUser = users.find(
        (user) => user.email.trim().toLowerCase() === normalizedEmail
      );

      if (matchedUser?.publicId) {
        return {
          ok: true,
          userPublicId: matchedUser.publicId,
        };
      }

      if (users.length < limit) {
        break;
      }
    }

    return {
      message: "指定したメールアドレスのユーザーが見つかりません。",
      ok: false,
    };
  } catch {
    return {
      message: "ユーザー検索に失敗しました。時間をおいて再試行してください。",
      ok: false,
    };
  }
};

export const addPlatformTenantMember = async (
  input: AddPlatformTenantMemberInput
): Promise<AddPlatformTenantMemberResult> => {
  const tenantPublicId = input.tenantPublicId.trim();
  const role = input.role.trim();
  const email = input.email.trim();

  if (!tenantPublicId || !email || !role) {
    return { message: "必須項目が入力されていません。", ok: false };
  }

  const sid = await resolveSessionId();
  if (!sid) {
    return {
      message: "セッションが無効です。再ログインしてください。",
      ok: false,
    };
  }

  const resolvedUser = await resolvePlatformUserPublicIdByEmail(email, sid);
  if (!resolvedUser.ok) {
    return resolvedUser;
  }

  try {
    await apiClient.tenants.addTenantMember(
      {
        role,
        tenantPublicId,
        userPublicId: resolvedUser.userPublicId,
      } as never,
      buildSessionHeaders(sid)
    );
    return { ok: true };
  } catch (error) {
    if (error instanceof Error) {
      const message = error.message.toLowerCase();
      if (
        message.includes("already_exists") ||
        message.includes("already exists")
      ) {
        return {
          message: "このユーザーは既にメンバーとして追加されています。",
          ok: false,
        };
      }
      if (
        message.includes("unauthenticated") ||
        message.includes("permission_denied")
      ) {
        return {
          message: "この操作を行う権限がありません。",
          ok: false,
        };
      }
    }

    return {
      message: "メンバー追加に失敗しました。時間をおいて再試行してください。",
      ok: false,
    };
  }
};

export const updatePlatformTenantMemberRole = async (
  tenantPublicId: string,
  userPublicId: string,
  role: string
): Promise<UpdatePlatformTenantMemberRoleResult> => {
  const sid = await resolveSessionId();
  if (!sid) {
    return {
      message: "セッションが無効です。再ログインしてください。",
      ok: false,
    };
  }

  if (!tenantPublicId.trim() || !userPublicId.trim() || !role.trim()) {
    return { message: "必須項目が入力されていません。", ok: false };
  }

  try {
    await apiClient.tenants.updateTenantMemberRole(
      {
        role: role.trim(),
        tenantPublicId: tenantPublicId.trim(),
        userPublicId: userPublicId.trim(),
      } as never,
      buildSessionHeaders(sid)
    );

    return { ok: true };
  } catch (error) {
    if (error instanceof Error) {
      const message = error.message.toLowerCase();
      if (message.includes("not_found")) {
        return {
          message: "対象のメンバーが見つかりません。",
          ok: false,
        };
      }
      if (
        message.includes("unauthenticated") ||
        message.includes("permission_denied")
      ) {
        return {
          message: "この操作を行う権限がありません。",
          ok: false,
        };
      }
    }

    return {
      message: "ロール変更に失敗しました。時間をおいて再試行してください。",
      ok: false,
    };
  }
};

export const removePlatformTenantMember = async (
  tenantPublicId: string,
  userPublicId: string
): Promise<RemovePlatformTenantMemberResult> => {
  const sid = await resolveSessionId();
  if (!sid) {
    return {
      message: "セッションが無効です。再ログインしてください。",
      ok: false,
    };
  }

  if (!tenantPublicId.trim() || !userPublicId.trim()) {
    return { message: "必須項目が入力されていません。", ok: false };
  }

  try {
    await apiClient.tenants.removeTenantMember(
      {
        tenantPublicId: tenantPublicId.trim(),
        userPublicId: userPublicId.trim(),
      } as never,
      buildSessionHeaders(sid)
    );

    return { ok: true };
  } catch (error) {
    if (error instanceof Error) {
      const message = error.message.toLowerCase();
      if (message.includes("not_found")) {
        return {
          message: "対象のメンバーが見つかりません。",
          ok: false,
        };
      }
      if (
        message.includes("unauthenticated") ||
        message.includes("permission_denied")
      ) {
        return {
          message: "この操作を行う権限がありません。",
          ok: false,
        };
      }
    }

    return {
      message: "メンバー削除に失敗しました。時間をおいて再試行してください。",
      ok: false,
    };
  }
};
