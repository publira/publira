import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { cookieJar } = vi.hoisted(() => ({
  cookieJar: new Map<
    string,
    { options: Record<string, unknown>; value: string }
  >(),
}));

vi.mock("next/headers", () => ({
  cookies: () => ({
    delete: (options: string | { name: string }) => {
      cookieJar.delete(typeof options === "string" ? options : options.name);
    },
    get: (name: string) => {
      const cookie = cookieJar.get(name);
      return cookie ? { name, value: cookie.value } : undefined;
    },
    set: ({ name, value, ...options }: { name: string; value: string }) => {
      cookieJar.set(name, { options, value });
    },
  }),
}));

const tenantId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const signInRequest = {
  intent: "login" as const,
  locale: "en" as const,
  nonce: "nonce-value",
  provider: "google" as const,
  redirectUri: "https://reader.example/api/v1/auth/google/callback",
  returnTo: "/series",
  state: "state-value",
  tenantId,
};

describe("social sign-in", () => {
  beforeEach(() => {
    cookieJar.clear();
    vi.stubEnv("PUBLIRA_AUTH_SECRET", "a".repeat(32));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("sends Google an ID token request answered by a form post", async () => {
    const { buildAuthorizationUrl } = await import("./social-sign-in");

    const url = new URL(
      buildAuthorizationUrl({
        clientId: "web-client",
        nonce: "nonce-value",
        provider: "google",
        redirectUri: signInRequest.redirectUri,
        state: "state-value",
      })
    );

    expect(url.origin + url.pathname).toBe(
      "https://accounts.google.com/o/oauth2/v2/auth"
    );
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: "web-client",
      nonce: "nonce-value",
      redirect_uri: signInRequest.redirectUri,
      response_mode: "form_post",
      response_type: "id_token",
      scope: "openid email profile",
      state: "state-value",
    });
  });

  it("asks Apple for a code beside the ID token, and for the name", async () => {
    const { buildAuthorizationUrl } = await import("./social-sign-in");

    const url = new URL(
      buildAuthorizationUrl({
        clientId: "com.example.web",
        nonce: "nonce-value",
        provider: "apple",
        redirectUri: "https://reader.example/api/v1/auth/apple/callback",
        state: "state-value",
      })
    );

    expect(url.origin + url.pathname).toBe(
      "https://appleid.apple.com/auth/authorize"
    );
    expect(url.searchParams.get("response_type")).toBe("code id_token");
    expect(url.searchParams.get("response_mode")).toBe("form_post");
    expect(url.searchParams.get("scope")).toBe("name email");
    expect(url.searchParams.get("client_id")).toBe("com.example.web");
  });

  it("reads back the nonce and state it kept, from a cookie the provider's post carries", async () => {
    const {
      readSignInRequest,
      SIGN_IN_REQUEST_COOKIE_NAME,
      writeSignInRequest,
    } = await import("./social-sign-in");

    await writeSignInRequest(signInRequest);

    const stored = cookieJar.get(SIGN_IN_REQUEST_COOKIE_NAME);
    expect(stored?.value).not.toContain("nonce-value");
    expect(stored?.options).toMatchObject({
      httpOnly: true,
      path: "/api/v1/auth",
      sameSite: "none",
      secure: true,
    });
    await expect(readSignInRequest()).resolves.toEqual(signInRequest);
  });

  it("answers null for a cookie this deployment did not seal", async () => {
    const { readSignInRequest, SIGN_IN_REQUEST_COOKIE_NAME } =
      await import("./social-sign-in");
    cookieJar.set(SIGN_IN_REQUEST_COOKIE_NAME, {
      options: {},
      value: "not-a-sealed-value",
    });

    await expect(readSignInRequest()).resolves.toBeNull();
  });

  it("spends the request", async () => {
    const { clearSignInRequest, readSignInRequest, writeSignInRequest } =
      await import("./social-sign-in");
    await writeSignInRequest(signInRequest);

    await clearSignInRequest();

    await expect(readSignInRequest()).resolves.toBeNull();
  });

  it("keeps a sign-in waiting for consent in a same-site cookie", async () => {
    const {
      PENDING_SIGN_UP_COOKIE_NAME,
      readPendingSignUp,
      writePendingSignUp,
    } = await import("./social-sign-in");
    const pending = {
      authorizationCode: "",
      idToken: "header.payload.signature",
      locale: "ja" as const,
      name: "",
      nonce: "nonce-value",
      provider: "google" as const,
      redirectUri: signInRequest.redirectUri,
      returnTo: "/",
      tenantId,
    };

    await writePendingSignUp(pending);

    // Apple's authorization code lives five minutes and is exchanged only
    // once the account is created, so the wait for consent ends before it.
    expect(cookieJar.get(PENDING_SIGN_UP_COOKIE_NAME)?.options).toMatchObject({
      httpOnly: true,
      maxAge: 240,
      sameSite: "lax",
    });
    await expect(readPendingSignUp()).resolves.toEqual(pending);
  });

  it("compares the echoed state in full", async () => {
    const { isExpectedState } = await import("./social-sign-in");

    expect(isExpectedState("state-value", "state-value")).toBe(true);
    expect(isExpectedState("state-value", "state-valu")).toBe(false);
    expect(isExpectedState("state-value", "state-other")).toBe(false);
  });

  it("draws a fresh secret each time", async () => {
    const { signInSecret } = await import("./social-sign-in");

    expect(signInSecret()).not.toBe(signInSecret());
    expect(signInSecret()).toMatch(/^[\w-]{43}$/u);
  });
});
