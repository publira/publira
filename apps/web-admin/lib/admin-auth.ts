import { MfaChallengeKind } from "@publira/api-client/admin/auth";
import { rpcErrorMessage } from "@publira/api-client/error-messages";
import {
  isExpectedNullableRpcError,
  isMissingResourceRpcError,
  isRejectedRequestRpcError,
  isUnauthenticatedRpcError,
  rethrowUnclassifiedRpcError,
  rpcErrorDisposition,
  RPC_ERROR_REASON,
  rpcErrorHasFieldViolation,
  rpcErrorHasReason,
} from "@publira/api-client/errors";
import type { Locale } from "@publira/i18n";
import { parseInstant } from "@publira/utils";
import { dropFailedCacheEntry } from "@publira/utils/cached-read";
import { cacheLife, cacheTag } from "next/cache";

import {
  ADMIN_SESSION_CACHE_TAG,
  rethrowUnauthenticatedRpcError,
} from "./admin-auth-shared";
import { apiClient, withClientAddressHeaders, withSessionHeaders } from "./api";
import { getMessagesFor } from "./messages";
import type { MfaChallengeKindName } from "./mfa-challenge";
import { getAccessToken } from "./session";

export {
  ADMIN_SESSION_COOKIE_NAME,
  sanitizeRedirectPath,
} from "./admin-auth-shared";

/**
 * What a correct password earned.
 *
 * `"session"` is the whole login. `"challenge"` is the half of it a password
 * can settle on its own: the account owes a second factor, and the console
 * holds a short-lived challenge token until it is presented.
 */
export type AdminLoginResult =
  | {
      ok: true;
      kind: "session";
      accessToken: string;
      expiresAt: Temporal.Instant;
    }
  | {
      ok: true;
      kind: "challenge";
      challengeKind: MfaChallengeKindName;
      challengeToken: string;
      expiresAt: Temporal.Instant;
    }
  | {
      ok: false;
      message: string;
    };

export interface AdminCurrentUser {
  name: string;
  publicId: string;
  role: string;
}

/**
 * The signed-in operator, or why they could not be read.
 *
 * `requiresSignIn` separates a session the API rejected from a `GetMe` that
 * answered nothing useful. Both used to arrive as `null`, and only the first is
 * a reason to send the operator through login again.
 */
export type GetAdminCurrentUserResult =
  | { ok: true; user: AdminCurrentUser }
  | { ok: false; requiresSignIn: boolean };

export interface TenantAdminInvitationState {
  accountExists: boolean;
  email: string;
  expiresAt: string;
  /** The console role accepting the invitation grants. */
  role: string;
  status: string;
}

export type AcceptTenantAdminInvitationResult =
  | {
      ok: true;
      accountCreated: boolean;
      accepted: boolean;
    }
  | {
      ok: false;
      message: string;
    };

export type AdminPasswordResetRequestResult =
  | {
      ok: true;
      requested: boolean;
    }
  | {
      ok: false;
      message: string;
    };

export type AdminPasswordResetConfirmResult =
  | {
      ok: true;
      confirmed: boolean;
    }
  | {
      ok: false;
      message: string;
      reason: "expired" | "invalid" | "system";
    };

export type AdminEmailChangeRequestResult =
  | {
      ok: true;
      requested: boolean;
    }
  | {
      ok: false;
      message: string;
    };

export interface AdminEmailChangeConfirmResult {
  confirmed: boolean;
  changed: boolean;
  pendingConfirmationFor: string;
}

/**
 * How much a tenant role may do, ranked the way the API ranks it: a
 * tenant_admin covers a tenant_editor, who covers a tenant_auditor. Any other
 * string ranks below all three.
 */
const tenantRoleRank = (role: string | null | undefined): number => {
  switch (role?.trim().toLowerCase()) {
    case "admin":
    case "tenant_admin": {
      return 3;
    }
    case "tenant_editor": {
      return 2;
    }
    case "tenant_auditor": {
      return 1;
    }
    default: {
      return 0;
    }
  }
};

/**
 * Whether the role may administer the tenant: its members, its settings, its
 * integrations, its readers, and its money. The API places every RPC behind
 * these at `tenant_admin`.
 */
export const isTenantAdminRole = (role: string | null | undefined): boolean =>
  tenantRoleRank(role) >= 3;

/**
 * Whether the role may write the catalogue, the pages, and the announcements,
 * and moderate comments: a tenant_editor or a tenant_admin. A tenant_auditor
 * reads the same screens and writes none of them, so a control behind which
 * the API places a `tenant_editor` write is shown only when this holds.
 */
export const isTenantEditorRole = (role: string | null | undefined): boolean =>
  tenantRoleRank(role) >= 2;

const toErrorMessage = async (
  error: unknown,
  locale: Locale
): Promise<string> => {
  const t = await getMessagesFor(locale);

  return rpcErrorMessage(
    error,
    t("admin.auth.errors.login_processing_failed"),
    {
      // The server answers a wrong email or password with `unauthenticated`;
      // never say which of the two was wrong.
      locale,
      overrides: {
        unauthenticated: t("admin.auth.errors.login_failed"),
      },
    }
  );
};

const genericEmailChangeRequestErrorMessage = async (
  locale: Locale
): Promise<string> => {
  const t = await getMessagesFor(locale);

  return t("admin.settings.email_change.failed");
};

/**
 * The challenge kind as the console names it, or `null` for a kind this build
 * has no screen for — which is a login it cannot finish, not one to wave
 * through on the password alone.
 */
const toChallengeKindName = (
  kind: MfaChallengeKind
): MfaChallengeKindName | null => {
  if (kind === MfaChallengeKind.VERIFY) {
    return "verify";
  }
  if (kind === MfaChallengeKind.ENROLL) {
    return "enroll";
  }
  return null;
};

export const loginAdmin = async (
  email: string,
  password: string,
  tenantId: string,
  locale: Locale
): Promise<AdminLoginResult> => {
  const t = await getMessagesFor(locale);
  const processingFailed = {
    message: t("admin.auth.errors.login_processing_failed"),
    ok: false,
  } as const;

  try {
    const response = await apiClient.auth.login(
      {
        email,
        password,
        tenant: { tenantId },
      },
      await withClientAddressHeaders()
    );

    const challenge = response.mfaChallenge;
    if (challenge) {
      const challengeKind = toChallengeKindName(challenge.kind);
      const challengeToken = challenge.token.trim();
      const challengeExpiresAt = parseInstant(challenge.expiresAt);
      if (!(challengeKind && challengeToken && challengeExpiresAt)) {
        return processingFailed;
      }

      return {
        challengeKind,
        challengeToken,
        expiresAt: challengeExpiresAt,
        kind: "challenge",
        ok: true,
      };
    }

    const accessToken = response.accessToken?.token?.trim() ?? "";
    const expiresAt = parseInstant(response.accessToken?.expiresAt ?? "");

    if (!(accessToken && expiresAt)) {
      return processingFailed;
    }

    return {
      accessToken,
      expiresAt,
      kind: "session",
      ok: true,
    };
  } catch (error) {
    rethrowUnclassifiedRpcError(error);
    return {
      message: await toErrorMessage(error, locale),
      ok: false,
    };
  }
};

export const logoutAdmin = async (
  accessToken: string,
  tenantId: string
): Promise<void> => {
  if (!accessToken.trim()) {
    return;
  }

  await apiClient.auth.logout(
    { tenant: { tenantId } },
    withSessionHeaders(accessToken)
  );
};

/**
 * `GetMe` for one session.
 *
 * Every console route awaits it — the chrome names the operator, and
 * `verifyAdminSession` gates each page on it — so its `stale` is how long a
 * browser keeps a route before asking again whether the session still stands.
 * Five minutes is the shortest that still lets the routes keep their
 * prefetched App Shell.
 */
const getAdminCurrentUserForSession = async (
  tenantId: string,
  token: string
): Promise<GetAdminCurrentUserResult> => {
  "use cache: private";
  cacheLife("minutes");
  cacheTag(ADMIN_SESSION_CACHE_TAG);

  if (!token) {
    dropFailedCacheEntry();
    return { ok: false, requiresSignIn: true };
  }

  try {
    const response = await apiClient.auth.getMe(
      {
        tenant: { tenantId },
      },
      withSessionHeaders(token)
    );

    const publicId = response.user?.publicId?.trim() ?? "";
    if (!publicId) {
      dropFailedCacheEntry();
      return { ok: false, requiresSignIn: false };
    }

    return {
      ok: true,
      user: {
        name: response.user?.name?.trim() ?? "",
        publicId,
        role: response.user?.role?.trim() ?? "",
      },
    };
  } catch (error) {
    if (isUnauthenticatedRpcError(error)) {
      dropFailedCacheEntry();
      return { ok: false, requiresSignIn: true };
    }
    if (isExpectedNullableRpcError(error)) {
      return { ok: false, requiresSignIn: false };
    }
    throw error;
  }
};

export const getAdminCurrentUser = async (
  tenantId: string
): Promise<GetAdminCurrentUserResult> =>
  getAdminCurrentUserForSession(tenantId, await getAccessToken());

export const isAdminSessionValid = async (
  tenantId: string
): Promise<boolean> => {
  const result = await getAdminCurrentUser(tenantId);
  return result.ok;
};

export const getTenantAdminInvitationState = async (
  tenantId: string,
  token: string
): Promise<TenantAdminInvitationState | null> => {
  const normalizedToken = token.trim();
  if (!tenantId.trim() || !normalizedToken) {
    return null;
  }

  try {
    const response = await apiClient.auth.getTenantAdminInvitationState({
      tenant: { tenantId },
      token: normalizedToken,
    });

    return {
      accountExists: response.accountExists,
      email: response.email,
      expiresAt: response.expiresAt,
      role: response.role,
      status: response.status,
    };
  } catch (error) {
    // No session header is sent here — the invitation link is followed while
    // logged out. `unauthenticated` would therefore mean the auth wiring or the
    // API contract broke, not that the invitation is unknown, so it must not be
    // flattened into "no such invitation".
    if (isMissingResourceRpcError(error)) {
      return null;
    }
    throw error;
  }
};

export const acceptTenantAdminInvitation = async (
  tenantId: string,
  token: string,
  locale: Locale,
  name?: string,
  password?: string
): Promise<AcceptTenantAdminInvitationResult> => {
  const t = await getMessagesFor(locale);
  const normalizedToken = token.trim();
  if (!tenantId.trim() || !normalizedToken) {
    return {
      message: t("admin.auth.accept_invite.invalid_token"),
      ok: false,
    };
  }

  try {
    const response = await apiClient.auth.acceptTenantAdminInvitation({
      name: name?.trim() ?? "",
      password: password ?? "",
      tenant: { tenantId },
      token: normalizedToken,
    });

    return {
      accepted: response.accepted,
      accountCreated: response.accountCreated,
      ok: true,
    };
  } catch (error) {
    rethrowUnclassifiedRpcError(error);
    return {
      message: rpcErrorMessage(
        error,
        t("admin.auth.errors.accept_invite_failed"),
        {
          locale,
          overrides: {
            "not-found": t("admin.auth.accept_invite.not_found"),
            precondition: rpcErrorHasReason(
              error,
              RPC_ERROR_REASON.invitationCanceled
            )
              ? t("admin.auth.accept_invite.canceled")
              : t("admin.auth.accept_invite.expired_action"),
          },
        }
      ),
      ok: false,
    };
  }
};

export const requestAdminPasswordReset = async (
  tenantId: string,
  email: string,
  locale: Locale
): Promise<AdminPasswordResetRequestResult> => {
  const t = await getMessagesFor(locale);
  const normalizedEmail = email.trim();
  if (!tenantId.trim() || !normalizedEmail) {
    return {
      message: t("admin.auth.fields.email_required"),
      ok: false,
    };
  }

  try {
    const response = await apiClient.auth.requestPasswordReset(
      { email: normalizedEmail, tenant: { tenantId } },
      await withClientAddressHeaders()
    );

    return {
      ok: true,
      requested: response.requested,
    };
  } catch (error) {
    rethrowUnclassifiedRpcError(error);
    return {
      message: rpcErrorMessage(
        error,
        t("admin.auth.errors.reset_request_failed"),
        {
          locale,
          overrides: {
            // Email is the only field this call takes.
            "invalid-argument": t(
              "admin.auth.errors.reset_request_invalid_email"
            ),
          },
        }
      ),
      ok: false,
    };
  }
};

export const confirmAdminPasswordReset = async (
  tenantId: string,
  token: string,
  newPassword: string,
  locale: Locale
): Promise<AdminPasswordResetConfirmResult> => {
  const normalizedToken = token.trim();
  const t = await getMessagesFor(locale);

  if (!tenantId.trim() || !normalizedToken) {
    return {
      message: t("admin.auth.errors.reset_link_invalid"),
      ok: false,
      reason: "invalid",
    };
  }

  if (!newPassword.trim()) {
    return {
      message: t("admin.auth.errors.new_password_required"),
      ok: false,
      reason: "system",
    };
  }

  try {
    const response = await apiClient.auth.confirmPasswordReset(
      {
        newPassword,
        tenant: { tenantId },
        token: normalizedToken,
      },
      await withClientAddressHeaders()
    );

    return {
      confirmed: response.confirmed,
      ok: true,
    };
  } catch (error) {
    rethrowUnclassifiedRpcError(error);
    const disposition = rpcErrorDisposition(error);
    if (disposition === "precondition") {
      return {
        message: t("admin.auth.errors.reset_link_expired"),
        ok: false,
        reason: "expired",
      };
    }
    // An unknown token and a malformed one both mean "start over".
    if (disposition === "not-found" || disposition === "invalid-argument") {
      return {
        message: t("admin.auth.errors.reset_link_invalid"),
        ok: false,
        reason: "invalid",
      };
    }

    return {
      message: t("admin.auth.errors.reset_confirm_failed"),
      ok: false,
      reason: "system",
    };
  }
};

export const requestAdminEmailChange = async (
  tenantId: string,
  currentEmail: string,
  newEmail: string,
  currentPassword: string,
  locale: Locale
): Promise<AdminEmailChangeRequestResult> => {
  const t = await getMessagesFor(locale);
  const normalizedCurrentEmail = currentEmail.trim();
  const normalizedNewEmail = newEmail.trim();

  const sessionId = await getAccessToken();
  if (
    !tenantId.trim() ||
    !sessionId.trim() ||
    !normalizedCurrentEmail ||
    !normalizedNewEmail ||
    !currentPassword
  ) {
    return {
      message: t("admin.settings.email_change.all_fields_required"),
      ok: false,
    };
  }

  try {
    const response = await apiClient.auth.requestEmailChange(
      {
        currentEmail: normalizedCurrentEmail,
        currentPassword,
        newEmail: normalizedNewEmail,
        tenant: { tenantId },
      },
      withSessionHeaders(sessionId)
    );

    return {
      ok: true,
      requested: response.requested,
    };
  } catch (error) {
    rethrowUnauthenticatedRpcError(error);
    rethrowUnclassifiedRpcError(error);
    return {
      message: rpcErrorMessage(
        error,
        await genericEmailChangeRequestErrorMessage(locale),
        {
          locale,
          overrides: {
            conflict: t("admin.settings.email_change.email_taken"),
            "invalid-argument": rpcErrorHasFieldViolation(
              error,
              "current_password"
            )
              ? t("admin.settings.email_change.password_incorrect")
              : t("errors.validation"),
          },
        }
      ),
      ok: false,
    };
  }
};

export const confirmAdminEmailChange = async (
  tenantId: string,
  token: string
): Promise<AdminEmailChangeConfirmResult | null> => {
  const normalizedToken = token.trim();
  if (!tenantId.trim() || !normalizedToken) {
    return null;
  }

  try {
    const response = await apiClient.auth.confirmEmailChange(
      {
        tenant: { tenantId },
        token: normalizedToken,
      },
      await withClientAddressHeaders()
    );

    return {
      changed: response.changed,
      confirmed: response.confirmed,
      pendingConfirmationFor: response.pendingConfirmationFor,
    };
  } catch (error) {
    // The page renders `null` as "this link is expired or invalid", so only a
    // rejected token may resolve to it. A transport failure or a broken server
    // must not be presented to the operator as a dead link.
    if (isRejectedRequestRpcError(error)) {
      return null;
    }
    throw error;
  }
};
