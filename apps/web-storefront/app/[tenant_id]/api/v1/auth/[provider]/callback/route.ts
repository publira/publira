import { rpcErrorMessage } from "@publira/api-client/error-messages";
import { isUnauthenticatedRpcError } from "@publira/api-client/errors";
import { cookies } from "next/headers";
import { z } from "zod";

import {
  deleteMe,
  deleteMyPasskey,
  linkMyIdentity,
  loginWithIdToken,
  requestPublicEmailChange,
  unlinkMyIdentity,
} from "#lib/auth";
import type { IdTokenSignIn } from "#lib/auth";
import { sealPublicSessionCookie } from "#lib/auth-session";
import { buildLoginPath, PUBLIC_SESSION_COOKIE_NAME } from "#lib/auth-shared";
import { emailRefusalMessage } from "#lib/email-refusal-message";
import { getMessagesFor } from "#lib/messages";
import { disableMyMfa } from "#lib/mfa";
import { MFA_CHALLENGE_PATH, writeMfaChallenge } from "#lib/mfa-challenge";
import { mfaDisableRefusalMessage } from "#lib/mfa-refusal-message";
import { writePendingPasskeyRegistration } from "#lib/pending-passkey-registration";
import {
  SIGN_IN_PROVIDER_NAMES,
  SIGN_IN_PROVIDERS,
} from "#lib/sign-in-provider";
import {
  clearSignInRequest,
  isExpectedState,
  readSignInRequest,
  writePendingSignUp,
} from "#lib/social-sign-in";
import type { SignInRequest } from "#lib/social-sign-in";
import {
  CONFIRMING_SCREENS,
  signInFailurePath,
  signUpClosedPath,
} from "#lib/social-sign-in-paths";
import type { SignInOrigin } from "#lib/social-sign-in-paths";
import { getTenantDefaultLocale } from "#lib/tenant";
import { isTenantIdFormat } from "#lib/tenant-id-format";
import { tenantLocalePath } from "#lib/tenant-locale-path";

const callbackPathSchema = z.object({
  provider: z.enum(SIGN_IN_PROVIDERS),
  tenantId: z.string().refine(isTenantIdFormat),
});

/**
 * What a provider posts back. `error` replaces the token when the reader
 * stopped; Apple adds `code`, and `user` with the name on the first sign-in.
 */
const callbackFormSchema = z.object({
  code: z.string().optional(),
  error: z.string().optional(),
  id_token: z.string().optional(),
  state: z.string(),
  user: z.string().optional(),
});

const appleUserSchema = z.object({
  name: z
    .object({
      firstName: z.string().optional(),
      lastName: z.string().optional(),
    })
    .optional(),
});

/** The name Apple hands over once, or empty for the API to fall back from. */
const appleUserName = (raw: string | undefined): string => {
  if (!raw) {
    return "";
  }

  try {
    const parsed = appleUserSchema.safeParse(JSON.parse(raw));
    const name = parsed.success ? parsed.data.name : undefined;

    return [name?.firstName, name?.lastName]
      .flatMap((part) => {
        const trimmed = part?.trim();

        return trimmed ? [trimmed] : [];
      })
      .join(" ");
  } catch {
    return "";
  }
};

const readCallbackForm = async (request: Request) => {
  try {
    const formData = await request.formData();

    const parsed = callbackFormSchema.safeParse(
      Object.fromEntries(
        [...formData.entries()].filter(
          (entry): entry is [string, string] => typeof entry[1] === "string"
        )
      )
    );

    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
};

/**
 * A 303, so the browser follows with a GET. The answer is a document
 * navigation, so no client cache of the previous session survives it.
 */
const seeOther = (location: string) =>
  new Response(null, { headers: { Location: location }, status: 303 });

const failure = async (origin: SignInOrigin, message?: string) =>
  seeOther(await signInFailurePath(origin, message));

const finishLogin = async (
  request: SignInRequest,
  signIn: IdTokenSignIn,
  name: string
): Promise<Response> => {
  const outcome = await loginWithIdToken(request.tenantId, signIn);

  if (outcome.kind === "signed_in") {
    await sealPublicSessionCookie(outcome.session, request.tenantId);

    return seeOther(
      await tenantLocalePath(request.tenantId, request.locale, request.returnTo)
    );
  }

  if (outcome.kind === "mfa_required") {
    await writeMfaChallenge({
      challengeToken: outcome.challenge.token,
      expiresAt: outcome.challenge.expiresAt,
      locale: request.locale,
      returnTo: request.returnTo,
      tenantId: request.tenantId,
    });

    return seeOther(
      await tenantLocalePath(
        request.tenantId,
        request.locale,
        MFA_CHALLENGE_PATH
      )
    );
  }

  if (outcome.kind === "consent_required") {
    await writePendingSignUp({
      ...signIn,
      locale: request.locale,
      name,
      returnTo: request.returnTo,
      tenantId: request.tenantId,
    });

    return seeOther(
      await tenantLocalePath(
        request.tenantId,
        request.locale,
        "/signup/continue"
      )
    );
  }

  if (outcome.kind === "sign_up_closed") {
    return seeOther(await signUpClosedPath(request));
  }

  const t = await getMessagesFor(request.locale);

  return failure(
    request,
    rpcErrorMessage(outcome.error, t("storefront.auth.social.errors.failed"), {
      locale: request.locale,
      overrides: {
        precondition: t("storefront.auth.social.errors.refused"),
      },
    })
  );
};

/**
 * Run what a fresh sign-in confirms with the session it was started from. A
 * session that ended meanwhile sends the reader to sign in again, back to the
 * screen the confirmation was asked from.
 *
 * `unauthenticated` is only ever the session: a sign-in the API refuses is
 * `invalid_argument`, a confirmation that failed, and leaves the reader signed
 * in.
 */
const withConfirmingSession = async <T>(
  { locale, tenantId }: SignInRequest,
  screen: string,
  run: () => Promise<T>
): Promise<T | Response> => {
  try {
    return await run();
  } catch (error) {
    if (!isUnauthenticatedRpcError(error)) {
      throw error;
    }

    const defaultLocale = await getTenantDefaultLocale(tenantId);

    return seeOther(
      buildLoginPath(locale, defaultLocale, screen, { revoked: true })
    );
  }
};

const finishDeletion = async (
  request: SignInRequest,
  { idToken, nonce, provider }: IdTokenSignIn
): Promise<Response> => {
  const { accessToken, locale, tenantId } = request;

  const outcome = await withConfirmingSession(
    request,
    CONFIRMING_SCREENS.delete,
    () => deleteMe(tenantId, { idToken, nonce, provider }, accessToken)
  );

  if (outcome instanceof Response) {
    return outcome;
  }

  const t = await getMessagesFor(locale);

  if (outcome !== "deleted") {
    return failure(
      request,
      t(
        outcome === "last_tenant_admin"
          ? "storefront.settings.delete_last_tenant_admin"
          : "storefront.settings.delete_failed"
      )
    );
  }

  const cookieStore = await cookies();
  cookieStore.delete(PUBLIC_SESSION_COOKIE_NAME);
  const loginPath = await tenantLocalePath(tenantId, locale, "/login");

  const params = new URLSearchParams({
    message: t("storefront.settings.deleted"),
    status: "success",
  });

  return seeOther(`${loginPath}?${params.toString()}`);
};

const finishEmailChange = async (
  request: SignInRequest,
  { idToken, nonce, provider }: IdTokenSignIn
): Promise<Response> => {
  const { accessToken, emailChange, locale, tenantId } = request;
  const t = await getMessagesFor(locale);

  if (!emailChange) {
    return failure(request, t("storefront.settings.email_change_failed"));
  }

  const requested = await withConfirmingSession(
    request,
    CONFIRMING_SCREENS.email_change,
    () =>
      requestPublicEmailChange(
        tenantId,
        emailChange.currentEmail,
        emailChange.newEmail,
        { idToken, nonce, provider },
        accessToken
      )
  );

  if (requested instanceof Response) {
    return requested;
  }

  if (!requested.ok) {
    return failure(
      request,
      emailRefusalMessage(
        t,
        requested.emailRefusal,
        t("storefront.settings.email_change_failed")
      )
    );
  }

  const path = await tenantLocalePath(
    tenantId,
    locale,
    CONFIRMING_SCREENS.email_change
  );

  const params = new URLSearchParams({
    message: t("storefront.settings.email_change_requested"),
    status: "success",
  });

  return seeOther(`${path}?${params.toString()}`);
};

/**
 * Turn two-step verification off with the code the reader typed before they
 * left and the sign-in they just made, back on the screen it was asked from.
 */
const finishMfaDisable = async (
  request: SignInRequest,
  { idToken, nonce, provider }: IdTokenSignIn
): Promise<Response> => {
  const { accessToken, locale, mfaCode, tenantId } = request;
  const t = await getMessagesFor(locale);

  if (!mfaCode) {
    return failure(request, t("storefront.settings.mfa_disable_failed"));
  }

  const disabled = await withConfirmingSession(
    request,
    CONFIRMING_SCREENS.mfa_disable,
    () =>
      disableMyMfa(tenantId, mfaCode, { idToken, nonce, provider }, accessToken)
  );

  if (disabled instanceof Response) {
    return disabled;
  }

  if (!disabled.ok) {
    return failure(
      request,
      mfaDisableRefusalMessage(t, locale, disabled, "fresh_sign_in")
    );
  }

  const path = await tenantLocalePath(
    tenantId,
    locale,
    CONFIRMING_SCREENS.mfa_disable
  );

  const params = new URLSearchParams({
    message: t("storefront.settings.mfa_disabled"),
    status: "success",
  });

  return seeOther(`${path}?${params.toString()}`);
};

/**
 * Link the provider account the reader just signed in to, whatever address it
 * carries, to the account the link was asked from.
 */
const finishLink = async (
  request: SignInRequest,
  signIn: IdTokenSignIn
): Promise<Response> => {
  const { accessToken, locale, tenantId } = request;

  const linked = await withConfirmingSession(
    request,
    CONFIRMING_SCREENS.link,
    () => linkMyIdentity(tenantId, signIn, accessToken)
  );

  if (linked instanceof Response) {
    return linked;
  }

  const t = await getMessagesFor(locale);
  const provider = SIGN_IN_PROVIDER_NAMES[signIn.provider];

  switch (linked.kind) {
    case "linked": {
      const path = await tenantLocalePath(
        tenantId,
        locale,
        CONFIRMING_SCREENS.link
      );

      const params = new URLSearchParams({
        message: t("storefront.settings.linked_account_linked", { provider }),
        status: "success",
      });

      return seeOther(`${path}?${params.toString()}`);
    }

    case "linked_to_another_account": {
      return failure(
        request,
        t("storefront.settings.linked_account_link_another_account", {
          provider,
        })
      );
    }

    case "provider_already_linked": {
      return failure(
        request,
        t("storefront.settings.linked_account_link_already_linked", {
          provider,
        })
      );
    }

    default: {
      return failure(
        request,
        rpcErrorMessage(
          linked.error,
          t("storefront.settings.linked_account_link_failed"),
          {
            locale,
            overrides: {
              // A token the API could not verify, or a nonce already spent.
              "invalid-argument": t(
                "storefront.settings.linked_account_link_unverified",
                { provider }
              ),
              // The tenant stopped offering the provider meanwhile.
              precondition: t("storefront.auth.social.errors.unavailable"),
            },
          }
        )
      );
    }
  }
};

/** Back on the security settings screen, with what the step did. */
const securitySettingsOutcome = async (
  { locale, tenantId }: SignInRequest,
  message: string
): Promise<Response> => {
  const path = await tenantLocalePath(
    tenantId,
    locale,
    CONFIRMING_SCREENS.passkey_add
  );

  const params = new URLSearchParams({ message, status: "success" });

  return seeOther(`${path}?${params.toString()}`);
};

/**
 * Keep the sign-in that confirmed adding a passkey for the security settings
 * screen, which is the only place the browser can be asked for a passkey, and
 * only once the reader presses a button there. **Create the passkey** begins
 * the registration with it.
 */
const finishPasskeyAdd = async (
  request: SignInRequest,
  { idToken, nonce, provider }: IdTokenSignIn
): Promise<Response> => {
  const { locale, tenantId } = request;

  await writePendingPasskeyRegistration({ idToken, nonce, provider, tenantId });

  return seeOther(
    await tenantLocalePath(tenantId, locale, CONFIRMING_SCREENS.passkey_add)
  );
};

/** Remove the passkey the sign-in was asked to confirm the removal of. */
const finishPasskeyRemove = async (
  request: SignInRequest,
  { idToken, nonce, provider }: IdTokenSignIn
): Promise<Response> => {
  const { accessToken, locale, target, tenantId } = request;
  const t = await getMessagesFor(locale);

  if (!target) {
    return failure(request, t("storefront.settings.passkey_remove_failed"));
  }

  const removed = await withConfirmingSession(
    request,
    CONFIRMING_SCREENS.passkey_remove,
    () =>
      deleteMyPasskey(
        tenantId,
        target,
        { idToken, nonce, provider },
        accessToken
      )
  );

  if (removed instanceof Response) {
    return removed;
  }

  if (!removed.ok) {
    return failure(
      request,
      rpcErrorMessage(
        removed.error,
        t("storefront.settings.passkey_remove_failed"),
        {
          locale,
          overrides: {
            "invalid-argument": t("storefront.settings.confirm_unconfirmed"),
            "not-found": t("storefront.settings.passkey_not_found"),
            precondition: t("storefront.settings.passkey_last"),
          },
        }
      )
    );
  }

  return securitySettingsOutcome(
    request,
    t("storefront.settings.passkey_removed")
  );
};

/**
 * Unlink the provider the sign-in was asked to confirm the unlink of, which
 * may be another provider than the one signed in to.
 */
const finishIdentityUnlink = async (
  request: SignInRequest,
  { idToken, nonce, provider }: IdTokenSignIn
): Promise<Response> => {
  const { accessToken, locale, target, tenantId } = request;
  const t = await getMessagesFor(locale);
  const unlinked = SIGN_IN_PROVIDERS.find((value) => value === target);

  if (!unlinked) {
    return failure(
      request,
      t("storefront.settings.linked_account_unlink_failed")
    );
  }

  const result = await withConfirmingSession(
    request,
    CONFIRMING_SCREENS.identity_unlink,
    () =>
      unlinkMyIdentity(
        tenantId,
        unlinked,
        { idToken, nonce, provider },
        accessToken
      )
  );

  if (result instanceof Response) {
    return result;
  }

  if (!result.ok) {
    return failure(
      request,
      rpcErrorMessage(
        result.error,
        t("storefront.settings.linked_account_unlink_failed"),
        {
          locale,
          overrides: {
            "invalid-argument": t("storefront.settings.confirm_unconfirmed"),
            precondition: t("storefront.settings.linked_account_last"),
          },
        }
      )
    );
  }

  return securitySettingsOutcome(
    request,
    t("storefront.settings.linked_account_unlinked")
  );
};

/**
 * Where Apple and Google post a reader back to, from their own site. The state
 * it echoes and the nonce in its token tie it to the request this browser made.
 */
export const POST = async (
  request: Request,
  { params }: RouteContext<"/[tenant_id]/api/v1/auth/[provider]/callback">
) => {
  const { provider, tenant_id } = await params;
  const path = callbackPathSchema.safeParse({ provider, tenantId: tenant_id });

  if (!path.success) {
    return new Response(null, { status: 404 });
  }

  const [signInRequest, form] = await Promise.all([
    readSignInRequest(),
    readCallbackForm(request),
  ]);

  await clearSignInRequest();

  if (
    !signInRequest ||
    signInRequest.provider !== path.data.provider ||
    signInRequest.tenantId !== path.data.tenantId ||
    !form ||
    !isExpectedState(signInRequest.state, form.state)
  ) {
    // Nothing on hand says where the reader came from or in which language.
    const locale = await getTenantDefaultLocale(path.data.tenantId);
    const t = await getMessagesFor(locale);

    return failure(
      { locale, intent: "login", returnTo: "/", tenantId: path.data.tenantId },
      t("storefront.auth.social.errors.failed")
    );
  }

  if (form.error || !form.id_token) {
    return failure(signInRequest);
  }

  const signIn: IdTokenSignIn = {
    authorizationCode: form.code?.trim() ?? "",
    idToken: form.id_token,
    nonce: signInRequest.nonce,
    provider: signInRequest.provider,
    redirectUri: signInRequest.redirectUri,
  };

  switch (signInRequest.intent) {
    case "delete": {
      return finishDeletion(signInRequest, signIn);
    }

    case "email_change": {
      return finishEmailChange(signInRequest, signIn);
    }

    case "link": {
      return finishLink(signInRequest, signIn);
    }

    case "mfa_disable": {
      return finishMfaDisable(signInRequest, signIn);
    }

    case "passkey_add": {
      return finishPasskeyAdd(signInRequest, signIn);
    }

    case "passkey_remove": {
      return finishPasskeyRemove(signInRequest, signIn);
    }

    case "identity_unlink": {
      return finishIdentityUnlink(signInRequest, signIn);
    }

    default: {
      return finishLogin(signInRequest, signIn, appleUserName(form.user));
    }
  }
};
