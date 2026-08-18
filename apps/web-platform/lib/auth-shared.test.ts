import { Code, ConnectError } from "@publira/api-client/errors";
import { encryptSessionPayload } from "@publira/web-session";
import { beforeAll, describe, expect, it } from "vitest";

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
  it("同一オリジンのパスはそのまま通す", () => {
    expect(sanitizeRedirectPath("/tenants?token=abc")).toBe(
      "/tenants?token=abc"
    );
  });

  it("外部へ出る書き方はコンソール直下に丸める", () => {
    // Browsers can read `/\evil.example` as the protocol-relative form.
    expect(sanitizeRedirectPath("https://evil.example")).toBe("/");
    expect(sanitizeRedirectPath("//evil.example")).toBe("/");
    expect(sanitizeRedirectPath("/\\evil.example")).toBe("/");
    expect(sanitizeRedirectPath(null)).toBe("/");
  });

  it("/login 自身へは戻さない", () => {
    expect(sanitizeRedirectPath("/login?next=%2Ftenants")).toBe("/");
  });
});

describe("buildLoginPath", () => {
  it("戻り先を sanitize して付ける", () => {
    expect(buildLoginPath("/tenants?token=abc")).toBe(
      "/login?next=%2Ftenants%3Ftoken%3Dabc"
    );
    expect(buildLoginPath("https://evil.example")).toBe("/login?next=%2F");
  });

  it("失効由来のときだけマーカーを付ける", () => {
    expect(buildLoginPath("/tenants", { revoked: true })).toBe(
      "/login?next=%2Ftenants&reason=session_revoked"
    );
  });
});

describe("buildReturnToPath / buildLoginUrl", () => {
  it("クエリ文字列ごと戻り先にする", () => {
    const requestUrl = new URL("https://platform.example.com/users?status=x");

    expect(buildReturnToPath(requestUrl)).toBe("/users?status=x");
    expect(buildLoginUrl(requestUrl).toString()).toBe(
      "https://platform.example.com/login?next=%2Fusers%3Fstatus%3Dx"
    );
  });

  it("/login からの戻り先はコンソール直下にする", () => {
    const requestUrl = new URL("https://platform.example.com/login?next=%2Fa");

    expect(buildLoginUrl(requestUrl).searchParams.get("next")).toBe("/");
  });
});

describe("isSessionRevokedRedirect", () => {
  it("失効マーカーの有無を見る", () => {
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
  it("Unauthenticated だけを再認証扱いにする", () => {
    const rejected = new ConnectError("invalid token", Code.Unauthenticated);
    const businessError = new ConnectError("bad input", Code.InvalidArgument);

    expect(isUnauthenticatedError(rejected)).toBe(true);
    expect(isUnauthenticatedError(businessError)).toBe(false);

    expect(() => rethrowUnauthenticatedRpcError(rejected)).toThrow(rejected);
    expect(() => rethrowUnauthenticatedRpcError(businessError)).not.toThrow();
  });
});

describe("hasActivePlatformSessionCookie", () => {
  beforeAll(() => {
    process.env.PUBLIRA_AUTH_SECRET = PUBLIRA_AUTH_SECRET;
  });

  const sealed = (expiresAt: string): Promise<string> =>
    encryptSessionPayload(
      { accessToken: "header.payload.signature", expiresAt },
      PUBLIRA_AUTH_SECRET
    );

  it("復号でき期限内の Cookie だけを有効とみなす", async () => {
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
