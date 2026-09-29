/**
 * Signing a reader in with Apple or Google: the site sends the reader to the
 * provider's authorization endpoint, and the provider posts its answer back to
 * {@link signInCallbackPath}. The nonce the ID token has to carry and the state
 * the answer has to echo wait in a cookie sealed with the session key.
 */

import { randomBytes, timingSafeEqual } from "node:crypto";

import type { Locale } from "@publira/i18n";
import {
  decryptPayload,
  encryptPayload,
  resolveAuthSecret,
} from "@publira/web-session";
import { profileCookieName } from "@publira/web-session/cookie-name";
import { cookies } from "next/headers";
import { z } from "zod";

import { returnToFormSchema } from "./auth-input";
import { localeFormSchema } from "./locale-form";
import { SIGN_IN_PROVIDERS } from "./sign-in-provider";
import type { SignInProvider } from "./sign-in-provider";
import { isTenantIdFormat } from "./tenant-id-format";

/**
 * What the fresh sign-in is for: signing in, or confirming that an account
 * without a password is to be deleted.
 */
export const SIGN_IN_INTENTS = ["login", "delete"] as const;

export type SignInIntent = (typeof SIGN_IN_INTENTS)[number];

const AUTHORIZATION_ENDPOINTS: Record<SignInProvider, string> = {
  apple: "https://appleid.apple.com/auth/authorize",
  google: "https://accounts.google.com/o/oauth2/v2/auth",
};

/** Long enough to pick an account and approve, short enough to be spent. */
const SIGN_IN_COOKIE_MAX_AGE_SECONDS = 600;

/**
 * The path a provider posts its answer to, which the tenant registers with it.
 * Under `/api`, so one address serves every locale.
 */
export const signInCallbackPath = (provider: SignInProvider): string =>
  `/api/v1/auth/${provider}/callback`;

/** A fresh random value for a nonce or a state. */
export const signInSecret = (): string => randomBytes(32).toString("base64url");

/**
 * Where the reader is sent to sign in. Apple is also asked for a code, which
 * the API keeps to revoke the link with later.
 */
export const buildAuthorizationUrl = ({
  clientId,
  nonce,
  provider,
  redirectUri,
  state,
}: {
  clientId: string;
  nonce: string;
  provider: SignInProvider;
  redirectUri: string;
  state: string;
}): string => {
  const url = new URL(AUTHORIZATION_ENDPOINTS[provider]);
  url.search = new URLSearchParams({
    client_id: clientId,
    nonce,
    redirect_uri: redirectUri,
    response_mode: "form_post",
    response_type: provider === "apple" ? "code id_token" : "id_token",
    scope: provider === "apple" ? "name email" : "openid email profile",
    state,
  }).toString();
  return url.toString();
};

export const SIGN_IN_REQUEST_COOKIE_NAME = profileCookieName(
  "publira_web_host_sign_in"
);

const signInRequestSchema = z.object({
  accessToken: z.string().min(1).optional(),
  intent: z.enum(SIGN_IN_INTENTS),
  locale: localeFormSchema,
  nonce: z.string().min(1),
  provider: z.enum(SIGN_IN_PROVIDERS),
  redirectUri: z.url(),
  returnTo: returnToFormSchema,
  state: z.string().min(1),
  tenantId: z.string().refine(isTenantIdFormat),
});

export interface SignInRequest {
  /**
   * The session a deletion is confirmed for. The provider's POST carries no
   * `SameSite=Lax` cookie, so the session cookie never reaches the callback.
   */
  accessToken?: string;
  intent: SignInIntent;
  locale: Locale;
  nonce: string;
  provider: SignInProvider;
  redirectUri: string;
  returnTo: string;
  state: string;
  tenantId: string;
}

/**
 * Keep the request a provider's answer is checked against. `SameSite=None`,
 * because the answer is a POST from the provider's site, which a browser sends
 * no `SameSite=Lax` cookie with.
 */
export const writeSignInRequest = async (
  request: SignInRequest
): Promise<void> => {
  const sealed = await encryptPayload(request, resolveAuthSecret());
  const cookieStore = await cookies();
  cookieStore.set({
    httpOnly: true,
    maxAge: SIGN_IN_COOKIE_MAX_AGE_SECONDS,
    name: SIGN_IN_REQUEST_COOKIE_NAME,
    path: "/api/v1/auth",
    sameSite: "none",
    secure: true,
    value: sealed,
  });
};

/** The request this browser started, or `null` when it holds none to act on. */
export const readSignInRequest = async (): Promise<SignInRequest | null> => {
  const cookieStore = await cookies();
  const raw = cookieStore.get(SIGN_IN_REQUEST_COOKIE_NAME)?.value?.trim();
  if (!raw) {
    return null;
  }

  const parsed = signInRequestSchema.safeParse(
    await decryptPayload(raw, resolveAuthSecret())
  );
  return parsed.success ? parsed.data : null;
};

/** Spend the request, whatever the answer was. */
export const clearSignInRequest = async (): Promise<void> => {
  const cookieStore = await cookies();
  cookieStore.delete({
    name: SIGN_IN_REQUEST_COOKIE_NAME,
    path: "/api/v1/auth",
  });
};

/** Whether the state a provider echoed is the one this browser was given. */
export const isExpectedState = (expected: string, echoed: string): boolean => {
  const left = Buffer.from(expected);
  const right = Buffer.from(echoed);
  return left.length === right.length && timingSafeEqual(left, right);
};

export const PENDING_SIGN_UP_COOKIE_NAME = profileCookieName(
  "publira_web_host_sign_up"
);

const pendingSignUpSchema = z.object({
  authorizationCode: z.string(),
  idToken: z.string().min(1),
  locale: localeFormSchema,
  name: z.string(),
  nonce: z.string().min(1),
  provider: z.enum(SIGN_IN_PROVIDERS),
  redirectUri: z.string(),
  returnTo: returnToFormSchema,
  tenantId: z.string().refine(isTenantIdFormat),
});

/**
 * A first sign-in the API holds back until the reader agrees to the tenant's
 * terms. The nonce is still unspent, so the same token is sent again.
 */
export interface PendingSignUp {
  authorizationCode: string;
  idToken: string;
  locale: Locale;
  name: string;
  nonce: string;
  provider: SignInProvider;
  redirectUri: string;
  returnTo: string;
  tenantId: string;
}

/**
 * Shorter than the five minutes Apple's authorization code lives, since the
 * API exchanges the code only once the account is created.
 */
const PENDING_SIGN_UP_MAX_AGE_SECONDS = 240;

/** Keep the sign-in waiting for consent; both ends of it are on this site. */
export const writePendingSignUp = async (
  pending: PendingSignUp
): Promise<void> => {
  const sealed = await encryptPayload(pending, resolveAuthSecret());
  const cookieStore = await cookies();
  cookieStore.set({
    httpOnly: true,
    maxAge: PENDING_SIGN_UP_MAX_AGE_SECONDS,
    name: PENDING_SIGN_UP_COOKIE_NAME,
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    value: sealed,
  });
};

export const readPendingSignUp = async (): Promise<PendingSignUp | null> => {
  const cookieStore = await cookies();
  const raw = cookieStore.get(PENDING_SIGN_UP_COOKIE_NAME)?.value?.trim();
  if (!raw) {
    return null;
  }

  const parsed = pendingSignUpSchema.safeParse(
    await decryptPayload(raw, resolveAuthSecret())
  );
  return parsed.success ? parsed.data : null;
};

export const clearPendingSignUp = async (): Promise<void> => {
  const cookieStore = await cookies();
  cookieStore.delete(PENDING_SIGN_UP_COOKIE_NAME);
};
