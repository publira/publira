import "temporal-polyfill/global";
import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";
import { encryptSessionPayload, resolveAuthSecret } from "@publira/web-session";
import { SignJWT } from "jose";

import { runSql } from "./db";

export const HOST_SESSION_COOKIE_NAME = "publira_web_host_auth";
export const ADMIN_SESSION_COOKIE_NAME = "publira_web_admin_auth";
export const PLATFORM_SESSION_COOKIE_NAME = "publira_web_platform_auth";

/**
 * Sign-in failure copy of the admin and platform consoles. The Host site words
 * the same failure differently, so it has its own constant.
 */
export const LOGIN_FAILED_MESSAGE =
  "The email address or password is incorrect. Check them and try again.";

export const HOST_LOGIN_FAILED_MESSAGE =
  "That email address or password is incorrect. Check them and try again.";

export const SESSION_REVOKED_MESSAGE =
  "Your session has expired. Please sign in again.";

const JWT_ISSUER = "publira";

const textEncoder = new TextEncoder();

const resolveJwtSecret = (): Uint8Array => {
  const secret = process.env.PUBLIRA_AUTH_JWT_SECRET?.trim() ?? "";
  if (textEncoder.encode(secret).length < 32) {
    throw new Error(
      "PUBLIRA_AUTH_JWT_SECRET is required to mint access tokens (set by e2e scripts)"
    );
  }
  return textEncoder.encode(secret);
};

export const sessionCookieValue = (
  cookies: { name: string; value: string }[],
  cookieName: string
): string | undefined =>
  cookies.find((cookie) => cookie.name === cookieName)?.value;

export const fillLoginForm = async (
  page: Page,
  credentials: { email: string; password: string }
): Promise<void> => {
  await page.getByLabel(/Email address/u).fill(credentials.email);
  await page.getByLabel(/Password/u).fill(credentials.password);
  await page.getByRole("button", { name: "Sign in" }).click();
};

export const expectLoginPage = async (page: Page): Promise<void> => {
  await expect(page).toHaveURL(/\/login/u);
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
};

/**
 * Landed on `pathname` at `baseUrl`'s origin. A `/` regex also matches
 * `https://evil.example/`, so open-redirect tests must compare origin.
 */
export const expectSameOriginPath = async (
  page: Page,
  baseUrl: string,
  pathname: string
): Promise<void> => {
  const expectedOrigin = new URL(baseUrl).origin;
  await expect(page).toHaveURL(
    (url) => url.origin === expectedOrigin && url.pathname === pathname
  );
};

export const expectSessionRevokedFlash = async (page: Page): Promise<void> => {
  await expect(page).toHaveURL(/\/login/u);
  await expect(page).toHaveURL(/reason=session_revoked/u);
  await expect(page.getByRole("status")).toContainText(SESSION_REVOKED_MESSAGE);
};

export const replaceSessionCookie = async (
  page: Page,
  cookieName: string,
  baseUrl: string,
  payload: {
    accessToken: string;
    expiresAt: string;
    tenantId?: string;
  }
): Promise<void> => {
  const value = await encryptSessionPayload(payload, resolveAuthSecret());
  await page.context().clearCookies({ name: cookieName });
  await page.context().addCookies([
    {
      httpOnly: true,
      name: cookieName,
      sameSite: "Lax",
      url: baseUrl,
      value,
    },
  ]);
};

/**
 * A cookie the proxy will reject locally: decrypts, but `expiresAt` is past.
 * The login redirect is a missing-session one, not `reason=session_revoked`.
 */
export const plantExpiredSessionCookie = async (
  page: Page,
  cookieName: string,
  baseUrl: string,
  tenantId?: string
): Promise<void> => {
  await replaceSessionCookie(page, cookieName, baseUrl, {
    accessToken: "expired-local-session",
    expiresAt: Temporal.Now.instant().subtract({ minutes: 5 }).toString(),
    tenantId,
  });
};

/** The claims publira server signs into an access token. */
interface AccessTokenClaims {
  subject: string;
  audience: "admin" | "platform" | "public";
  tenantId?: string;
  role?: string;
  credentialsVersion?: number;
}

const signAccessToken = (
  claims: AccessTokenClaims,
  issuedAt: Temporal.Instant,
  expiresAt: Temporal.Instant
): Promise<string> =>
  new SignJWT({
    cv: claims.credentialsVersion ?? 1,
    role: claims.role ?? "",
    tid: claims.tenantId ?? "",
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(JWT_ISSUER)
    .setSubject(claims.subject)
    .setAudience(claims.audience)
    .setIssuedAt(Math.floor(issuedAt.epochMilliseconds / 1000))
    .setExpirationTime(Math.floor(expiresAt.epochMilliseconds / 1000))
    .sign(resolveJwtSecret());

export const mintExpiredAccessToken = (
  claims: AccessTokenClaims
): Promise<string> => {
  const now = Temporal.Now.instant();
  return signAccessToken(
    claims,
    now.subtract({ hours: 2 }),
    now.subtract({ hours: 1 })
  );
};

/**
 * The session cookie signing in would have left, for a console the spec
 * cannot sign in to: one whose tenant the API is refusing, where the sign-in
 * form is the very thing that is refused.
 */
export const plantSessionCookie = async (
  page: Page,
  cookieName: string,
  baseUrl: string,
  claims: AccessTokenClaims
): Promise<void> => {
  const now = Temporal.Now.instant();
  const expiresAt = now.add({ hours: 1 });
  await replaceSessionCookie(page, cookieName, baseUrl, {
    accessToken: await signAccessToken(claims, now, expiresAt),
    expiresAt: expiresAt.toString(),
    tenantId: claims.tenantId,
  });
};

/**
 * A cookie the proxy still admits (`expiresAt` is future) whose Bearer token
 * the API will reject as expired. The page then redirects with
 * `reason=session_revoked`.
 */
export const plantExpiredAccessTokenCookie = async (
  page: Page,
  cookieName: string,
  baseUrl: string,
  claims: AccessTokenClaims
): Promise<void> => {
  await replaceSessionCookie(page, cookieName, baseUrl, {
    accessToken: await mintExpiredAccessToken(claims),
    expiresAt: Temporal.Now.instant().add({ hours: 1 }).toString(),
    tenantId: claims.tenantId,
  });
};

const quoteSqlLiteral = (value: string): string =>
  `'${value.replaceAll("'", "''")}'`;

export const bumpUserCredentialsVersion = (email: string): void => {
  runSql(`
    UPDATE users
    SET credentials_version = credentials_version + 1
    WHERE email = ${quoteSqlLiteral(email)};
  `);
};

export const bumpPlatformUserCredentialsVersion = (email: string): void => {
  runSql(`
    UPDATE platform_users
    SET credentials_version = credentials_version + 1
    WHERE email = ${quoteSqlLiteral(email)};
  `);
};
