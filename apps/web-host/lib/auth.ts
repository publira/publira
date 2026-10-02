import {
  isExpectedNullableRpcError,
  isRejectedRequestRpcError,
  isUnauthenticatedRpcError,
  rethrowUnclassifiedRpcError,
  rpcErrorDisposition,
  rpcErrorHasFieldViolation,
} from "@publira/api-client/errors";
import { IdentityProvider } from "@publira/api-client/public/auth";
import type { LinkedIdentity } from "@publira/api-client/public/auth";
import pRetry, { AbortError } from "p-retry";

import {
  apiClient,
  buildClientAddressHeaders,
  buildSessionHeaders,
  resolveAccessToken,
} from "./api-client";
import type { SignInProvider } from "./sign-in-provider";

export {
  PUBLIC_SESSION_COOKIE_NAME,
  sanitizeRedirectPath,
} from "./auth-shared";

export interface PublicCurrentUser {
  name: string;
  publicId: string;
}

/**
 * An access token and the moment it stops being one.
 *
 * The expiry is a `Date` because it ends up as the session cookie's `expires`,
 * which the Next.js cookie API types that way. Every other timestamp in
 * web-host is a `Temporal` instant.
 */
export interface PublicSession {
  accessToken: string;
  expiresAt: Date;
}

export interface MeInfo {
  /** `YYYY-MM-DD`, and empty when the reader has given none. */
  birthDate: string;
  /** The address the account signs in with. */
  email: string;
  name: string;
  publicId: string;
  role: string;
}

/**
 * What the profile form may write. An empty `birthDate` leaves the stored one
 * alone; the date is written once, and `UpdateMe` refuses a second write.
 */
export interface ProfileUpdate {
  birthDate: string;
  name: string;
}

/** What the sign-up form collects. `birthDate` is empty when it did not ask. */
export interface SignupInput {
  /** The published versions of the pages the reader agreed to. */
  agreedPageVersionIds: string[];
  birthDate: string;
  email: string;
  name: string;
  password: string;
  tenantId: string;
}

export interface NotificationSettings {
  emailNotificationsEnabled: boolean;
}

export const loginPublic = async (
  email: string,
  password: string,
  tenantId: string
): Promise<PublicSession | null> => {
  try {
    const response = await apiClient.auth.login(
      {
        email,
        password,
        tenant: { tenantId },
      },
      await buildClientAddressHeaders()
    );
    const { token: accessToken, expiresAt } = response.accessToken ?? {};
    if (!accessToken || !expiresAt) {
      return null;
    }
    return { accessToken, expiresAt: new Date(expiresAt) };
  } catch (error) {
    if (isRejectedRequestRpcError(error)) {
      return null;
    }
    throw error;
  }
};

const IDENTITY_PROVIDERS: Record<SignInProvider, IdentityProvider> = {
  apple: IdentityProvider.APPLE,
  google: IdentityProvider.GOOGLE,
};

const toSignInProvider = (
  provider: IdentityProvider
): SignInProvider | null => {
  switch (provider) {
    case IdentityProvider.APPLE: {
      return "apple";
    }
    case IdentityProvider.GOOGLE: {
      return "google";
    }
    default: {
      return null;
    }
  }
};

/** An ID token a provider issued, and what the API needs beside it. */
export interface IdTokenSignIn {
  /** Apple's authorization code, and empty from Google. */
  authorizationCode: string;
  idToken: string;
  nonce: string;
  provider: SignInProvider;
  /** The `redirect_uri` the authorization request was sent with. */
  redirectUri: string;
}

/** Read only when the sign-in creates the account. */
export interface IdTokenSignUp {
  agreedPageVersionIds: string[];
  birthDate: string;
  name: string;
}

export type IdTokenSignInOutcome =
  | { kind: "signed_in"; session: PublicSession }
  /** No account matched, and the tenant asks for consent before one is made. */
  | { kind: "consent_required" }
  | { error: unknown; kind: "refused" };

/**
 * Sign a reader in with an ID token, creating the account on the first sign-in.
 *
 * A consent the tenant asks for and did not get is `invalid_argument` on
 * `agreed_page_version_ids`, and the API leaves the nonce unspent then, so the
 * caller asks for it and sends the same token again.
 */
export const loginWithIdToken = async (
  tenantId: string,
  signIn: IdTokenSignIn,
  signUp?: IdTokenSignUp
): Promise<IdTokenSignInOutcome> => {
  try {
    const response = await apiClient.auth.loginWithIdToken(
      {
        agreedPageVersionIds: signUp?.agreedPageVersionIds ?? [],
        authorizationCode: signIn.authorizationCode,
        birthDate: signUp?.birthDate ?? "",
        idToken: signIn.idToken,
        name: signUp?.name ?? "",
        nonce: signIn.nonce,
        provider: IDENTITY_PROVIDERS[signIn.provider],
        redirectUri: signIn.redirectUri,
        tenant: { tenantId },
      },
      await buildClientAddressHeaders()
    );
    const { token: accessToken, expiresAt } = response.accessToken ?? {};
    if (!accessToken || !expiresAt) {
      throw new Error("LoginWithIdToken answered without an access token");
    }
    return {
      kind: "signed_in",
      session: { accessToken, expiresAt: new Date(expiresAt) },
    };
  } catch (error) {
    rethrowUnclassifiedRpcError(error);
    if (
      rpcErrorDisposition(error) === "invalid-argument" &&
      rpcErrorHasFieldViolation(error, "agreed_page_version_ids")
    ) {
      return { kind: "consent_required" };
    }
    return { error, kind: "refused" };
  }
};

/** The generated `LinkedIdentity` fields {@link listMyIdentities} reads. */
type RawLinkedIdentity = Pick<
  LinkedIdentity,
  "email" | "linkedAt" | "provider"
>;

export interface MyIdentity {
  /** The address the provider's account carried when it was linked. */
  email: string;
  /** RFC 3339. */
  linkedAt: string;
  provider: SignInProvider;
}

export interface MyIdentities {
  /**
   * False for an account a provider sign-in created: it confirms a deletion
   * with a fresh sign-in, and keeps its last linked provider.
   */
  hasPassword: boolean;
  identities: MyIdentity[];
}

const toMyIdentities = (identities: RawLinkedIdentity[]): MyIdentity[] =>
  identities.flatMap((identity) => {
    const provider = toSignInProvider(identity.provider);
    return provider
      ? [{ email: identity.email, linkedAt: identity.linkedAt, provider }]
      : [];
  });

export const listMyIdentities = async (
  tenantId: string,
  accessToken?: string
): Promise<MyIdentities | null> => {
  const sid = await resolveAccessToken(accessToken);
  if (!sid) {
    return null;
  }

  try {
    const response = await apiClient.auth.listMyIdentities(
      { tenant: { tenantId } },
      buildSessionHeaders(sid)
    );
    return {
      hasPassword: response.hasPassword,
      identities: toMyIdentities(response.identities),
    };
  } catch (error) {
    if (isUnauthenticatedRpcError(error)) {
      throw error;
    }
    if (isExpectedNullableRpcError(error)) {
      return null;
    }
    throw error;
  }
};

/**
 * Unlink a provider from the signed-in reader's account. The API refuses to
 * take the last one from an account without a password, which comes back as
 * the error for the form to word.
 */
export const unlinkMyIdentity = async (
  tenantId: string,
  provider: SignInProvider,
  accessToken?: string
): Promise<{ ok: true } | { error: unknown; ok: false }> => {
  const sid = await resolveAccessToken(accessToken);
  try {
    await apiClient.auth.unlinkIdentity(
      { provider: IDENTITY_PROVIDERS[provider], tenant: { tenantId } },
      buildSessionHeaders(sid)
    );
    return { ok: true };
  } catch (error) {
    if (isUnauthenticatedRpcError(error)) {
      throw error;
    }
    rethrowUnclassifiedRpcError(error);
    return { error, ok: false };
  }
};

/**
 * Submit a sign-up and report whether the API took it.
 *
 * An address that already has an account is accepted like a free one, so a
 * stranger cannot learn from the answer which addresses are registered. `true`
 * therefore means the request was accepted and the address was written to — not
 * that an account was created.
 */
export const signupPublic = async ({
  agreedPageVersionIds,
  birthDate,
  email,
  name,
  password,
  tenantId,
}: SignupInput): Promise<boolean> => {
  try {
    const response = await apiClient.auth.createUser(
      {
        agreedPageVersionIds,
        birthDate,
        email,
        name,
        password,
        tenant: { tenantId },
      },
      await buildClientAddressHeaders()
    );
    return response.accepted;
  } catch (error) {
    if (isRejectedRequestRpcError(error)) {
      return false;
    }
    throw error;
  }
};

export const verifyPublicEmail = async (
  token: string,
  tenantId: string
): Promise<boolean> => {
  try {
    const response = await apiClient.auth.verifyUserEmail({
      tenant: { tenantId },
      token,
    });
    return Boolean(response.verified);
  } catch (error) {
    rethrowUnclassifiedRpcError(error);
    return false;
  }
};

/**
 * Ask for a fresh confirmation link for an address whose account was never
 * activated, and report whether the API took the request.
 *
 * An unverified account, a confirmed one, and an address with no account at all
 * are all accepted, so the answer says nothing about which addresses are
 * registered. `true` therefore means the request was taken — not that anything
 * was mailed.
 */
export const requestPublicEmailVerification = async (
  email: string,
  tenantId: string
): Promise<boolean> => {
  try {
    const response = await apiClient.auth.requestEmailVerification(
      { email, tenant: { tenantId } },
      await buildClientAddressHeaders()
    );
    return Boolean(response.requested);
  } catch (error) {
    rethrowUnclassifiedRpcError(error);
    return false;
  }
};

export const confirmPublicEmailChange = async (
  token: string,
  tenantId: string
): Promise<{
  changed: boolean;
  confirmed: boolean;
  pendingConfirmationFor: string;
} | null> => {
  try {
    const response = await apiClient.auth.confirmEmailChange(
      {
        tenant: { tenantId },
        token,
      },
      await buildClientAddressHeaders()
    );
    return {
      changed: Boolean(response.changed),
      confirmed: Boolean(response.confirmed),
      pendingConfirmationFor: response.pendingConfirmationFor,
    };
  } catch (error) {
    if (isRejectedRequestRpcError(error)) {
      return null;
    }
    throw error;
  }
};

export const requestPublicPasswordReset = async (
  email: string,
  tenantId: string
): Promise<boolean> => {
  try {
    const response = await apiClient.auth.requestPasswordReset(
      { email, tenant: { tenantId } },
      await buildClientAddressHeaders()
    );
    return Boolean(response.requested);
  } catch (error) {
    rethrowUnclassifiedRpcError(error);
    return false;
  }
};

export const confirmPublicPasswordReset = async (
  token: string,
  newPassword: string,
  tenantId: string
): Promise<boolean> => {
  try {
    const response = await apiClient.auth.confirmPasswordReset(
      {
        newPassword,
        tenant: { tenantId },
        token,
      },
      await buildClientAddressHeaders()
    );
    return Boolean(response.confirmed);
  } catch (error) {
    rethrowUnclassifiedRpcError(error);
    return false;
  }
};

/**
 * Change the signed-in reader's password and hand back the session that
 * replaces the one the change ended.
 *
 * The write bumps `credentials_version`, so the token this request carried dies
 * with every other token the account holds. The API mints a replacement in the
 * same transaction; returning it is what lets the caller re-seal the cookie and
 * keep the browser that made the change signed in.
 *
 * A wrong current password is `invalid_argument` rather than `unauthenticated`,
 * so it comes back as `null` for the form to word. A rejected session still
 * throws, because that one is not a typo.
 */
export const changePublicPassword = async (
  tenantId: string,
  currentPassword: string,
  newPassword: string,
  accessToken?: string
): Promise<PublicSession | null> => {
  const sid = await resolveAccessToken(accessToken);
  if (!sid) {
    return null;
  }

  try {
    const response = await apiClient.auth.changePassword(
      {
        currentPassword,
        newPassword,
        tenant: { tenantId },
      },
      buildSessionHeaders(sid)
    );
    const { token, expiresAt } = response.accessToken ?? {};
    if (!token || !expiresAt) {
      return null;
    }
    return { accessToken: token, expiresAt: new Date(expiresAt) };
  } catch (error) {
    if (isUnauthenticatedRpcError(error)) {
      throw error;
    }
    rethrowUnclassifiedRpcError(error);
    return null;
  }
};

export const logoutPublic = async (
  accessToken: string,
  tenantId: string
): Promise<void> => {
  if (!accessToken.trim()) {
    return;
  }
  try {
    await apiClient.auth.logout(
      {
        tenant: { tenantId },
      },
      buildSessionHeaders(accessToken)
    );
  } catch {
    // The cookie is cleared either way: an expired session and an unreachable
    // API both leave the caller with nothing worth keeping.
  }
};

export const getPublicCurrentUser = async (
  tenantId: string
): Promise<PublicCurrentUser | null> => {
  const sid = await resolveAccessToken();
  if (!sid) {
    return null;
  }
  try {
    const response = await apiClient.auth.getMe(
      {
        tenant: { tenantId },
      },
      buildSessionHeaders(sid)
    );
    const { user } = response;
    if (!user) {
      return null;
    }
    return {
      name: user.name,
      publicId: user.publicId,
    };
  } catch (error) {
    if (isUnauthenticatedRpcError(error)) {
      throw error;
    }
    if (isExpectedNullableRpcError(error)) {
      return null;
    }
    throw error;
  }
};

/**
 * How the signed-in reader confirms a change to their own account: with its
 * password or, for an account without one, with a fresh sign-in to a linked
 * provider.
 */
export type AccountConfirmation =
  | { password: string }
  | { idToken: string; nonce: string; provider: SignInProvider };

/** The confirmation fields `RequestEmailChange` and `DeleteMe` both take. */
const identityConfirmationFields = (
  confirmation: Exclude<AccountConfirmation, { password: string }>
) => ({
  idToken: confirmation.idToken,
  nonce: confirmation.nonce,
  provider: IDENTITY_PROVIDERS[confirmation.provider],
});

export const requestPublicEmailChange = async (
  tenantId: string,
  currentEmail: string,
  newEmail: string,
  confirmation: AccountConfirmation,
  accessToken?: string
): Promise<boolean> => {
  const sid = await resolveAccessToken(accessToken);
  if (!sid) {
    return false;
  }

  try {
    const response = await apiClient.auth.requestEmailChange(
      {
        currentEmail,
        newEmail,
        tenant: { tenantId },
        ...("password" in confirmation
          ? { currentPassword: confirmation.password }
          : identityConfirmationFields(confirmation)),
      },
      buildSessionHeaders(sid)
    );

    return Boolean(response.requested);
  } catch (error) {
    if (isUnauthenticatedRpcError(error)) {
      throw error;
    }
    rethrowUnclassifiedRpcError(error);
    return false;
  }
};

/**
 * The retry below only covers "the session we just wrote is not visible to this
 * read yet", which the server reports as a missing / not-permitted record. An
 * `unauthenticated` session is a decision, not a race, so it is excluded even
 * though `isExpectedNullableRpcError` accepts it.
 */
const isStaleSessionReadError = (error: unknown): boolean =>
  isExpectedNullableRpcError(error) && !isUnauthenticatedRpcError(error);

/**
 * `p-retry` defaults to `minTimeout: 1000`, which would put up to a second onto
 * a request-path read. The wait only has to outlast the replication of a write
 * that already completed, so 100ms is used instead.
 */
const GET_ME_RETRY_MIN_TIMEOUT_MS = 100;

export const getMe = async (
  tenantId: string,
  accessToken?: string
): Promise<MeInfo | null> => {
  const sid = await resolveAccessToken(accessToken);
  if (!sid) {
    return null;
  }

  try {
    return await pRetry(
      async () => {
        try {
          const response = await apiClient.auth.getMe(
            {
              tenant: { tenantId },
            },
            buildSessionHeaders(sid)
          );

          if (!response.user) {
            return null;
          }

          return {
            birthDate: response.user.birthDate,
            email: response.user.email,
            name: response.user.name,
            publicId: response.user.publicId,
            role: response.user.role,
          };
        } catch (error) {
          if (isStaleSessionReadError(error)) {
            throw error;
          }
          throw new AbortError(error instanceof Error ? error : String(error));
        }
      },
      { minTimeout: GET_ME_RETRY_MIN_TIMEOUT_MS, retries: 1 }
    );
  } catch (error) {
    if (isStaleSessionReadError(error)) {
      return null;
    }
    throw error;
  }
};

/**
 * Whether the API turns the session away: `accessToken`, or the one the cookie
 * carries when it is omitted. A browser holding no session has nothing to turn
 * away.
 *
 * For a caller that has just seen `unauthenticated` from an RPC that also
 * authenticates something else — a fresh sign-in, say — or that has ended an
 * account's sessions without knowing whose session this browser holds.
 */
export const isSessionRejected = async (
  tenantId: string,
  accessToken?: string
): Promise<boolean> => {
  const sid = await resolveAccessToken(accessToken);
  if (!sid) {
    return false;
  }

  try {
    await getMe(tenantId, sid);
    return false;
  } catch (error) {
    if (isUnauthenticatedRpcError(error)) {
      return true;
    }
    throw error;
  }
};

export const updateMe = async (
  tenantId: string,
  { birthDate, name }: ProfileUpdate,
  accessToken?: string
): Promise<MeInfo | null> => {
  const sid = await resolveAccessToken(accessToken);
  if (!sid) {
    return null;
  }

  try {
    const response = await apiClient.auth.updateMe(
      {
        birthDate,
        name,
        tenant: { tenantId },
      },
      buildSessionHeaders(sid)
    );

    if (!response.user) {
      return null;
    }

    return {
      birthDate: response.user.birthDate,
      email: response.user.email,
      name: response.user.name,
      publicId: response.user.publicId,
      role: response.user.role,
    };
  } catch (error) {
    if (isUnauthenticatedRpcError(error)) {
      throw error;
    }
    if (isRejectedRequestRpcError(error)) {
      return null;
    }
    throw error;
  }
};

/** Delete the signed-in reader's account. */
export const deleteMe = async (
  tenantId: string,
  confirmation: AccountConfirmation,
  accessToken?: string
): Promise<boolean> => {
  const sid = await resolveAccessToken(accessToken);
  if (!sid) {
    return false;
  }

  try {
    await apiClient.auth.deleteMe(
      {
        tenant: { tenantId },
        ...("password" in confirmation
          ? { password: confirmation.password }
          : identityConfirmationFields(confirmation)),
      },
      buildSessionHeaders(sid)
    );

    return true;
  } catch (error) {
    if (isUnauthenticatedRpcError(error)) {
      throw error;
    }
    rethrowUnclassifiedRpcError(error);
    return false;
  }
};

export const getNotificationSettings = async (
  tenantId: string,
  accessToken?: string
): Promise<NotificationSettings | null> => {
  const sid = await resolveAccessToken(accessToken);
  if (!sid) {
    return null;
  }

  try {
    const response = await apiClient.auth.getNotificationSettings(
      {
        tenant: { tenantId },
      },
      buildSessionHeaders(sid)
    );

    return {
      emailNotificationsEnabled: response.emailNotificationsEnabled,
    };
  } catch (error) {
    if (isUnauthenticatedRpcError(error)) {
      throw error;
    }
    if (isExpectedNullableRpcError(error)) {
      return null;
    }
    throw error;
  }
};

export const updateNotificationSettings = async (
  tenantId: string,
  emailNotificationsEnabled: boolean,
  accessToken?: string
): Promise<NotificationSettings | null> => {
  const sid = await resolveAccessToken(accessToken);
  if (!sid) {
    return null;
  }

  try {
    const response = await apiClient.auth.updateNotificationSettings(
      {
        emailNotificationsEnabled,
        tenant: { tenantId },
      },
      buildSessionHeaders(sid)
    );

    return {
      emailNotificationsEnabled: response.emailNotificationsEnabled,
    };
  } catch (error) {
    if (isUnauthenticatedRpcError(error)) {
      throw error;
    }
    if (isRejectedRequestRpcError(error)) {
      return null;
    }
    throw error;
  }
};
