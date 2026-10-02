import { Code, ConnectError } from "@publira/api-client/errors";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  cookieJar,
  mockDeleteMe,
  mockGetTenantSignInClients,
  mockIsSessionRejected,
  mockLoginWithIdToken,
  mockRequestPublicEmailChange,
  mockRequirePublicSession,
  mockSealPublicSessionCookie,
} = vi.hoisted(() => ({
  cookieJar: new Map<string, string>(),
  mockDeleteMe: vi.fn(),
  mockGetTenantSignInClients: vi.fn(),
  mockIsSessionRejected: vi.fn(),
  mockLoginWithIdToken: vi.fn(),
  mockRequestPublicEmailChange: vi.fn(),
  mockRequirePublicSession: vi.fn(),
  mockSealPublicSessionCookie: vi.fn(),
}));

const REDIRECT_PREFIX = "NEXT_REDIRECT:";

vi.mock("next/headers", () => ({
  cookies: () => ({
    delete: (options: string | { name: string }) => {
      cookieJar.delete(typeof options === "string" ? options : options.name);
    },
    get: (name: string) => {
      const value = cookieJar.get(name);
      return value === undefined ? undefined : { name, value };
    },
    set: ({ name, value }: { name: string; value: string }) => {
      cookieJar.set(name, value);
    },
  }),
}));

vi.mock("next/navigation", () => ({
  redirect: (location: string) => {
    throw new Error(`${REDIRECT_PREFIX}${location}`);
  },
}));

vi.mock("#lib/csrf", () => ({ assertSameOrigin: vi.fn() }));

vi.mock("#lib/auth", () => ({
  deleteMe: mockDeleteMe,
  isSessionRejected: mockIsSessionRejected,
  loginWithIdToken: mockLoginWithIdToken,
  requestPublicEmailChange: mockRequestPublicEmailChange,
}));

vi.mock("#lib/auth-session", () => ({
  requirePublicSession: mockRequirePublicSession,
  sealPublicSessionCookie: mockSealPublicSessionCookie,
}));

vi.mock("#lib/tenant", () => ({
  getTenantDefaultLocale: () => Promise.resolve("en"),
  getTenantPublicOrigin: () => Promise.resolve("https://reader.example"),
  getTenantSignInClients: mockGetTenantSignInClients,
}));

vi.mock("#lib/tenant-locale-path", () => ({
  tenantLocalePath: (_tenantId: string, locale: string, href: string) =>
    Promise.resolve(`/${locale}${href}`),
}));

const tenantId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const startForm = (fields: Record<string, string>): FormData => {
  const data = new FormData();
  for (const [name, value] of Object.entries({
    intent: "login",
    locale: "en",
    provider: "google",
    returnTo: "/series",
    tenantId,
    ...fields,
  })) {
    data.set(name, value);
  }
  return data;
};

/** Where an Action sent the reader, read off the redirect it threw. */
const redirectedTo = async (action: Promise<void>): Promise<URL> => {
  try {
    await action;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith(REDIRECT_PREFIX)) {
      return new URL(
        error.message.slice(REDIRECT_PREFIX.length),
        "https://reader.example"
      );
    }
    throw error;
  }
  throw new Error("the action did not redirect");
};

/** Start a sign-in and answer where the reader was sent. */
const startSignIn = async (fields: Record<string, string> = {}) => {
  const { startSocialSignInAction } =
    await import("#lib/social-sign-in-actions");
  return redirectedTo(startSocialSignInAction(startForm(fields)));
};

/** Ask for an email change from the security settings of an account without a password. */
const startEmailChange = async () => {
  const { confirmEmailChangeWithProviderAction } =
    await import("../../../../../[locale]/(site)/settings/security/_lib/actions");
  const data = new FormData();
  for (const [name, value] of Object.entries({
    currentEmail: "reader@example.com",
    locale: "en",
    newEmail: "moved@example.com",
    provider: "google",
    tenantId,
  })) {
    data.set(name, value);
  }
  return redirectedTo(confirmEmailChangeWithProviderAction(data));
};

const postAnswer = async (
  provider: string,
  fields: Record<string, string>
): Promise<Response> => {
  const { POST } = await import("./route");
  return POST(
    new Request(`https://reader.example/api/v1/auth/${provider}/callback`, {
      body: new URLSearchParams(fields),
      method: "POST",
    }),
    { params: Promise.resolve({ provider, tenant_id: tenantId }) }
  );
};

/** The handler forwards the session to the cookie writer without reading it. */
const session = { accessToken: "access-token" };

describe("Apple and Google sign-in round trip", () => {
  beforeEach(() => {
    cookieJar.clear();
    vi.stubEnv("PUBLIRA_AUTH_SECRET", "a".repeat(32));
    mockGetTenantSignInClients.mockResolvedValue({
      apple: "com.example.web",
      google: "web-client",
    });
    mockRequirePublicSession.mockResolvedValue("access-token");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("hands the API the nonce the provider was sent, and signs the reader in", async () => {
    const authorization = await startSignIn();
    const nonce = authorization.searchParams.get("nonce") ?? "";
    mockLoginWithIdToken.mockResolvedValueOnce({ kind: "signed_in", session });

    const response = await postAnswer("google", {
      id_token: "header.payload.signature",
      state: authorization.searchParams.get("state") ?? "",
    });

    expect(authorization.origin).toBe("https://accounts.google.com");
    expect(authorization.searchParams.get("redirect_uri")).toBe(
      "https://reader.example/api/v1/auth/google/callback"
    );
    expect(nonce).not.toBe("");
    expect(mockLoginWithIdToken).toHaveBeenCalledWith(tenantId, {
      authorizationCode: "",
      idToken: "header.payload.signature",
      nonce,
      provider: "google",
      redirectUri: "https://reader.example/api/v1/auth/google/callback",
    });
    expect(mockSealPublicSessionCookie).toHaveBeenCalledWith(session, tenantId);
    expect(response.status).toBe(303);
    expect(response.headers.get("Location")).toBe("/en/series");
  });

  it("sends Apple's code and the name it hands over once", async () => {
    const authorization = await startSignIn({ provider: "apple" });
    mockLoginWithIdToken.mockResolvedValueOnce({ kind: "consent_required" });

    const response = await postAnswer("apple", {
      code: "apple-code",
      id_token: "header.payload.signature",
      state: authorization.searchParams.get("state") ?? "",
      user: JSON.stringify({ name: { firstName: "Ada", lastName: "Reader" } }),
    });

    expect(mockLoginWithIdToken).toHaveBeenCalledWith(
      tenantId,
      expect.objectContaining({
        authorizationCode: "apple-code",
        provider: "apple",
        redirectUri: "https://reader.example/api/v1/auth/apple/callback",
      })
    );
    expect(response.headers.get("Location")).toBe("/en/signup/continue");
    const { readPendingSignUp } = await import("#lib/social-sign-in");
    await expect(readPendingSignUp()).resolves.toMatchObject({
      authorizationCode: "apple-code",
      name: "Ada Reader",
      nonce: authorization.searchParams.get("nonce"),
      returnTo: "/series",
    });
  });

  it("refuses an answer whose state is not the one this browser was given", async () => {
    await startSignIn();

    const response = await postAnswer("google", {
      id_token: "header.payload.signature",
      state: "forged-state",
    });

    expect(mockLoginWithIdToken).not.toHaveBeenCalled();
    const location = new URL(
      response.headers.get("Location") ?? "",
      "https://reader.example"
    );
    expect(location.pathname).toBe("/en/login");
    expect(location.searchParams.get("error")).toBe(
      "Could not sign in. Please try again."
    );
  });

  it("refuses an answer once the request has been spent", async () => {
    const authorization = await startSignIn();
    const state = authorization.searchParams.get("state") ?? "";
    mockLoginWithIdToken.mockResolvedValue({ kind: "signed_in", session });
    await postAnswer("google", { id_token: "first.token.value", state });

    await postAnswer("google", { id_token: "second.token.value", state });

    expect(mockLoginWithIdToken).toHaveBeenCalledOnce();
  });

  it("refuses an answer posted to the other provider's callback", async () => {
    const authorization = await startSignIn({ provider: "apple" });

    await postAnswer("google", {
      id_token: "header.payload.signature",
      state: authorization.searchParams.get("state") ?? "",
    });

    expect(mockLoginWithIdToken).not.toHaveBeenCalled();
  });

  it("returns a reader who stopped at the provider without a message", async () => {
    const authorization = await startSignIn();

    const response = await postAnswer("google", {
      error: "access_denied",
      state: authorization.searchParams.get("state") ?? "",
    });

    expect(response.headers.get("Location")).toBe(
      "/en/login?returnTo=%2Fseries"
    );
  });

  it("words an account the API refuses", async () => {
    const authorization = await startSignIn();
    mockLoginWithIdToken.mockResolvedValueOnce({
      error: new ConnectError("refused", Code.FailedPrecondition),
      kind: "refused",
    });

    const response = await postAnswer("google", {
      id_token: "header.payload.signature",
      state: authorization.searchParams.get("state") ?? "",
    });

    const location = new URL(
      response.headers.get("Location") ?? "",
      "https://reader.example"
    );
    expect(location.searchParams.get("error")).toBe(
      "This account cannot sign in here. Sign in with your email address instead."
    );
  });

  it("confirms a deletion with the fresh sign-in", async () => {
    const authorization = await startSignIn({
      intent: "delete",
      returnTo: "/settings",
    });
    mockDeleteMe.mockResolvedValueOnce(true);

    const response = await postAnswer("google", {
      id_token: "header.payload.signature",
      state: authorization.searchParams.get("state") ?? "",
    });

    expect(mockRequirePublicSession).toHaveBeenCalledWith(
      "en",
      "/settings",
      tenantId
    );
    // The provider's POST carries no SameSite=Lax cookie, so the session the
    // deletion is for travels in the sealed request.
    expect(mockDeleteMe).toHaveBeenCalledWith(
      tenantId,
      {
        idToken: "header.payload.signature",
        nonce: authorization.searchParams.get("nonce"),
        provider: "google",
      },
      "access-token"
    );
    expect(mockLoginWithIdToken).not.toHaveBeenCalled();
    expect(response.headers.get("Location")).toMatch(/^\/en\/login\?/u);
  });

  it("asks for an email change with the fresh sign-in", async () => {
    const authorization = await startEmailChange();
    mockRequestPublicEmailChange.mockResolvedValueOnce(true);

    const response = await postAnswer("google", {
      id_token: "header.payload.signature",
      state: authorization.searchParams.get("state") ?? "",
    });

    expect(authorization.origin).toBe("https://accounts.google.com");
    expect(mockRequirePublicSession).toHaveBeenCalledWith(
      "en",
      "/settings/security",
      tenantId
    );
    // The addresses wait in the sealed request while the reader is at Google.
    expect(mockRequestPublicEmailChange).toHaveBeenCalledWith(
      tenantId,
      "reader@example.com",
      "moved@example.com",
      {
        idToken: "header.payload.signature",
        nonce: authorization.searchParams.get("nonce"),
        provider: "google",
      },
      "access-token"
    );
    expect(mockLoginWithIdToken).not.toHaveBeenCalled();
    const location = new URL(
      response.headers.get("Location") ?? "",
      "https://reader.example"
    );
    expect(location.pathname).toBe("/en/settings/security");
    expect(location.searchParams.get("status")).toBe("success");
  });

  it("returns a refused email change to the security settings", async () => {
    const authorization = await startEmailChange();
    mockRequestPublicEmailChange.mockResolvedValueOnce(false);

    const response = await postAnswer("google", {
      id_token: "header.payload.signature",
      state: authorization.searchParams.get("state") ?? "",
    });

    const location = new URL(
      response.headers.get("Location") ?? "",
      "https://reader.example"
    );
    expect(location.pathname).toBe("/en/settings/security");
    expect(location.searchParams.get("status")).toBe("error");
    expect(location.searchParams.get("message")).toBe(
      "Could not request the email change. Please check what you entered."
    );
  });

  it("sends a reader whose session ended to sign in again before the change", async () => {
    const authorization = await startEmailChange();
    mockRequestPublicEmailChange.mockRejectedValueOnce(
      new ConnectError("session ended", Code.Unauthenticated)
    );
    mockIsSessionRejected.mockResolvedValueOnce(true);

    const response = await postAnswer("google", {
      id_token: "header.payload.signature",
      state: authorization.searchParams.get("state") ?? "",
    });

    const location = new URL(
      response.headers.get("Location") ?? "",
      "https://reader.example"
    );
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("returnTo")).toBe("/settings/security");
  });

  it("keeps the reader signed in when the API refuses the sign-in rather than the session", async () => {
    const authorization = await startEmailChange();
    mockRequestPublicEmailChange.mockRejectedValueOnce(
      new ConnectError("invalid ID token", Code.Unauthenticated)
    );
    mockIsSessionRejected.mockResolvedValueOnce(false);

    const response = await postAnswer("google", {
      id_token: "header.payload.signature",
      state: authorization.searchParams.get("state") ?? "",
    });

    expect(mockIsSessionRejected).toHaveBeenCalledWith(
      tenantId,
      "access-token"
    );
    const location = new URL(
      response.headers.get("Location") ?? "",
      "https://reader.example"
    );
    expect(location.pathname).toBe("/en/settings/security");
    expect(location.searchParams.get("status")).toBe("error");
    expect(location.searchParams.has("reason")).toBe(false);
  });

  it("offers no provider the tenant has not enabled", async () => {
    mockGetTenantSignInClients.mockResolvedValueOnce({ apple: "com.example" });

    const destination = await startSignIn();

    expect(destination.pathname).toBe("/en/login");
    expect(destination.searchParams.get("error")).toBe(
      "This sign-in method is not available right now."
    );
  });
});
