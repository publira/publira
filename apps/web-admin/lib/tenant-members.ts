import type {
  TenantAdminInvitation,
  TenantMember,
} from "@publira/api-client/admin/types";
import { rpcErrorMessage } from "@publira/api-client/error-messages";
import type { RpcErrorMessageOverrides } from "@publira/api-client/error-messages";
import {
  RPC_ERROR_REASON,
  rethrowUnclassifiedRpcError,
  rpcErrorHasReason,
} from "@publira/api-client/errors";
import type { Locale } from "@publira/i18n";
import { cacheTag } from "next/cache";

import {
  isUnauthenticatedError,
  rethrowUnauthenticatedRpcError,
} from "./admin-auth-shared";
import { apiClient, withSessionHeaders } from "./api";
import type { CursorPageOptions, CursorPageTokens } from "./cursor-page";
import {
  cursorPageRequest,
  cursorPageTokens,
  emptyCursorPageTokens,
} from "./cursor-page";
import { getMessagesFor } from "./messages";
import { getAccessToken } from "./session";

export interface TenantMemberItem {
  userPublicId: string;
  name: string;
  email: string;
  role: string;
  status: string;
  createdAt: string;
}

export interface TenantAdminInvitationItem {
  id: string;
  email: string;
  status: string;
  createdAt: string;
  expiresAt: string;
}

export type ListTenantMembersResult = CursorPageTokens &
  (
    | { ok: true; members: TenantMemberItem[] }
    | {
        ok: false;
        message: string;
        members: TenantMemberItem[];
        /** The API rejected the session — the page raises the login redirect. */
        requiresSignIn: boolean;
      }
  );

export type ListTenantAdminInvitationsResult = CursorPageTokens &
  (
    | { ok: true; invitations: TenantAdminInvitationItem[] }
    | {
        ok: false;
        message: string;
        invitations: TenantAdminInvitationItem[];
        /** The API rejected the session — the page raises the login redirect. */
        requiresSignIn: boolean;
      }
  );

export type UpdateTenantMemberRoleResult =
  | { ok: true; member: TenantMemberItem }
  | { ok: false; message: string };

export type RemoveTenantMemberResult =
  | { ok: true; userPublicId: string }
  | { ok: false; message: string };

/**
 * `roleGrantedImmediately` is an address that already belongs to a user of the
 * tenant: the API made them a tenant admin on the spot and mailed nothing.
 */
export type CreateTenantAdminInvitationResult =
  | { ok: true; roleGrantedImmediately: boolean }
  | { ok: false; message: string };

export type TenantAdminInvitationWriteResult =
  | { ok: true }
  | { ok: false; message: string };

/** The tag every member read is filed under, and every member write drops. */
export const tenantMembersCacheTag = (tenantId: string): string =>
  `tenant-members-${tenantId}`;

/** The tag every invitation read is filed under, and every invitation write drops. */
export const tenantAdminInvitationsCacheTag = (tenantId: string): string =>
  `tenant-admin-invitations-${tenantId}`;

type RawTenantMember = Pick<
  TenantMember,
  "createdAt" | "email" | "name" | "role" | "status" | "userPublicId"
>;

const mapTenantMember = (member: RawTenantMember): TenantMemberItem => ({
  createdAt: member.createdAt ?? "",
  email: member.email ?? "",
  name: member.name ?? "",
  role: member.role ?? "",
  status: member.status ?? "",
  userPublicId: member.userPublicId ?? "",
});

type RawTenantAdminInvitation = Pick<
  TenantAdminInvitation,
  "createdAt" | "email" | "expiresAt" | "id" | "status"
>;

const mapTenantAdminInvitation = (
  invitation: RawTenantAdminInvitation
): TenantAdminInvitationItem => ({
  createdAt: invitation.createdAt ?? "",
  email: invitation.email ?? "",
  expiresAt: invitation.expiresAt ?? "",
  id: invitation.id ?? "",
  status: invitation.status ?? "",
});

/**
 * The API refuses to leave the tenant without an active tenant admin, and a
 * self-removal or self-demotion is refused through the same reason when it
 * would. Any other failed precondition keeps the operation's own fallback.
 */
const lastAdminOverride = (error: unknown, message: string) =>
  rpcErrorHasReason(error, RPC_ERROR_REASON.lastTenantAdmin)
    ? message
    : undefined;

const invitationStateOverride = async (
  error: unknown,
  locale: Locale,
  fallback: string
): Promise<RpcErrorMessageOverrides> => {
  const t = await getMessagesFor(locale);

  return {
    "not-found": t("admin.members.invitation_not_found"),
    precondition: rpcErrorHasReason(error, RPC_ERROR_REASON.invitationCanceled)
      ? t("admin.members.invitation_already_canceled")
      : fallback,
  };
};

export const listTenantMembers = async (
  tenantId: string,
  locale: Locale,
  options: CursorPageOptions = {}
): Promise<ListTenantMembersResult> => {
  "use cache: private";
  cacheTag(tenantMembersCacheTag(tenantId));

  const [t, sessionId] = await Promise.all([
    getMessagesFor(locale),
    getAccessToken(),
  ]);
  if (!sessionId) {
    return {
      ...emptyCursorPageTokens,
      members: [],
      message: t("errors.rpc.unauthenticated"),
      ok: false,
      requiresSignIn: true,
    };
  }

  try {
    const response = await apiClient.members.listTenantMembers(
      { ...cursorPageRequest(options), tenant: { tenantId } },
      withSessionHeaders(sessionId)
    );

    return {
      ...cursorPageTokens(response),
      members: (response.members ?? []).map((member) =>
        mapTenantMember(member)
      ),
      ok: true,
    };
  } catch (error) {
    rethrowUnclassifiedRpcError(error);
    return {
      ...emptyCursorPageTokens,
      members: [],
      message: rpcErrorMessage(error, t("admin.members.list_failed"), {
        locale,
      }),
      ok: false,
      requiresSignIn: isUnauthenticatedError(error),
    };
  }
};

export const listTenantAdminInvitations = async (
  tenantId: string,
  locale: Locale,
  options: CursorPageOptions = {}
): Promise<ListTenantAdminInvitationsResult> => {
  "use cache: private";
  cacheTag(tenantAdminInvitationsCacheTag(tenantId));

  const [t, sessionId] = await Promise.all([
    getMessagesFor(locale),
    getAccessToken(),
  ]);
  if (!sessionId) {
    return {
      ...emptyCursorPageTokens,
      invitations: [],
      message: t("errors.rpc.unauthenticated"),
      ok: false,
      requiresSignIn: true,
    };
  }

  try {
    const response = await apiClient.members.listTenantAdminInvitations(
      { ...cursorPageRequest(options), tenant: { tenantId } },
      withSessionHeaders(sessionId)
    );

    return {
      ...cursorPageTokens(response),
      invitations: (response.invitations ?? []).map((invitation) =>
        mapTenantAdminInvitation(invitation)
      ),
      ok: true,
    };
  } catch (error) {
    rethrowUnclassifiedRpcError(error);
    return {
      ...emptyCursorPageTokens,
      invitations: [],
      message: rpcErrorMessage(
        error,
        t("admin.members.invitations_list_failed"),
        { locale }
      ),
      ok: false,
      requiresSignIn: isUnauthenticatedError(error),
    };
  }
};

export const updateTenantMemberRole = async (
  input: { tenantId: string; userPublicId: string; role: string },
  locale: Locale
): Promise<UpdateTenantMemberRoleResult> => {
  const [t, sessionId] = await Promise.all([
    getMessagesFor(locale),
    getAccessToken(),
  ]);
  if (!sessionId) {
    return { message: t("errors.rpc.unauthenticated"), ok: false };
  }

  try {
    const response = await apiClient.members.updateTenantMemberRole(
      {
        role: input.role,
        tenant: { tenantId: input.tenantId },
        userPublicId: input.userPublicId,
      },
      withSessionHeaders(sessionId)
    );
    if (!response.member?.userPublicId?.trim()) {
      return { message: t("admin.members.role_update_failed"), ok: false };
    }

    return { member: mapTenantMember(response.member), ok: true };
  } catch (error) {
    rethrowUnauthenticatedRpcError(error);
    rethrowUnclassifiedRpcError(error);
    return {
      message: rpcErrorMessage(error, t("admin.members.role_update_failed"), {
        locale,
        overrides: {
          "not-found": t("admin.members.member_not_found"),
          precondition: lastAdminOverride(
            error,
            t("admin.members.last_admin_demote")
          ),
        },
      }),
      ok: false,
    };
  }
};

export const removeTenantMember = async (
  input: { tenantId: string; userPublicId: string },
  locale: Locale
): Promise<RemoveTenantMemberResult> => {
  const [t, sessionId] = await Promise.all([
    getMessagesFor(locale),
    getAccessToken(),
  ]);
  if (!sessionId) {
    return { message: t("errors.rpc.unauthenticated"), ok: false };
  }

  try {
    const response = await apiClient.members.removeTenantMember(
      {
        tenant: { tenantId: input.tenantId },
        userPublicId: input.userPublicId,
      },
      withSessionHeaders(sessionId)
    );

    return {
      ok: true,
      userPublicId: response.userPublicId || input.userPublicId,
    };
  } catch (error) {
    rethrowUnauthenticatedRpcError(error);
    rethrowUnclassifiedRpcError(error);
    return {
      message: rpcErrorMessage(error, t("admin.members.remove_failed"), {
        locale,
        overrides: {
          "not-found": t("admin.members.member_not_found"),
          precondition: lastAdminOverride(
            error,
            t("admin.members.last_admin_remove")
          ),
        },
      }),
      ok: false,
    };
  }
};

export const createTenantAdminInvitation = async (
  input: { tenantId: string; email: string },
  locale: Locale
): Promise<CreateTenantAdminInvitationResult> => {
  const [t, sessionId] = await Promise.all([
    getMessagesFor(locale),
    getAccessToken(),
  ]);
  if (!sessionId) {
    return { message: t("errors.rpc.unauthenticated"), ok: false };
  }

  try {
    const response = await apiClient.members.createTenantAdminInvitation(
      { email: input.email, tenant: { tenantId: input.tenantId } },
      withSessionHeaders(sessionId)
    );

    return {
      ok: true,
      roleGrantedImmediately: response.roleGrantedImmediately,
    };
  } catch (error) {
    rethrowUnauthenticatedRpcError(error);
    rethrowUnclassifiedRpcError(error);
    return {
      message: rpcErrorMessage(error, t("admin.members.invite_failed"), {
        locale,
        overrides: {
          "invalid-argument": t("admin.members.invite_email_invalid"),
        },
      }),
      ok: false,
    };
  }
};

export const resendTenantAdminInvitation = async (
  input: { tenantId: string; invitationId: string },
  locale: Locale
): Promise<TenantAdminInvitationWriteResult> => {
  const [t, sessionId] = await Promise.all([
    getMessagesFor(locale),
    getAccessToken(),
  ]);
  if (!sessionId) {
    return { message: t("errors.rpc.unauthenticated"), ok: false };
  }

  try {
    await apiClient.members.resendTenantAdminInvitation(
      {
        invitationId: input.invitationId,
        tenant: { tenantId: input.tenantId },
      },
      withSessionHeaders(sessionId)
    );

    return { ok: true };
  } catch (error) {
    rethrowUnauthenticatedRpcError(error);
    rethrowUnclassifiedRpcError(error);
    return {
      message: rpcErrorMessage(error, t("admin.members.resend_failed"), {
        locale,
        overrides: await invitationStateOverride(
          error,
          locale,
          t("admin.members.resend_precondition")
        ),
      }),
      ok: false,
    };
  }
};

export const cancelTenantAdminInvitation = async (
  input: { tenantId: string; invitationId: string },
  locale: Locale
): Promise<TenantAdminInvitationWriteResult> => {
  const [t, sessionId] = await Promise.all([
    getMessagesFor(locale),
    getAccessToken(),
  ]);
  if (!sessionId) {
    return { message: t("errors.rpc.unauthenticated"), ok: false };
  }

  try {
    await apiClient.members.cancelTenantAdminInvitation(
      {
        invitationId: input.invitationId,
        tenant: { tenantId: input.tenantId },
      },
      withSessionHeaders(sessionId)
    );

    return { ok: true };
  } catch (error) {
    rethrowUnauthenticatedRpcError(error);
    rethrowUnclassifiedRpcError(error);
    return {
      message: rpcErrorMessage(error, t("admin.members.cancel_failed"), {
        locale,
        overrides: await invitationStateOverride(
          error,
          locale,
          t("admin.members.cancel_precondition")
        ),
      }),
      ok: false,
    };
  }
};
