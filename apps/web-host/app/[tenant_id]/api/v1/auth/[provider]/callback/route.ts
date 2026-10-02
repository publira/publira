import { rpcErrorMessage } from "@publira/api-client/error-messages";
import { isUnauthenticatedRpcError } from "@publira/api-client/errors";
import { cookies } from "next/headers";
import { z } from "zod";

import {
  deleteMe,
  loginWithIdToken,
  requestPublicEmailChange,
} from "#lib/auth";
import type { IdTokenSignIn } from "#lib/auth";
import { sealPublicSessionCookie } from "#lib/auth-session";
import { buildLoginPath, PUBLIC_SESSION_COOKIE_NAME } from "#lib/auth-shared";
import { getMessagesFor } from "#lib/messages";
import { SIGN_IN_PROVIDERS } from "#lib/sign-in-provider";
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
      .map((part) => part?.trim())
      .filter(Boolean)
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

  const t = await getMessagesFor(request.locale);
  return failure(
    request,
    rpcErrorMessage(outcome.error, t("host.auth.social.errors.failed"), {
      locale: request.locale,
      overrides: {
        precondition: t("host.auth.social.errors.refused"),
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
const withConfirmingSession = async (
  { locale, tenantId }: SignInRequest,
  screen: string,
  run: () => Promise<boolean>
): Promise<boolean | Response> => {
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
  const deleted = await withConfirmingSession(
    request,
    CONFIRMING_SCREENS.delete,
    () => deleteMe(tenantId, { idToken, nonce, provider }, accessToken)
  );
  if (deleted instanceof Response) {
    return deleted;
  }
  const t = await getMessagesFor(locale);
  if (!deleted) {
    return failure(request, t("host.settings.delete_failed"));
  }

  const cookieStore = await cookies();
  cookieStore.delete(PUBLIC_SESSION_COOKIE_NAME);
  const loginPath = await tenantLocalePath(tenantId, locale, "/login");
  const params = new URLSearchParams({
    message: t("host.settings.deleted"),
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
    return failure(request, t("host.settings.email_change_failed"));
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
  if (!requested) {
    return failure(request, t("host.settings.email_change_failed"));
  }

  const path = await tenantLocalePath(
    tenantId,
    locale,
    CONFIRMING_SCREENS.email_change
  );
  const params = new URLSearchParams({
    message: t("host.settings.email_change_requested"),
    status: "success",
  });
  return seeOther(`${path}?${params.toString()}`);
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
      { intent: "login", locale, returnTo: "/", tenantId: path.data.tenantId },
      t("host.auth.social.errors.failed")
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
    default: {
      return finishLogin(signInRequest, signIn, appleUserName(form.user));
    }
  }
};
