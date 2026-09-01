import { Code, ConnectError } from "@publira/api-client/errors";
import { encryptSessionPayload } from "@publira/web-session";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  buildLoginPath,
  buildLoginUrl,
  buildReturnToPath,
  hasActivePlatformSessionCookie,
  isSessionRevokedRedirect,
  isUnauthenticatedError,
  rethrowUnauthenticatedRpcError,
  sanitizeRedirectPath,
} from "./auth-shared";

const PUBLIRA_AUTH_SECRET = "test-secret-value-that-is-long-enough-000000";

describe("sanitizeRedirectPath", () => {
  it("keeps same-origin paths unchanged", () => {
    expect(sanitizeRedirectPath("/tenants?token=abc")).toBe(
      "/tenants?token=abc"
    );
  });

  it("normalizes external destinations to the console root", () => {
    // Browsers can read `/\evil.example` as the protocol-relative form.
    expect(sanitizeRedirectPath("https://evil.example")).toBe("/");
    expect(sanitizeRedirectPath("//evil.example")).toBe("/");
    expect(sanitizeRedirectPath("/\\evil.example")).toBe("/");
    expect(sanitizeRedirectPath(null)).toBe("/");
  });

  it("does not return to /login itself", () => {
    expect(sanitizeRedirectPath("/login?next=%2Ftenants")).toBe("/");
  });
});

describe("buildLoginPath", () => {
  it("sanitizes and adds the return destination", () => {
    expect(buildLoginPath("/tenants?token=abc")).toBe(
      "/login?next=%2Ftenants%3Ftoken%3Dabc"
    );
    expect(buildLoginPath("https://evil.example")).toBe("/login?next=%2F");
  });

  it("adds a marker only when caused by expiry", () => {
    expect(buildLoginPath("/tenants", { revoked: true })).toBe(
      "/login?next=%2Ftenants&reason=session_revoked"
    );
  });
});

describe("buildReturnToPath / buildLoginUrl", () => {
  it("uses the return destination with its query string", () => {
    const requestUrl = new URL("https://platform.example.com/users?status=x");

    expect(buildReturnToPath(requestUrl)).toBe("/users?status=x");
    expect(buildLoginUrl(requestUrl).toString()).toBe(
      "https://platform.example.com/login?next=%2Fusers%3Fstatus%3Dx"
    );
  });

  it("uses the console root as the return destination from /login", () => {
    const requestUrl = new URL("https://platform.example.com/login?next=%2Fa");

    expect(buildLoginUrl(requestUrl).searchParams.get("next")).toBe("/");
  });
});

describe("isSessionRevokedRedirect", () => {
  it("checks for the expiry marker", () => {
    expect(
      isSessionRevokedRedirect(
        new URL("https://platform.example.com/login?reason=session_revoked")
      )
    ).toBe(true);
    expect(
      isSessionRevokedRedirect(new URL("https://platform.example.com/login"))
    ).toBe(false);
  });
});

describe("isUnauthenticatedError / rethrowUnauthenticatedRpcError", () => {
  it("treats only Unauthenticated as requiring reauthentication", () => {
    const rejected = new ConnectError("invalid token", Code.Unauthenticated);
    const businessError = new ConnectError("bad input", Code.InvalidArgument);

    expect(isUnauthenticatedError(rejected)).toBe(true);
    expect(isUnauthenticatedError(businessError)).toBe(false);

    expect(() => rethrowUnauthenticatedRpcError(rejected)).toThrow(rejected);
    expect(() => rethrowUnauthenticatedRpcError(businessError)).not.toThrow();
  });
});

describe("hasActivePlatformSessionCookie", () => {
  // `process.env` is shared by every file in the same Vitest worker, so the
  // secret has to be put back or a later file inherits it.
  let originalAuthSecret: string | undefined;

  beforeAll(() => {
    originalAuthSecret = process.env.PUBLIRA_AUTH_SECRET;
    process.env.PUBLIRA_AUTH_SECRET = PUBLIRA_AUTH_SECRET;
  });

  afterAll(() => {
    if (originalAuthSecret === undefined) {
      delete process.env.PUBLIRA_AUTH_SECRET;
      return;
    }
    process.env.PUBLIRA_AUTH_SECRET = originalAuthSecret;
  });

  const sealed = (expiresAt: string): Promise<string> =>
    encryptSessionPayload(
      { accessToken: "header.payload.signature", expiresAt },
      PUBLIRA_AUTH_SECRET
    );

  it("accepts only decryptable, unexpired cookies as valid", async () => {
    const active = await sealed(
      Temporal.Now.instant().add({ minutes: 5 }).toString()
    );
    const expired = await sealed(
      Temporal.Now.instant().subtract({ minutes: 1 }).toString()
    );

    await expect(hasActivePlatformSessionCookie(active)).resolves.toBe(true);
    await expect(hasActivePlatformSessionCookie(expired)).resolves.toBe(false);
    await expect(hasActivePlatformSessionCookie("not-a-session")).resolves.toBe(
      false
    );
    await expect(hasActivePlatformSessionCookie("  ")).resolves.toBe(false);
    await expect(hasActivePlatformSessionCookie()).resolves.toBe(false);
  });
});
