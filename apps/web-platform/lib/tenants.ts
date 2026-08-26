import { rpcErrorMessage } from "@publira/api-client/error-messages";
import {
  isMissingResourceRpcError,
  rethrowUnclassifiedRpcError,
  rpcErrorHasFieldViolation,
} from "@publira/api-client/errors";
import type { PlatformApiClient } from "@publira/api-client/platform/client";
import { dropFailedCacheEntry } from "@publira/utils/cached-read";

import {
  apiClient,
  buildSessionHeaders,
  resolveAccessToken,
} from "./api-client";
import {
  isUnauthenticatedError,
  rethrowUnauthenticatedRpcError,
} from "./auth-shared";

export interface PlatformTenantSummary {
  adminDomain: string;
  createdAt: string;
  domain: string;
  name: string;
  publicId: string;
  status: string;
}

export interface ListPlatformTenantsInput {
  limit?: number;
  name?: string;
  status?: string;
  token?: string;
}

export interface PlatformTenantDetail {
  adminDomain: string;
  createdAt: string;
  domain: string;
  name: string;
  publicId: string;
  status: string;
}

/**
 * The tenant, or why it could not be read.
 *
 * `tenant: null` is the missing / invisible record the caller turns into
 * `notFound()`; `ok: false` is a read that failed, which a 404 would misreport.
 * A rejected session used to leave here as a throw, and a `"use cache"` fill
 * that throws fails the whole request (`apps/AGENTS.md`), so it now travels as
 * `requiresSignIn` and the page raises the redirect outside the cache scope.
 */
export type GetPlatformTenantResult =
  | { ok: true; tenant: PlatformTenantDetail | null }
  | { message: string; ok: false; requiresSignIn: boolean };

export interface PlatformTenantMemberSummary {
  createdAt: string;
  email: string;
  name: string;
  role: string;
  status: string;
  userPublicId: string;
}

export interface PlatformTenantAdminInvitation {
  acceptedAt: string;
  canceledAt: string;
  createdAt: string;
  email: string;
  expiresAt: string;
  id: string;
  status: string;
}

export interface ListPlatformTenantAdminInvitationsInput {
  limit?: number;
  tenantId: string;
  token?: string;
}

export type ListPlatformTenantAdminInvitationsResult =
  | {
      invitations: PlatformTenantAdminInvitation[];
      nextToken: string;
      ok: true;
      previousToken: string;
    }
  | {
      invitations: PlatformTenantAdminInvitation[];
      message: string;
      nextToken: string;
      ok: false;
      previousToken: string;
      /** The API rejected the session — the page raises the login redirect. */
      requiresSignIn: boolean;
    };

export interface CreatePlatformTenantInput {
  adminDomain?: string;
  domain: string;
  initialAdminEmails?: string[];
  name: string;
}

export type CreatePlatformTenantResult =
  | { ok: true; publicId?: string }
  | { ok: false; message: string };

const genericErrorMessage =
  "テナント作成に失敗しました。時間をおいて再試行してください。";

export type ListPlatformTenantsResult =
  | {
      nextToken: string;
      ok: true;
      previousToken: string;
      tenants: PlatformTenantSummary[];
    }
  | {
      message: string;
      nextToken: string;
      ok: false;
      previousToken: string;
      /** The API rejected the session — the page raises the login redirect. */
      requiresSignIn: boolean;
      tenants: PlatformTenantSummary[];
    };

export const listPlatformTenants = async (
  input: ListPlatformTenantsInput
): Promise<ListPlatformTenantsResult> => {
  "use cache: private";

  const sid = await resolveAccessToken();
  if (!sid) {
    dropFailedCacheEntry();
    return {
      message: "セッションが無効です。再ログインしてください。",
      nextToken: "",
      ok: false,
      previousToken: "",
      requiresSignIn: true,
      tenants: [],
    };
  }

  try {
    const response = await apiClient.tenants.listTenants(
      {
        limit: input.limit ?? 20,
        name: input.name ?? "",
        publicId: "",
        status: input.status ?? "",
        token: input.token ?? "",
      },
      buildSessionHeaders(sid)
    );
    return {
      nextToken: response.nextToken ?? "",
      ok: true,
      previousToken: response.previousToken ?? "",
      tenants: (response.tenants ?? []).map((tenant) => ({
        adminDomain: tenant.adminDomain,
        createdAt: tenant.createdAt,
        domain: tenant.domain,
        name: tenant.name,
        publicId: tenant.publicId,
        status: tenant.status,
      })),
    };
  } catch (error) {
    rethrowUnclassifiedRpcError(error);
    // A failed read must not be cached: the client router would replay it after
    // the API recovers, and a cached `requiresSignIn` would bounce the operator
    // back to /login even once they have signed in again.
    dropFailedCacheEntry();
    return {
      message: rpcErrorMessage(
        error,
        "テナント一覧の取得に失敗しました。時間をおいて再試行してください。"
      ),
      nextToken: "",
      ok: false,
      previousToken: "",
      requiresSignIn: isUnauthenticatedError(error),
      tenants: [],
    };
  }
};

/**
 * The generated `Tenant` message. `publira.platform.v1` has no `types` subpath,
 * so the message is named through the client method that returns it
 * (`apps/AGENTS.md`).
 */
type TenantMessage = Awaited<
  ReturnType<PlatformApiClient["tenants"]["listTenants"]>
>["tenants"][number];

/**
 * The generated `Tenant` fields {@link mapTenant} reads. Naming them against
 * the message type is what makes a proto rename fail here — a restated
 * structural type keeps compiling, and the detail page then renders a tenant
 * whose domain column is blank with nothing pointing at the cause.
 */
type RawTenant = Pick<
  TenantMessage,
  "adminDomain" | "createdAt" | "domain" | "name" | "publicId" | "status"
>;

const mapTenant = (tenant?: RawTenant): PlatformTenantDetail | null => {
  if (!tenant) {
    return null;
  }

  return {
    adminDomain: tenant.adminDomain,
    createdAt: tenant.createdAt,
    domain: tenant.domain,
    name: tenant.name,
    publicId: tenant.publicId,
    status: tenant.status,
  };
};

export const getPlatformTenant = async (
  publicId: string
): Promise<GetPlatformTenantResult> => {
  "use cache: private";

  const sid = await resolveAccessToken();
  if (!sid) {
    return {
      message: "セッションが無効です。再ログインしてください。",
      ok: false,
      requiresSignIn: true,
    };
  }
  if (!publicId.trim()) {
    return { ok: true, tenant: null };
  }

  try {
    const response = await apiClient.tenants.getTenant(
      { publicId } as never,
      buildSessionHeaders(sid)
    );
    return { ok: true, tenant: mapTenant(response.tenant) };
  } catch (error) {
    // The caller turns `tenant: null` into `notFound()`. A rejected session is
    // not a missing tenant, so it stays a failure and reaches the
    // re-authentication path instead of showing a 404.
    if (isMissingResourceRpcError(error)) {
      return { ok: true, tenant: null };
    }
    rethrowUnclassifiedRpcError(error);
    // A failed read must not be cached: the client router would replay it after
    // the API recovers, and a cached `requiresSignIn` would bounce the operator
    // back to /login even once they have signed in again.
    dropFailedCacheEntry();
    return {
      message: rpcErrorMessage(
        error,
        "テナントの取得に失敗しました。時間をおいて再試行してください。"
      ),
      ok: false,
      requiresSignIn: isUnauthenticatedError(error),
    };
  }
};

export interface ListPlatformTenantMembersInput {
  limit?: number;
  tenantId: string;
  token?: string;
}

export type ListPlatformTenantMembersResult =
  | {
      members: PlatformTenantMemberSummary[];
      nextToken: string;
      ok: true;
      previousToken: string;
    }
  | {
      members: PlatformTenantMemberSummary[];
      message: string;
      nextToken: string;
      ok: false;
      previousToken: string;
      /** The API rejected the session — the page raises the login redirect. */
      requiresSignIn: boolean;
    };

export const listPlatformTenantMembers = async (
  input: ListPlatformTenantMembersInput
): Promise<ListPlatformTenantMembersResult> => {
  "use cache: private";

  const tenantId = input.tenantId.trim();
  const sid = await resolveAccessToken();
  if (!tenantId || !sid) {
    dropFailedCacheEntry();
    return {
      members: [],
      message: "セッションが無効です。再ログインしてください。",
      nextToken: "",
      ok: false,
      previousToken: "",
      requiresSignIn: !sid,
    };
  }

  try {
    const response = await apiClient.tenants.listTenantMembers(
      {
        limit: input.limit ?? 20,
        tenantPublicId: tenantId,
        token: input.token ?? "",
      },
      buildSessionHeaders(sid)
    );
    return {
      members: (response.members ?? []).map((member) => ({
        createdAt: member.createdAt,
        email: member.email,
        name: member.name,
        role: member.role,
        status: member.status,
        userPublicId: member.userPublicId,
      })),
      nextToken: response.nextToken ?? "",
      ok: true,
      previousToken: response.previousToken ?? "",
    };
  } catch (error) {
    rethrowUnclassifiedRpcError(error);
    dropFailedCacheEntry();
    return {
      members: [],
      message: rpcErrorMessage(
        error,
        "メンバー一覧の取得に失敗しました。時間をおいて再試行してください。"
      ),
      nextToken: "",
      ok: false,
      previousToken: "",
      requiresSignIn: isUnauthenticatedError(error),
    };
  }
};

export const suspendPlatformTenant = async (
  publicId: string
): Promise<boolean> => {
  const sid = await resolveAccessToken();
  if (!publicId.trim() || !sid) {
    return false;
  }

  try {
    await apiClient.tenants.suspendTenant(
      { publicId } as never,
      buildSessionHeaders(sid)
    );
    return true;
  } catch (error) {
    rethrowUnauthenticatedRpcError(error);
    rethrowUnclassifiedRpcError(error);
    return false;
  }
};

export const resumePlatformTenant = async (
  publicId: string
): Promise<boolean> => {
  const sid = await resolveAccessToken();
  if (!publicId.trim() || !sid) {
    return false;
  }

  try {
    await apiClient.tenants.resumeTenant(
      { publicId } as never,
      buildSessionHeaders(sid)
    );
    return true;
  } catch (error) {
    rethrowUnauthenticatedRpcError(error);
    rethrowUnclassifiedRpcError(error);
    return false;
  }
};

/**
 * `already_exists` may name either domain field. The server identifies the
 * rejected field with `google.rpc.BadRequest`, so this wording stays stable
 * when its message changes.
 */
const duplicateDomainMessage = (error: unknown, verb: string): string => {
  if (rpcErrorHasFieldViolation(error, "admin_domain")) {
    return "管理画面ドメインが既に使用されています。";
  }
  if (rpcErrorHasFieldViolation(error, "domain")) {
    return "ドメインが既に使用されています。";
  }
  return `重複するデータがあるため${verb}できません。`;
};

export const createPlatformTenant = async (
  input: CreatePlatformTenantInput
): Promise<CreatePlatformTenantResult> => {
  const sid = await resolveAccessToken();
  if (!sid) {
    return {
      message: "セッションが無効です。再ログインしてください。",
      ok: false,
    };
  }

  const name = input.name.trim();
  const domain = input.domain.trim();
  const adminDomain = input.adminDomain?.trim() ?? "";
  const initialAdminEmails = (input.initialAdminEmails ?? []).flatMap(
    (email) => {
      const trimmed = email.trim();
      return trimmed.length > 0 ? [trimmed] : [];
    }
  );

  try {
    const response = await apiClient.tenants.createTenant(
      {
        adminDomain,
        domain,
        initialAdminEmails,
        name,
      } as never,
      buildSessionHeaders(sid)
    );

    return {
      ok: true,
      publicId: response.tenant?.publicId,
    };
  } catch (error) {
    rethrowUnauthenticatedRpcError(error);
    rethrowUnclassifiedRpcError(error);
    return {
      message: rpcErrorMessage(error, genericErrorMessage, {
        conflict: duplicateDomainMessage(error, "作成"),
      }),
      ok: false,
    };
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
  tenantId: string;
}

export type AddPlatformTenantMemberResult =
  | { ok: true }
  | { ok: false; message: string };

export type RemovePlatformTenantMemberResult =
  | { ok: true }
  | { ok: false; message: string };

export type CreateTenantAdminInvitationResult =
  | {
      ok: true;
      invitation?: PlatformTenantAdminInvitation;
      roleGrantedImmediately?: boolean;
    }
  | { ok: false; message: string };

export type UpdateTenantAdminInvitationResult =
  | { ok: true; invitation?: PlatformTenantAdminInvitation }
  | { ok: false; message: string };

/** The generated `TenantAdminInvitation` message (see {@link TenantMessage}). */
type TenantAdminInvitationMessage = Awaited<
  ReturnType<PlatformApiClient["tenants"]["listTenantAdminInvitations"]>
>["invitations"][number];

/**
 * The generated `TenantAdminInvitation` fields {@link mapInvitation} reads.
 * Naming them against the message type is what makes a proto rename fail here —
 * a restated structural type is a second copy of the message that goes on
 * compiling once the two drift.
 */
type RawTenantAdminInvitation = Pick<
  TenantAdminInvitationMessage,
  | "acceptedAt"
  | "canceledAt"
  | "createdAt"
  | "email"
  | "expiresAt"
  | "id"
  | "status"
>;

const mapInvitation = (
  invitation: RawTenantAdminInvitation
): PlatformTenantAdminInvitation => ({
  acceptedAt: invitation.acceptedAt,
  canceledAt: invitation.canceledAt,
  createdAt: invitation.createdAt,
  email: invitation.email,
  expiresAt: invitation.expiresAt,
  id: invitation.id,
  status: invitation.status,
});

export const listPlatformTenantAdminInvitations = async (
  input: ListPlatformTenantAdminInvitationsInput
): Promise<ListPlatformTenantAdminInvitationsResult> => {
  "use cache: private";

  const tenantId = input.tenantId.trim();
  const sid = await resolveAccessToken();
  if (!tenantId || !sid) {
    dropFailedCacheEntry();
    return {
      invitations: [],
      message: "セッションが無効です。再ログインしてください。",
      nextToken: "",
      ok: false,
      previousToken: "",
      requiresSignIn: !sid,
    };
  }

  try {
    const response = await apiClient.tenants.listTenantAdminInvitations(
      {
        limit: input.limit ?? 20,
        tenantPublicId: tenantId,
        token: input.token ?? "",
      },
      buildSessionHeaders(sid)
    );
    return {
      invitations: (response.invitations ?? []).map((invitation) =>
        mapInvitation(invitation)
      ),
      nextToken: response.nextToken ?? "",
      ok: true,
      previousToken: response.previousToken ?? "",
    };
  } catch (error) {
    rethrowUnclassifiedRpcError(error);
    // A failed read must not be cached: the client router would replay it after
    // the API recovers, and a cached `requiresSignIn` would bounce the operator
    // back to /login even once they have signed in again.
    dropFailedCacheEntry();
    return {
      invitations: [],
      message: rpcErrorMessage(
        error,
        "管理者招待一覧の取得に失敗しました。時間をおいて再試行してください。"
      ),
      nextToken: "",
      ok: false,
      previousToken: "",
      requiresSignIn: isUnauthenticatedError(error),
    };
  }
};

export const createPlatformTenantAdminInvitation = async (
  tenantId: string,
  email: string
): Promise<CreateTenantAdminInvitationResult> => {
  const sid = await resolveAccessToken();
  if (!sid) {
    return {
      message: "セッションが無効です。再ログインしてください。",
      ok: false,
    };
  }
  if (!tenantId.trim() || !email.trim()) {
    return { message: "必須項目が入力されていません。", ok: false };
  }

  try {
    const response = await apiClient.tenants.createTenantAdminInvitation(
      {
        email: email.trim().toLowerCase(),
        tenantId: tenantId.trim(),
      } as never,
      buildSessionHeaders(sid)
    );
    return {
      invitation: response.invitation
        ? mapInvitation(response.invitation)
        : undefined,
      ok: true,
      roleGrantedImmediately: response.roleGrantedImmediately,
    };
  } catch (error) {
    rethrowUnauthenticatedRpcError(error);
    rethrowUnclassifiedRpcError(error);
    return {
      message: rpcErrorMessage(
        error,
        "招待の作成に失敗しました。時間をおいて再試行してください。",
        {
          // Email is the only free-form field on this call.
          "invalid-argument": "メールアドレスの形式を確認してください。",
        }
      ),
      ok: false,
    };
  }
};

export const resendPlatformTenantAdminInvitation = async (
  tenantId: string,
  invitationId: string
): Promise<UpdateTenantAdminInvitationResult> => {
  const sid = await resolveAccessToken();
  if (!sid) {
    return {
      message: "セッションが無効です。再ログインしてください。",
      ok: false,
    };
  }
  if (!tenantId.trim() || !invitationId.trim()) {
    return { message: "必須項目が入力されていません。", ok: false };
  }

  try {
    const response = await apiClient.tenants.resendTenantAdminInvitation(
      {
        invitationId: invitationId.trim(),
        tenantId: tenantId.trim(),
      } as never,
      buildSessionHeaders(sid)
    );
    return {
      invitation: response.invitation
        ? mapInvitation(response.invitation)
        : undefined,
      ok: true,
    };
  } catch (error) {
    rethrowUnauthenticatedRpcError(error);
    rethrowUnclassifiedRpcError(error);
    return {
      message: rpcErrorMessage(
        error,
        "招待メールの再送に失敗しました。時間をおいて再試行してください。",
        {
          "not-found": "対象の招待が見つかりません。",
          precondition: "この招待は再送できない状態です。",
        }
      ),
      ok: false,
    };
  }
};

export const cancelPlatformTenantAdminInvitation = async (
  tenantId: string,
  invitationId: string
): Promise<UpdateTenantAdminInvitationResult> => {
  const sid = await resolveAccessToken();
  if (!sid) {
    return {
      message: "セッションが無効です。再ログインしてください。",
      ok: false,
    };
  }
  if (!tenantId.trim() || !invitationId.trim()) {
    return { message: "必須項目が入力されていません。", ok: false };
  }

  try {
    const response = await apiClient.tenants.cancelTenantAdminInvitation(
      {
        invitationId: invitationId.trim(),
        tenantId: tenantId.trim(),
      } as never,
      buildSessionHeaders(sid)
    );
    return {
      invitation: response.invitation
        ? mapInvitation(response.invitation)
        : undefined,
      ok: true,
    };
  } catch (error) {
    rethrowUnauthenticatedRpcError(error);
    rethrowUnclassifiedRpcError(error);
    return {
      message: rpcErrorMessage(
        error,
        "招待の取り消しに失敗しました。時間をおいて再試行してください。",
        {
          "not-found": "対象の招待が見つかりません。",
          precondition: "この招待は取り消しできない状態です。",
        }
      ),
      ok: false,
    };
  }
};

export const updatePlatformTenant = async (
  publicId: string,
  name: string,
  domain: string,
  adminDomain?: string
): Promise<UpdatePlatformTenantResult> => {
  const sid = await resolveAccessToken();
  if (!sid) {
    return {
      message: "セッションが無効です。再ログインしてください。",
      ok: false,
    };
  }
  const trimmedName = name.trim();
  const trimmedDomain = domain.trim();
  const trimmedAdminDomain = adminDomain?.trim() ?? "";
  if (!trimmedName) {
    return { message: "テナント名は必須です。", ok: false };
  }
  if (!trimmedDomain) {
    return { message: "ドメインは必須です。", ok: false };
  }

  try {
    await apiClient.tenants.updateTenant(
      {
        adminDomain: trimmedAdminDomain,
        domain: trimmedDomain,
        name: trimmedName,
        publicId,
      } as never,
      buildSessionHeaders(sid)
    );
    return { ok: true };
  } catch (error) {
    rethrowUnauthenticatedRpcError(error);
    rethrowUnclassifiedRpcError(error);
    return {
      message: rpcErrorMessage(
        error,
        "更新に失敗しました。時間をおいて再試行してください。",
        {
          conflict: duplicateDomainMessage(error, "更新"),
          "not-found": "テナントが見つかりません。",
        }
      ),
      ok: false,
    };
  }
};

export const addPlatformTenantMember = async (
  input: AddPlatformTenantMemberInput
): Promise<AddPlatformTenantMemberResult> => {
  const tenantId = input.tenantId.trim();
  const role = input.role.trim();
  const email = input.email.trim();

  if (!tenantId || !email || !role) {
    return { message: "必須項目が入力されていません。", ok: false };
  }

  const sid = await resolveAccessToken();
  if (!sid) {
    return {
      message: "セッションが無効です。再ログインしてください。",
      ok: false,
    };
  }

  try {
    await apiClient.tenants.addTenantMember(
      {
        email: email.toLowerCase(),
        role,
        tenantId,
      } as never,
      buildSessionHeaders(sid)
    );
    return { ok: true };
  } catch (error) {
    rethrowUnauthenticatedRpcError(error);
    rethrowUnclassifiedRpcError(error);
    return {
      message: rpcErrorMessage(
        error,
        "メンバー追加に失敗しました。時間をおいて再試行してください。",
        {
          conflict: "このユーザーは既にメンバーとして追加されています。",
          "not-found": "指定したメールアドレスのユーザーが見つかりません。",
        }
      ),
      ok: false,
    };
  }
};

export const updatePlatformTenantMemberRole = async (
  tenantId: string,
  userPublicId: string,
  role: string
): Promise<UpdatePlatformTenantMemberRoleResult> => {
  const sid = await resolveAccessToken();
  if (!sid) {
    return {
      message: "セッションが無効です。再ログインしてください。",
      ok: false,
    };
  }

  if (!tenantId.trim() || !userPublicId.trim() || !role.trim()) {
    return { message: "必須項目が入力されていません。", ok: false };
  }

  try {
    await apiClient.tenants.updateTenantMemberRole(
      {
        role: role.trim(),
        tenantId: tenantId.trim(),
        userPublicId: userPublicId.trim(),
      } as never,
      buildSessionHeaders(sid)
    );

    return { ok: true };
  } catch (error) {
    rethrowUnauthenticatedRpcError(error);
    rethrowUnclassifiedRpcError(error);
    return {
      message: rpcErrorMessage(
        error,
        "ロール変更に失敗しました。時間をおいて再試行してください。",
        {
          "not-found": "対象のメンバーが見つかりません。",
        }
      ),
      ok: false,
    };
  }
};

export const removePlatformTenantMember = async (
  tenantId: string,
  userPublicId: string
): Promise<RemovePlatformTenantMemberResult> => {
  const sid = await resolveAccessToken();
  if (!sid) {
    return {
      message: "セッションが無効です。再ログインしてください。",
      ok: false,
    };
  }

  if (!tenantId.trim() || !userPublicId.trim()) {
    return { message: "必須項目が入力されていません。", ok: false };
  }

  try {
    await apiClient.tenants.removeTenantMember(
      {
        tenantId: tenantId.trim(),
        userPublicId: userPublicId.trim(),
      } as never,
      buildSessionHeaders(sid)
    );

    return { ok: true };
  } catch (error) {
    rethrowUnauthenticatedRpcError(error);
    rethrowUnclassifiedRpcError(error);
    return {
      message: rpcErrorMessage(
        error,
        "メンバー削除に失敗しました。時間をおいて再試行してください。",
        {
          "not-found": "対象のメンバーが見つかりません。",
        }
      ),
      ok: false,
    };
  }
};
