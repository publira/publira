import { Code, ConnectError } from "@publira/api-client/errors";
import { encryptSessionPayload } from "@publira/web-session";
import { beforeAll, describe, expect, it } from "vitest";

import {
  buildLoginPath,
  buildLoginUrl,
  buildReturnToPath,
  hasActiveAdminSessionCookie,
  isSessionRevokedRedirect,
  isUnauthenticatedError,
  rethrowUnauthenticatedRpcError,
  sanitizeRedirectPath,
} from "./admin-auth-shared";

const PUBLIRA_AUTH_SECRET = "test-secret-value-that-is-long-enough-000000";

const sealedCookie = (expiresAt: string): Promise<string> =>
  encryptSessionPayload(
    {
      accessToken: "header.payload.signature",
      expiresAt,
      tenantId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    },
    PUBLIRA_AUTH_SECRET
  );

describe("sanitizeRedirectPath", () => {
  it("allows internal paths", () => {
    expect(sanitizeRedirectPath("/series")).toBe("/series");
    expect(sanitizeRedirectPath("/settings?tab=theme")).toBe(
      "/settings?tab=theme"
    );
  });

  it("rejects empty, external, and login paths", () => {
    expect(sanitizeRedirectPath("")).toBe("/");
    expect(sanitizeRedirectPath("https://example.com")).toBe("/");
    expect(sanitizeRedirectPath("//evil.example.com")).toBe("/");
    // Browsers read `/\evil.example` as the protocol-relative form.
    expect(sanitizeRedirectPath("/\\evil.example.com")).toBe("/");
    expect(sanitizeRedirectPath("/login")).toBe("/");
    expect(sanitizeRedirectPath("/login?next=/series")).toBe("/");
  });
});

describe("buildLoginPath", () => {
  it("carries the sanitized return path", () => {
    expect(buildLoginPath("/series?token=abc")).toBe(
      "/login?next=%2Fseries%3Ftoken%3Dabc"
    );
  });

  it("marks a redirect a rejected session produced", () => {
    expect(buildLoginPath("/series", { revoked: true })).toBe(
      "/login?next=%2Fseries&reason=session_revoked"
    );
  });
});

describe("isSessionRevokedRedirect", () => {
  it("only matches the marker this app writes", () => {
    expect(
      isSessionRevokedRedirect(
        new URL("https://admin.example.com/login?reason=session_revoked")
      )
    ).toBe(true);
    expect(
      isSessionRevokedRedirect(new URL("https://admin.example.com/login"))
    ).toBe(false);
    expect(
      isSessionRevokedRedirect(
        new URL("https://admin.example.com/login?reason=whatever")
      )
    ).toBe(false);
  });
});

describe("buildReturnToPath / buildLoginUrl", () => {
  it("keeps the query string", () => {
    expect(
      buildReturnToPath(new URL("https://admin.example.com/series?draft=1"))
    ).toBe("/series?draft=1");
  });

  it("never sends the operator back to an external origin", () => {
    const loginUrl = buildLoginUrl(
      new URL("https://admin.example.com//evil.example.com")
    );
    expect(loginUrl.pathname).toBe("/login");
    expect(loginUrl.searchParams.get("next")).toBe("/");
  });
});

describe("isUnauthenticatedError / rethrowUnauthenticatedRpcError", () => {
  it("only a rejected session follows the re-authentication flow", () => {
    const unauthenticated = new ConnectError("nope", Code.Unauthenticated);
    const invalidArgument = new ConnectError("nope", Code.InvalidArgument);

    expect(isUnauthenticatedError(unauthenticated)).toBe(true);
    expect(isUnauthenticatedError(invalidArgument)).toBe(false);
    expect(isUnauthenticatedError(new Error("boom"))).toBe(false);

    expect(() => rethrowUnauthenticatedRpcError(unauthenticated)).toThrow(
      unauthenticated
    );
    expect(() => rethrowUnauthenticatedRpcError(invalidArgument)).not.toThrow();
  });
});

describe("hasActiveAdminSessionCookie", () => {
  beforeAll(() => {
    process.env.PUBLIRA_AUTH_SECRET = PUBLIRA_AUTH_SECRET;
  });

  it("accepts a cookie that decrypts and has not expired", async () => {
    const cookie = await sealedCookie(
      Temporal.Now.instant().add({ minutes: 5 }).toString()
    );
    await expect(hasActiveAdminSessionCookie(cookie)).resolves.toBe(true);
  });

  it("rejects a missing, undecryptable, or expired cookie", async () => {
    await expect(hasActiveAdminSessionCookie()).resolves.toBe(false);
    await expect(hasActiveAdminSessionCookie("   ")).resolves.toBe(false);
    await expect(hasActiveAdminSessionCookie("not-a-session")).resolves.toBe(
      false
    );

    const expired = await sealedCookie(
      Temporal.Now.instant().subtract({ minutes: 1 }).toString()
    );
    await expect(hasActiveAdminSessionCookie(expired)).resolves.toBe(false);
  });
});
