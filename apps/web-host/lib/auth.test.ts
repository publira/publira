import {
  BadRequestSchema,
  Code,
  ConnectError,
  ErrorInfoSchema,
} from "@publira/api-client/errors";
import { IdentityProvider } from "@publira/api-client/public/auth";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockLogin,
  mockDeleteMe,
  mockLogout,
  mockGetMe,
  mockGetNotificationSettings,
  mockListMyIdentities,
  mockLoginWithIdToken,
  mockRequestEmailChange,
  mockResolveAccessToken,
  mockUpdateMe,
} = vi.hoisted(() => ({
  mockDeleteMe: vi.fn(),
  mockGetMe: vi.fn(),
  mockGetNotificationSettings: vi.fn(),
  mockListMyIdentities: vi.fn(),
  mockLogin: vi.fn(),
  mockLoginWithIdToken: vi.fn(),
  mockLogout: vi.fn(),
  mockRequestEmailChange: vi.fn(),
  mockResolveAccessToken: vi.fn(),
  mockUpdateMe: vi.fn(),
}));

vi.mock("./api-client", () => ({
  apiClient: {
    auth: {
      deleteMe: mockDeleteMe,
      getMe: mockGetMe,
      getNotificationSettings: mockGetNotificationSettings,
      listMyIdentities: mockListMyIdentities,
      login: mockLogin,
      loginWithIdToken: mockLoginWithIdToken,
      logout: mockLogout,
      requestEmailChange: mockRequestEmailChange,
      updateMe: mockUpdateMe,
    },
  },
  buildClientAddressHeaders: () =>
    Promise.resolve({ headers: { "X-Forwarded-For": "203.0.113.7" } }),
  buildSessionHeaders: (sessionId: string) => ({
    headers: { Authorization: `Bearer ${sessionId}` },
  }),
  resolveAccessToken: mockResolveAccessToken,
}));

const importAuth = () => import("./auth");

describe("web-host auth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveAccessToken.mockResolvedValue("sid_001");
  });

  it("loginPublic: Returns null if session information is missing", async () => {
    const { loginPublic } = await importAuth();
    mockLogin.mockResolvedValueOnce({
      accessToken: {},
    });

    await expect(loginPublic("a@b.com", "pw", "TENANT001")).resolves.toBeNull();
  });

  it("loginPublic: expected error returns null", async () => {
    const { loginPublic } = await importAuth();
    mockLogin.mockRejectedValueOnce(
      new ConnectError("invalid credentials", Code.Unauthenticated)
    );

    await expect(loginPublic("a@b.com", "pw", "TENANT001")).resolves.toBeNull();
  });

  const idTokenSignIn = {
    authorizationCode: "",
    idToken: "header.payload.signature",
    nonce: "nonce-value",
    provider: "google" as const,
    redirectUri: "https://reader.example/api/v1/auth/google/callback",
  };

  it("loginWithIdToken: signs the reader in with the provider's token", async () => {
    const { loginWithIdToken } = await importAuth();
    mockLoginWithIdToken.mockResolvedValueOnce({
      accessToken: { expiresAt: "2030-01-01T00:00:00Z", token: "tok" },
    });

    const outcome = await loginWithIdToken("TENANT001", idTokenSignIn);

    expect(mockLoginWithIdToken).toHaveBeenCalledWith(
      {
        agreedPageVersionIds: [],
        authorizationCode: "",
        birthDate: "",
        idToken: "header.payload.signature",
        name: "",
        nonce: "nonce-value",
        provider: IdentityProvider.GOOGLE,
        redirectUri: "https://reader.example/api/v1/auth/google/callback",
        tenant: { tenantId: "TENANT001" },
      },
      { headers: { "X-Forwarded-For": "203.0.113.7" } }
    );
    expect(outcome).toEqual({
      kind: "signed_in",
      session: {
        accessToken: "tok",
        expiresAt: new Date("2030-01-01T00:00:00Z"),
      },
    });
  });

  it("loginWithIdToken: reports the consent a first sign-in still needs", async () => {
    const { loginWithIdToken } = await importAuth();
    mockLoginWithIdToken.mockRejectedValueOnce(
      new ConnectError("consent", Code.InvalidArgument, undefined, [
        {
          desc: BadRequestSchema,
          value: { fieldViolations: [{ field: "agreed_page_version_ids" }] },
        },
      ])
    );

    await expect(loginWithIdToken("TENANT001", idTokenSignIn)).resolves.toEqual(
      { kind: "consent_required" }
    );
  });

  it("loginWithIdToken: hands a refusal back for the caller to word", async () => {
    const { loginWithIdToken } = await importAuth();
    const error = new ConnectError("disabled", Code.FailedPrecondition);
    mockLoginWithIdToken.mockRejectedValueOnce(error);

    await expect(loginWithIdToken("TENANT001", idTokenSignIn)).resolves.toEqual(
      { error, kind: "refused" }
    );
  });

  it("loginWithIdToken: unclassifiable errors are propagated", async () => {
    const { loginWithIdToken } = await importAuth();
    mockLoginWithIdToken.mockRejectedValueOnce(
      new ConnectError("boom", Code.Internal)
    );

    await expect(
      loginWithIdToken("TENANT001", idTokenSignIn)
    ).rejects.toMatchObject({ code: Code.Internal });
  });

  it("listMyIdentities: maps the linked providers and whether a password is set", async () => {
    const { listMyIdentities } = await importAuth();
    mockListMyIdentities.mockResolvedValueOnce({
      hasPassword: false,
      identities: [
        {
          email: "reader@example.com",
          linkedAt: "2026-09-01T00:00:00Z",
          provider: IdentityProvider.APPLE,
        },
        {
          email: "unknown@example.com",
          linkedAt: "2026-09-01T00:00:00Z",
          provider: IdentityProvider.UNSPECIFIED,
        },
      ],
    });

    await expect(listMyIdentities("TENANT001")).resolves.toEqual({
      hasPassword: false,
      identities: [
        {
          email: "reader@example.com",
          linkedAt: "2026-09-01T00:00:00Z",
          provider: "apple",
        },
      ],
    });
  });

  it("deleteMe: confirms an account without a password with a fresh sign-in", async () => {
    const { deleteMe } = await importAuth();
    mockDeleteMe.mockResolvedValueOnce({});

    await expect(
      deleteMe("TENANT001", {
        idToken: "header.payload.signature",
        nonce: "nonce-value",
        provider: "apple",
      })
    ).resolves.toBe("deleted");
    expect(mockDeleteMe).toHaveBeenCalledWith(
      {
        idToken: "header.payload.signature",
        nonce: "nonce-value",
        provider: IdentityProvider.APPLE,
        tenant: { tenantId: "TENANT001" },
      },
      { headers: { Authorization: "Bearer sid_001" } }
    );
  });

  it("logoutPublic: accessToken If empty, do not call API", async () => {
    const { logoutPublic } = await importAuth();
    await logoutPublic("   ", "TENANT001");

    expect(mockLogout).not.toHaveBeenCalled();
  });

  it("getPublicCurrentUser: session null if unresolvable", async () => {
    const { getPublicCurrentUser } = await importAuth();
    mockResolveAccessToken.mockResolvedValueOnce("");

    await expect(getPublicCurrentUser("TENANT001")).resolves.toBeNull();
    expect(mockGetMe).not.toHaveBeenCalled();
  });

  it("getPublicCurrentUser: expected error is null", async () => {
    const { getPublicCurrentUser } = await importAuth();
    mockGetMe.mockRejectedValueOnce(
      new ConnectError("forbidden", Code.PermissionDenied)
    );

    await expect(getPublicCurrentUser("TENANT001")).resolves.toBeNull();
  });

  it("getPublicCurrentUser: Uncategorized RPC errors propagate", async () => {
    const { getPublicCurrentUser } = await importAuth();
    mockGetMe.mockRejectedValueOnce(new ConnectError("boom", Code.Internal));

    await expect(getPublicCurrentUser("TENANT001")).rejects.toThrow("boom");
  });

  it("getPublicCurrentUser: Returns user information when normal", async () => {
    const { getPublicCurrentUser } = await importAuth();
    mockGetMe.mockResolvedValueOnce({
      user: { name: "Alice", publicId: "U001" },
    });

    await expect(getPublicCurrentUser("TENANT001")).resolves.toEqual({
      name: "Alice",
      publicId: "U001",
    });
  });

  it("requestPublicEmailChange: false if no session", async () => {
    const { requestPublicEmailChange } = await importAuth();
    mockResolveAccessToken.mockResolvedValueOnce("");

    await expect(
      requestPublicEmailChange(
        "TENANT001",
        "old@example.com",
        "new@example.com",
        { password: "pw" }
      )
    ).resolves.toBe(false);
  });

  it("requestPublicEmailChange: confirms an account without a password with a fresh sign-in", async () => {
    const { requestPublicEmailChange } = await importAuth();
    mockRequestEmailChange.mockResolvedValueOnce({ requested: true });

    await expect(
      requestPublicEmailChange(
        "TENANT001",
        "old@example.com",
        "new@example.com",
        {
          idToken: "header.payload.signature",
          nonce: "nonce-value",
          provider: "google",
        }
      )
    ).resolves.toBe(true);
    expect(mockRequestEmailChange).toHaveBeenCalledWith(
      {
        currentEmail: "old@example.com",
        idToken: "header.payload.signature",
        newEmail: "new@example.com",
        nonce: "nonce-value",
        provider: IdentityProvider.GOOGLE,
        tenant: { tenantId: "TENANT001" },
      },
      { headers: { Authorization: "Bearer sid_001" } }
    );
  });

  it("isSessionRejected: true when the API turns the session away", async () => {
    const { isSessionRejected } = await importAuth();
    mockGetMe.mockRejectedValueOnce(
      new ConnectError("invalid token", Code.Unauthenticated)
    );

    await expect(isSessionRejected("TENANT001")).resolves.toBe(true);
    expect(mockGetMe).toHaveBeenCalledOnce();
  });

  it("isSessionRejected: false when the API still answers for the session", async () => {
    const { isSessionRejected } = await importAuth();
    mockGetMe.mockResolvedValueOnce({ user: { name: "Reader" } });

    await expect(isSessionRejected("TENANT001")).resolves.toBe(false);
  });

  it("isSessionRejected: false without asking when the browser holds no session", async () => {
    const { isSessionRejected } = await importAuth();
    mockResolveAccessToken.mockResolvedValueOnce("");

    await expect(isSessionRejected("TENANT001")).resolves.toBe(false);
    expect(mockGetMe).not.toHaveBeenCalled();
  });

  it("getMe: Unauthenticated cases are propagated to the caller without retrying.", async () => {
    const { getMe } = await importAuth();
    mockGetMe.mockRejectedValueOnce(
      new ConnectError("invalid credentials", Code.Unauthenticated)
    );

    await expect(getMe("TENANT001")).rejects.toMatchObject({
      code: Code.Unauthenticated,
    });
    expect(mockGetMe).toHaveBeenCalledOnce();
  });

  it("getMe: null if followed by expected error", async () => {
    const { getMe } = await importAuth();
    mockGetMe
      .mockRejectedValueOnce(
        new ConnectError("forbidden", Code.PermissionDenied)
      )
      .mockRejectedValueOnce(
        new ConnectError("forbidden", Code.PermissionDenied)
      );

    await expect(getMe("TENANT001")).resolves.toBeNull();
    expect(mockGetMe).toHaveBeenCalledTimes(2);
  });

  it("getMe: Sessions that are not visible to the immediate read will be resolved by retrying.", async () => {
    const { getMe } = await importAuth();
    mockGetMe
      .mockRejectedValueOnce(new ConnectError("not found", Code.NotFound))
      .mockResolvedValueOnce({
        user: {
          birthDate: "1990-04-02",
          email: "alice@example.com",
          name: "Alice",
          publicId: "U001",
          role: "reader",
        },
      });

    await expect(getMe("TENANT001")).resolves.toEqual({
      birthDate: "1990-04-02",
      email: "alice@example.com",
      name: "Alice",
      publicId: "U001",
      role: "reader",
    });
    expect(mockGetMe).toHaveBeenCalledTimes(2);
  });

  it("getMe: Uncategorized RPC errors are propagated without retrying.", async () => {
    const { getMe } = await importAuth();
    const thrown = new ConnectError("boom", Code.Internal);
    mockGetMe.mockRejectedValueOnce(thrown);

    await expect(getMe("TENANT001")).rejects.toBe(thrown);
    expect(mockGetMe).toHaveBeenCalledOnce();
  });

  it("updateMe: expected error is null", async () => {
    const { updateMe } = await importAuth();
    mockUpdateMe.mockRejectedValueOnce(
      new ConnectError("name too long", Code.InvalidArgument)
    );

    await expect(
      updateMe("TENANT001", { birthDate: "", name: "NewName" })
    ).resolves.toBeNull();
  });

  it("deleteMe: Propagate unauthenticated users to prompt them to log in again", async () => {
    const { deleteMe } = await importAuth();
    mockDeleteMe.mockRejectedValueOnce(
      new ConnectError("invalid credentials", Code.Unauthenticated)
    );

    await expect(
      deleteMe("TENANT001", { password: "pw" })
    ).rejects.toMatchObject({
      code: Code.Unauthenticated,
    });
  });

  it("deleteMe: names the refusal of the tenant's last tenant admin", async () => {
    const { deleteMe } = await importAuth();
    mockDeleteMe.mockRejectedValueOnce(
      new ConnectError(
        "last tenant admin",
        Code.FailedPrecondition,
        undefined,
        [
          {
            desc: ErrorInfoSchema,
            value: { domain: "publira", reason: "LAST_TENANT_ADMIN" },
          },
        ]
      )
    );

    await expect(deleteMe("TENANT001", { password: "pw" })).resolves.toBe(
      "last_tenant_admin"
    );
  });

  it("deleteMe: any other refusal fails without a reason", async () => {
    const { deleteMe } = await importAuth();
    mockDeleteMe.mockRejectedValueOnce(
      new ConnectError("invalid password", Code.InvalidArgument)
    );

    await expect(deleteMe("TENANT001", { password: "pw" })).resolves.toBe(
      "failed"
    );
  });

  it("deleteMe: Unclassifiable errors are propagated", async () => {
    const { deleteMe } = await importAuth();
    mockDeleteMe.mockRejectedValueOnce(new Error("network"));

    await expect(deleteMe("TENANT001", { password: "pw" })).rejects.toThrow(
      "network"
    );
  });

  it("getNotificationSettings: null if no session", async () => {
    const { getNotificationSettings } = await importAuth();
    mockResolveAccessToken.mockResolvedValueOnce("");

    await expect(getNotificationSettings("TENANT001")).resolves.toBeNull();
  });
});
