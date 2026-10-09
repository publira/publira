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
import type { PlatformMessageAccessor } from "./messages";

const loadTenantCopy = async (
  locale: Locale
): Promise<{ locale: Locale; t: PlatformMessageAccessor }> => ({
  locale,
  t: await getMessagesFor(locale),
});

const loadTenantCopyAndSession = async (locale: Locale) => {
  const [{ locale: resolvedLocale, t }, sid] = await Promise.all([
    loadTenantCopy(locale),
    resolveAccessToken(),
  ]);
  return { locale: resolvedLocale, sid, t };
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
  name?: string;
  status?: string;
  token?: string;
}

export interface PlatformTenantDetail {
  adminDomain: string;
  createdAt: string;
  domain: string;
  /** The internal ID every write and every read under the tenant sends. */
  id: string;
  name: string;
  publicId: string;
  status: string;
}

/**
 * The tenant, or why it could not be read.
 *
 * `tenant: null` is the missing / invisible record the caller turns into
 * `notFound()`; `ok: false` is a read that failed, which a 404 would misreport.
 */
export type GetPlatformTenantResult =
  | { ok: true; tenant: PlatformTenantDetail | null }
  | { message: string; ok: false };

export interface PlatformTenantMemberSummary {
  createdAt: string;
  email: string;
  name: string;
  role: string;
  status: string;
  userId: string;
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
  /** The tenant's internal ID. */
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
    };

export interface CreatePlatformTenantInput {
  adminDomain?: string;
  /**
   * UI locale the new tenant starts on. Required: the API rejects a create
   * request that does not name one, so the caller decides the language rather
   * than inheriting whatever the server would have picked.
   */
  defaultLocale: Locale;
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
      tenants: PlatformTenantSummary[];
    };

/** The tag every tenant read is filed under, and every tenant write clears. */
export const platformTenantsCacheTag = "platform:tenants";

/**
 * The tag the reads of one tenant carry as well, so a write that touches only
 * its members or invitations leaves every other tenant cached. It is keyed by
 * the tenant's internal ID, which is what those writes carry.
 */
export const platformTenantCacheTag = (tenantId: string): string =>
  `platform:tenants:${tenantId}`;

/** What {@link listPlatformTenantsForLocale} is keyed on besides the locale. */
interface ListPlatformTenantsQuery {
  limit: number;
  name: string;
  status: string;
  token: string;
}

const listPlatformTenantsForLocale = async (
  locale: Locale,
  query: ListPlatformTenantsQuery
): Promise<ListPlatformTenantsResult> => {
  "use cache";
  cacheLife(SHARED_READ_CACHE_LIFE);
  cacheTag(platformTenantsCacheTag);

  try {
    const response = await apiClient.tenants.listTenants(
      query,
      withServiceHeaders()
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
    // A `"use cache"` scope cannot rethrow: the fill would fail the whole
    // request. The entry is dropped instead, so the list comes back as soon
    // as the API does.
    dropFailedCacheEntry();
    const { t } = await loadTenantCopy(locale);
    return {
      message: rpcErrorMessage(error, t("platform.tenants.list_failed"), {
        locale,
      }),
      nextToken: "",
      ok: false,
      previousToken: "",
      tenants: [],
    };
  }
};

/**
 * One page of the platform's tenants, filtered as the tenant list asks.
 *
 * Read with the service credential: the list is the same for every operator,
 * so one entry per filter serves all of them.
 */
export const listPlatformTenants = async (
  input: ListPlatformTenantsInput = {}
): Promise<ListPlatformTenantsResult> => {
  await verifyPlatformSession();
  return listPlatformTenantsForLocale(await getPlatformLocale(), {
    limit: input.limit ?? 20,
    name: input.name ?? "",
    status: input.status ?? "",
    token: input.token ?? "",
  });
};

/**
 * The generated `Tenant` fields {@link mapTenant} reads. Naming them against
 * the message type is what makes a proto rename fail here — a restated
 * structural type keeps compiling, and the detail page then renders a tenant
 * whose domain column is blank with nothing pointing at the cause.
 */
type RawTenant = Pick<
  Tenant,
  "adminDomain" | "createdAt" | "domain" | "id" | "name" | "publicId" | "status"
>;

const mapTenant = (tenant?: RawTenant): PlatformTenantDetail | null => {
  if (!tenant) {
    return null;
  }

  return {
    adminDomain: tenant.adminDomain,
    createdAt: tenant.createdAt,
    domain: tenant.domain,
    id: tenant.id,
    name: tenant.name,
    publicId: tenant.publicId,
    status: tenant.status,
  };
};

const getPlatformTenantForLocale = async (
  locale: Locale,
  publicId: string
): Promise<GetPlatformTenantResult> => {
  "use cache";
  cacheLife(SHARED_READ_CACHE_LIFE);
  cacheTag(platformTenantsCacheTag);

  try {
    const response = await apiClient.tenants.getTenant(
      { publicId },
      withServiceHeaders()
    );
    if (response.tenant) {
      cacheTag(platformTenantCacheTag(response.tenant.id));
    }
    return { ok: true, tenant: mapTenant(response.tenant) };
  } catch (error) {
    // The caller turns `tenant: null` into `notFound()`. Anything else is not
    // a missing tenant, so it stays a failure instead of showing a 404.
    if (isMissingResourceRpcError(error)) {
      return { ok: true, tenant: null };
    }
    // A `"use cache"` scope cannot rethrow: the fill would fail the whole
    // request. The entry is dropped instead, so the tenant comes back as soon
    // as the API does.
    dropFailedCacheEntry();
    const { t } = await loadTenantCopy(locale);
    return {
      message: rpcErrorMessage(error, t("platform.tenants.get_failed"), {
        locale,
      }),
      ok: false,
    };
  }
};

/**
 * Resolves the tenant a URL names by its public ID. Everything else about the
 * tenant is addressed by the internal ID this returns.
 *
 * Read with the service credential, like {@link listPlatformTenants}.
 */
export const getPlatformTenant = async (
  publicId: string
): Promise<GetPlatformTenantResult> => {
  await verifyPlatformSession();

  const normalized = publicId.trim();
  if (!normalized) {
    return { ok: true, tenant: null };
  }

  return getPlatformTenantForLocale(await getPlatformLocale(), normalized);
};

export interface ListPlatformTenantMembersInput {
  limit?: number;
  /** The tenant's internal ID. */
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
    };

/** What a page of a tenant's members or admin invitations is keyed on. */
interface TenantPageQuery {
  limit: number;
  tenantId: string;
  token: string;
}

const listPlatformTenantMembersForLocale = async (
  locale: Locale,
  query: TenantPageQuery
): Promise<ListPlatformTenantMembersResult> => {
  "use cache";
  cacheLife(SHARED_READ_CACHE_LIFE);
  cacheTag(platformTenantsCacheTag, platformTenantCacheTag(query.tenantId));

  try {
    const response = await apiClient.tenants.listTenantMembers(
      query,
      withServiceHeaders()
    );
    return {
      members: (response.members ?? []).map((member) => ({
        createdAt: member.createdAt,
        email: member.email,
        name: member.name,
        role: member.role,
        status: member.status,
        userId: member.userId,
      })),
      nextToken: response.nextToken ?? "",
      ok: true,
      previousToken: response.previousToken ?? "",
    };
  } catch (error) {
    // A `"use cache"` scope cannot rethrow: the fill would fail the whole
    // request. The entry is dropped instead, so the members come back as
    // soon as the API does.
    dropFailedCacheEntry();
    const { t } = await loadTenantCopy(locale);
    return {
      members: [],
      message: rpcErrorMessage(
        error,
        t("platform.tenants.members_list_failed"),
        { locale }
      ),
      nextToken: "",
      ok: false,
      previousToken: "",
    };
  }
};

/**
 * One page of a tenant's members.
 *
 * Read with the service credential: the list is the same for every operator,
 * so one entry per page serves all of them.
 */
export const listPlatformTenantMembers = async (
  input: ListPlatformTenantMembersInput
): Promise<ListPlatformTenantMembersResult> => {
  await verifyPlatformSession();
  return listPlatformTenantMembersForLocale(await getPlatformLocale(), {
    limit: input.limit ?? 20,
    tenantId: input.tenantId.trim(),
    token: input.token ?? "",
  });
};

export const suspendPlatformTenant = async (
  tenantId: string
): Promise<boolean> => {
  const sid = await resolveAccessToken();
  if (!tenantId.trim() || !sid) {
    return false;
  }

  try {
    await apiClient.tenants.suspendTenant(
      { tenantId },
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
  tenantId: string
): Promise<boolean> => {
  const sid = await resolveAccessToken();
  if (!tenantId.trim() || !sid) {
    return false;
  }

  try {
    await apiClient.tenants.resumeTenant(
      { tenantId },
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
const duplicateDomainMessage = async (
  error: unknown,
  locale: Locale,
  kind: "create" | "update"
): Promise<string> => {
  const t = await getMessagesFor(locale);

  if (rpcErrorHasFieldViolation(error, "admin_domain")) {
    return t("platform.tenants.admin_domain_taken");
  }
  if (rpcErrorHasFieldViolation(error, "domain")) {
    return t("platform.tenants.domain_taken");
  }
  return kind === "create"
    ? t("platform.tenants.duplicate_create")
    : t("platform.tenants.duplicate_update");
};

export const createPlatformTenant = async (
  input: CreatePlatformTenantInput
): Promise<CreatePlatformTenantResult> => {
  const {
    locale: resolvedLocale,
    sid,
    t,
  } = await loadTenantCopyAndSession(input.locale);
  if (!sid) {
    return {
      message: t("errors.rpc.unauthenticated"),
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
        defaultLocale: input.defaultLocale,
        domain,
        initialAdminEmails,
        name,
      },
      buildSessionHeaders(sid)
    );

    return {
      ok: true,
      publicId: response.tenant?.publicId,
    };
  } catch (error) {
    rethrowUnauthenticatedRpcError(error);
    rethrowUnclassifiedRpcError(error);
    const conflict = await duplicateDomainMessage(
      error,
      resolvedLocale,
      "create"
    );

    return {
      message: rpcErrorMessage(error, t("platform.tenants.create_failed"), {
        locale: resolvedLocale,
        overrides: { conflict },
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
  locale: Locale;
  role: string;
  /** The tenant's internal ID. */
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

const listPlatformTenantAdminInvitationsForLocale = async (
  locale: Locale,
  query: TenantPageQuery
): Promise<ListPlatformTenantAdminInvitationsResult> => {
  "use cache";
  cacheLife(SHARED_READ_CACHE_LIFE);
  cacheTag(platformTenantsCacheTag, platformTenantCacheTag(query.tenantId));

  try {
    const response = await apiClient.tenants.listTenantAdminInvitations(
      query,
      withServiceHeaders()
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
    // A `"use cache"` scope cannot rethrow: the fill would fail the whole
    // request. The entry is dropped instead, so the invitations come back as
    // soon as the API does.
    dropFailedCacheEntry();
    const { t } = await loadTenantCopy(locale);
    return {
      invitations: [],
      message: rpcErrorMessage(
        error,
        t("platform.tenants.invitations_list_failed"),
        { locale }
      ),
      nextToken: "",
      ok: false,
      previousToken: "",
    };
  }
};

/**
 * One page of a tenant's admin invitations, read with the service credential
 * like {@link listPlatformTenantMembers}.
 */
export const listPlatformTenantAdminInvitations = async (
  input: ListPlatformTenantAdminInvitationsInput
): Promise<ListPlatformTenantAdminInvitationsResult> => {
  await verifyPlatformSession();
  return listPlatformTenantAdminInvitationsForLocale(
    await getPlatformLocale(),
    {
      limit: input.limit ?? 20,
      tenantId: input.tenantId.trim(),
      token: input.token ?? "",
    }
  );
};

export const createPlatformTenantAdminInvitation = async (
  tenantId: string,
  email: string,
  locale: Locale
): Promise<CreateTenantAdminInvitationResult> => {
  const {
    locale: resolvedLocale,
    sid,
    t,
  } = await loadTenantCopyAndSession(locale);
  if (!sid) {
    return {
      message: t("errors.rpc.unauthenticated"),
      ok: false,
    };
  }
  if (!tenantId.trim() || !email.trim()) {
    return {
      message: t("platform.common.required"),
      ok: false,
    };
  }

  try {
    const response = await apiClient.tenants.createTenantAdminInvitation(
      {
        email: email.trim().toLowerCase(),
        tenantId: tenantId.trim(),
      },
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
        t("platform.tenants.invite_create_failed"),
        {
          locale: resolvedLocale,
          overrides: {
            // Email is the only free-form field on this call.
            "invalid-argument": t("platform.tenants.invite_email_invalid"),
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
    sid,
    t,
  } = await loadTenantCopyAndSession(locale);
  if (!sid) {
    return {
      message: t("errors.rpc.unauthenticated"),
      ok: false,
    };
  }
  if (!tenantId.trim() || !invitationId.trim()) {
    return {
      message: t("platform.common.required"),
      ok: false,
    };
  }

  try {
    const response = await apiClient.tenants.resendTenantAdminInvitation(
      {
        invitationId: invitationId.trim(),
        tenantId: tenantId.trim(),
      },
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
        t("platform.tenants.resend_invite_failed"),
        {
          locale: resolvedLocale,
          overrides: {
            "not-found": t("platform.tenants.invite_not_found"),
            precondition: t("platform.tenants.resend_invite_precondition"),
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
    sid,
    t,
  } = await loadTenantCopyAndSession(locale);
  if (!sid) {
    return {
      message: t("errors.rpc.unauthenticated"),
      ok: false,
    };
  }
  if (!tenantId.trim() || !invitationId.trim()) {
    return {
      message: t("platform.common.required"),
      ok: false,
    };
  }

  try {
    const response = await apiClient.tenants.cancelTenantAdminInvitation(
      {
        invitationId: invitationId.trim(),
        tenantId: tenantId.trim(),
      },
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
        t("platform.tenants.cancel_invite_failed"),
        {
          locale: resolvedLocale,
          overrides: {
            "not-found": t("platform.tenants.invite_not_found"),
            precondition: t("platform.tenants.cancel_invite_precondition"),
          },
        }
      ),
      ok: false,
    };
  }
};

/**
 * What one console form saves: the name alone, or the domain with the admin
 * domain. `UpdateTenant` changes only the fields a request carries, so a field
 * the form does not edit is left out rather than sent back as the value the
 * page was rendered with, which another operator may have changed since.
 */
export type PlatformTenantChange =
  | { name: string }
  | { adminDomain: string; domain: string };

export const updatePlatformTenant = async (
  tenantId: string,
  change: PlatformTenantChange,
  locale: Locale
): Promise<UpdatePlatformTenantResult> => {
  const {
    locale: resolvedLocale,
    sid,
    t,
  } = await loadTenantCopyAndSession(locale);
  if (!sid) {
    return {
      message: t("errors.rpc.unauthenticated"),
      ok: false,
    };
  }
  let fields: PlatformTenantChange;
  if ("name" in change) {
    const name = change.name.trim();
    if (!name) {
      return {
        message: t("platform.tenants.name_required"),
        ok: false,
      };
    }
    fields = { name };
  } else {
    const domain = change.domain.trim();
    if (!domain) {
      return {
        message: t("platform.tenants.domain_required"),
        ok: false,
      };
    }
    fields = { adminDomain: change.adminDomain.trim(), domain };
  }

  try {
    await apiClient.tenants.updateTenant(
      { ...fields, tenantId },
      buildSessionHeaders(sid)
    );
    return { ok: true };
  } catch (error) {
    rethrowUnauthenticatedRpcError(error);
    rethrowUnclassifiedRpcError(error);
    const conflict = await duplicateDomainMessage(
      error,
      resolvedLocale,
      "update"
    );

    return {
      message: rpcErrorMessage(error, t("platform.tenants.update_failed"), {
        locale: resolvedLocale,
        overrides: {
          conflict,
          "not-found": t("platform.tenants.not_found"),
        },
      }),
      ok: false,
    };
  }
};

export const addPlatformTenantMember = async (
  input: AddPlatformTenantMemberInput
): Promise<AddPlatformTenantMemberResult> => {
  const { locale: resolvedLocale, t } = await loadTenantCopy(input.locale);
  const tenantId = input.tenantId.trim();
  const role = input.role.trim();
  const email = input.email.trim();

  if (!tenantId || !email || !role) {
    return {
      message: t("platform.common.required"),
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
    await apiClient.tenants.addTenantMember(
      {
        email: email.toLowerCase(),
        role,
        tenantId,
      },
      buildSessionHeaders(sid)
    );
    return { ok: true };
  } catch (error) {
    rethrowUnauthenticatedRpcError(error);
    rethrowUnclassifiedRpcError(error);
    return {
      message: rpcErrorMessage(error, t("platform.tenants.add_member_failed"), {
        locale: resolvedLocale,
        overrides: {
          conflict: t("platform.tenants.member_already_added"),
          "not-found": t("platform.tenants.user_not_found"),
        },
      }),
      ok: false,
    };
  }
};

export const updatePlatformTenantMemberRole = async (
  tenantId: string,
  userId: string,
  role: string,
  locale: Locale
): Promise<UpdatePlatformTenantMemberRoleResult> => {
  const {
    locale: resolvedLocale,
    sid,
    t,
  } = await loadTenantCopyAndSession(locale);
  if (!sid) {
    return {
      message: t("errors.rpc.unauthenticated"),
      ok: false,
    };
  }

  if (!tenantId.trim() || !userId.trim() || !role.trim()) {
    return {
      message: t("platform.common.required"),
      ok: false,
    };
  }

  try {
    await apiClient.tenants.updateTenantMemberRole(
      {
        role: role.trim(),
        tenantId: tenantId.trim(),
        userId: userId.trim(),
      },
      buildSessionHeaders(sid)
    );

    return { ok: true };
  } catch (error) {
    rethrowUnauthenticatedRpcError(error);
    rethrowUnclassifiedRpcError(error);
    return {
      message: rpcErrorMessage(
        error,
        t("platform.tenants.member_role_update_failed"),
        {
          locale: resolvedLocale,
          overrides: {
            "not-found": t("platform.tenants.member_not_found"),
          },
        }
      ),
      ok: false,
    };
  }
};

export const removePlatformTenantMember = async (
  tenantId: string,
  userId: string,
  locale: Locale
): Promise<RemovePlatformTenantMemberResult> => {
  const {
    locale: resolvedLocale,
    sid,
    t,
  } = await loadTenantCopyAndSession(locale);
  if (!sid) {
    return {
      message: t("errors.rpc.unauthenticated"),
      ok: false,
    };
  }

  if (!tenantId.trim() || !userId.trim()) {
    return {
      message: t("platform.common.required"),
      ok: false,
    };
  }

  try {
    await apiClient.tenants.removeTenantMember(
      {
        tenantId: tenantId.trim(),
        userId: userId.trim(),
      },
      buildSessionHeaders(sid)
    );

    return { ok: true };
  } catch (error) {
    rethrowUnauthenticatedRpcError(error);
    rethrowUnclassifiedRpcError(error);
    return {
      message: rpcErrorMessage(
        error,
        t("platform.tenants.remove_member_failed"),
        {
          locale: resolvedLocale,
          overrides: {
            "not-found": t("platform.tenants.member_not_found"),
          },
        }
      ),
      ok: false,
    };
  }
};
