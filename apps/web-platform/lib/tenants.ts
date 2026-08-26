import { rpcErrorMessage } from "@publira/api-client/error-messages";
import {
  isMissingResourceRpcError,
  rethrowUnclassifiedRpcError,
  rpcErrorHasFieldViolation,
} from "@publira/api-client/errors";
import type {
  Tenant,
  TenantAdminInvitation,
} from "@publira/api-client/platform/types";
import { getMessage } from "@publira/i18n";
import type { Locale } from "@publira/i18n";
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
import { loadPlatformMessages } from "./locale";
import type { PlatformMessages } from "./locale";

const loadTenantCopy = async (
  locale: Locale
): Promise<{ locale: Locale; messages: PlatformMessages }> => ({
  locale,
  messages: await loadPlatformMessages(locale),
});

const loadTenantCopyAndSession = async (locale: Locale) => {
  const [{ locale: resolvedLocale, messages }, sid] = await Promise.all([
    loadTenantCopy(locale),
    resolveAccessToken(),
  ]);
  return { locale: resolvedLocale, messages, sid };
};

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
  locale: Locale;
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
  locale: Locale;
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
  locale: Locale;
  name: string;
}

export type CreatePlatformTenantResult =
  | { ok: true; publicId?: string }
  | { ok: false; message: string };

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
    const { messages } = await loadTenantCopy(input.locale);
    return {
      message: getMessage(messages, "errors.rpc.unauthenticated"),
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
    const { locale, messages } = await loadTenantCopy(input.locale);
    return {
      message: rpcErrorMessage(
        error,
        getMessage(messages, "platform.tenants.list_failed"),
        { locale }
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
 * The generated `Tenant` fields {@link mapTenant} reads. Naming them against
 * the message type is what makes a proto rename fail here — a restated
 * structural type keeps compiling, and the detail page then renders a tenant
 * whose domain column is blank with nothing pointing at the cause.
 */
type RawTenant = Pick<
  Tenant,
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
  publicId: string,
  locale: Locale
): Promise<GetPlatformTenantResult> => {
  "use cache: private";

  const sid = await resolveAccessToken();
  if (!sid) {
    const { messages } = await loadTenantCopy(locale);
    return {
      message: getMessage(messages, "errors.rpc.unauthenticated"),
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
    const { locale: resolvedLocale, messages } = await loadTenantCopy(locale);
    return {
      message: rpcErrorMessage(
        error,
        getMessage(messages, "platform.tenants.get_failed"),
        { locale: resolvedLocale }
      ),
      ok: false,
      requiresSignIn: isUnauthenticatedError(error),
    };
  }
};

export interface ListPlatformTenantMembersInput {
  limit?: number;
  locale: Locale;
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
    const { messages } = await loadTenantCopy(input.locale);
    return {
      members: [],
      message: getMessage(messages, "errors.rpc.unauthenticated"),
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
    const { locale, messages } = await loadTenantCopy(input.locale);
    return {
      members: [],
      message: rpcErrorMessage(
        error,
        getMessage(messages, "platform.tenants.members_list_failed"),
        { locale }
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
const duplicateDomainMessage = (
  error: unknown,
  messages: PlatformMessages,
  kind: "create" | "update"
): string => {
  if (rpcErrorHasFieldViolation(error, "admin_domain")) {
    return getMessage(messages, "platform.tenants.admin_domain_taken");
  }
  if (rpcErrorHasFieldViolation(error, "domain")) {
    return getMessage(messages, "platform.tenants.domain_taken");
  }
  return getMessage(
    messages,
    kind === "create"
      ? "platform.tenants.duplicate_create"
      : "platform.tenants.duplicate_update"
  );
};

export const createPlatformTenant = async (
  input: CreatePlatformTenantInput
): Promise<CreatePlatformTenantResult> => {
  const {
    locale: resolvedLocale,
    messages,
    sid,
  } = await loadTenantCopyAndSession(input.locale);
  if (!sid) {
    return {
      message: getMessage(messages, "errors.rpc.unauthenticated"),
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
      message: rpcErrorMessage(
        error,
        getMessage(messages, "platform.tenants.create_failed"),
        {
          locale: resolvedLocale,
          overrides: {
            conflict: duplicateDomainMessage(error, messages, "create"),
          },
        }
      ),
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
  locale: Locale;
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

/**
 * The generated `TenantAdminInvitation` fields {@link mapInvitation} reads.
 * Naming them against the message type is what makes a proto rename fail here —
 * a restated structural type is a second copy of the message that goes on
 * compiling once the two drift.
 */
type RawTenantAdminInvitation = Pick<
  TenantAdminInvitation,
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

  const { locale, messages } = await loadTenantCopy(input.locale);
  const tenantId = input.tenantId.trim();
  const sid = await resolveAccessToken();
  if (!tenantId || !sid) {
    dropFailedCacheEntry();
    return {
      invitations: [],
      message: getMessage(messages, "errors.rpc.unauthenticated"),
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
        getMessage(messages, "platform.tenants.invitations_list_failed"),
        { locale }
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
  email: string,
  locale: Locale
): Promise<CreateTenantAdminInvitationResult> => {
  const {
    locale: resolvedLocale,
    messages,
    sid,
  } = await loadTenantCopyAndSession(locale);
  if (!sid) {
    return {
      message: getMessage(messages, "errors.rpc.unauthenticated"),
      ok: false,
    };
  }
  if (!tenantId.trim() || !email.trim()) {
    return {
      message: getMessage(messages, "platform.common.required"),
      ok: false,
    };
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
        getMessage(messages, "platform.tenants.invite_create_failed"),
        {
          locale: resolvedLocale,
          overrides: {
            // Email is the only free-form field on this call.
            "invalid-argument": getMessage(
              messages,
              "platform.tenants.invite_email_invalid"
            ),
          },
        }
      ),
      ok: false,
    };
  }
};

export const resendPlatformTenantAdminInvitation = async (
  tenantId: string,
  invitationId: string,
  locale: Locale
): Promise<UpdateTenantAdminInvitationResult> => {
  const {
    locale: resolvedLocale,
    messages,
    sid,
  } = await loadTenantCopyAndSession(locale);
  if (!sid) {
    return {
      message: getMessage(messages, "errors.rpc.unauthenticated"),
      ok: false,
    };
  }
  if (!tenantId.trim() || !invitationId.trim()) {
    return {
      message: getMessage(messages, "platform.common.required"),
      ok: false,
    };
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
        getMessage(messages, "platform.tenants.resend_invite_failed"),
        {
          locale: resolvedLocale,
          overrides: {
            "not-found": getMessage(
              messages,
              "platform.tenants.invite_not_found"
            ),
            precondition: getMessage(
              messages,
              "platform.tenants.resend_invite_precondition"
            ),
          },
        }
      ),
      ok: false,
    };
  }
};

export const cancelPlatformTenantAdminInvitation = async (
  tenantId: string,
  invitationId: string,
  locale: Locale
): Promise<UpdateTenantAdminInvitationResult> => {
  const {
    locale: resolvedLocale,
    messages,
    sid,
  } = await loadTenantCopyAndSession(locale);
  if (!sid) {
    return {
      message: getMessage(messages, "errors.rpc.unauthenticated"),
      ok: false,
    };
  }
  if (!tenantId.trim() || !invitationId.trim()) {
    return {
      message: getMessage(messages, "platform.common.required"),
      ok: false,
    };
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
        getMessage(messages, "platform.tenants.cancel_invite_failed"),
        {
          locale: resolvedLocale,
          overrides: {
            "not-found": getMessage(
              messages,
              "platform.tenants.invite_not_found"
            ),
            precondition: getMessage(
              messages,
              "platform.tenants.cancel_invite_precondition"
            ),
          },
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
  locale: Locale,
  adminDomain?: string
): Promise<UpdatePlatformTenantResult> => {
  const {
    locale: resolvedLocale,
    messages,
    sid,
  } = await loadTenantCopyAndSession(locale);
  if (!sid) {
    return {
      message: getMessage(messages, "errors.rpc.unauthenticated"),
      ok: false,
    };
  }
  const trimmedName = name.trim();
  const trimmedDomain = domain.trim();
  const trimmedAdminDomain = adminDomain?.trim() ?? "";
  if (!trimmedName) {
    return {
      message: getMessage(messages, "platform.tenants.name_required"),
      ok: false,
    };
  }
  if (!trimmedDomain) {
    return {
      message: getMessage(messages, "platform.tenants.domain_required"),
      ok: false,
    };
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
        getMessage(messages, "platform.tenants.update_failed"),
        {
          locale: resolvedLocale,
          overrides: {
            conflict: duplicateDomainMessage(error, messages, "update"),
            "not-found": getMessage(messages, "platform.tenants.not_found"),
          },
        }
      ),
      ok: false,
    };
  }
};

export const addPlatformTenantMember = async (
  input: AddPlatformTenantMemberInput
): Promise<AddPlatformTenantMemberResult> => {
  const { locale: resolvedLocale, messages } = await loadTenantCopy(
    input.locale
  );
  const tenantId = input.tenantId.trim();
  const role = input.role.trim();
  const email = input.email.trim();

  if (!tenantId || !email || !role) {
    return {
      message: getMessage(messages, "platform.common.required"),
      ok: false,
    };
  }

  const sid = await resolveAccessToken();
  if (!sid) {
    return {
      message: getMessage(messages, "errors.rpc.unauthenticated"),
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
        getMessage(messages, "platform.tenants.add_member_failed"),
        {
          locale: resolvedLocale,
          overrides: {
            conflict: getMessage(
              messages,
              "platform.tenants.member_already_added"
            ),
            "not-found": getMessage(
              messages,
              "platform.tenants.user_not_found"
            ),
          },
        }
      ),
      ok: false,
    };
  }
};

export const updatePlatformTenantMemberRole = async (
  tenantId: string,
  userPublicId: string,
  role: string,
  locale: Locale
): Promise<UpdatePlatformTenantMemberRoleResult> => {
  const {
    locale: resolvedLocale,
    messages,
    sid,
  } = await loadTenantCopyAndSession(locale);
  if (!sid) {
    return {
      message: getMessage(messages, "errors.rpc.unauthenticated"),
      ok: false,
    };
  }

  if (!tenantId.trim() || !userPublicId.trim() || !role.trim()) {
    return {
      message: getMessage(messages, "platform.common.required"),
      ok: false,
    };
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
        getMessage(messages, "platform.tenants.member_role_update_failed"),
        {
          locale: resolvedLocale,
          overrides: {
            "not-found": getMessage(
              messages,
              "platform.tenants.member_not_found"
            ),
          },
        }
      ),
      ok: false,
    };
  }
};

export const removePlatformTenantMember = async (
  tenantId: string,
  userPublicId: string,
  locale: Locale
): Promise<RemovePlatformTenantMemberResult> => {
  const {
    locale: resolvedLocale,
    messages,
    sid,
  } = await loadTenantCopyAndSession(locale);
  if (!sid) {
    return {
      message: getMessage(messages, "errors.rpc.unauthenticated"),
      ok: false,
    };
  }

  if (!tenantId.trim() || !userPublicId.trim()) {
    return {
      message: getMessage(messages, "platform.common.required"),
      ok: false,
    };
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
        getMessage(messages, "platform.tenants.remove_member_failed"),
        {
          locale: resolvedLocale,
          overrides: {
            "not-found": getMessage(
              messages,
              "platform.tenants.member_not_found"
            ),
          },
        }
      ),
      ok: false,
    };
  }
};
