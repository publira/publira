import {
  BadRequestSchema,
  Code,
  ConnectError,
  ErrorInfoSchema,
} from "@publira/api-client/errors";
import { IdentityProvider } from "@publira/api-client/public/auth";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockBeginPasskeyLogin,
  mockCacheLife,
  mockCacheTag,
  mockConfirmEmailChange,
  mockCreateUser,
  mockFinishPasskeyLogin,
  mockLogin,
  mockDeleteMe,
  mockDeleteMyIcon,
  mockLogout,
  mockGetMe,
  mockGetNotificationSettings,
  mockLinkIdentity,
  mockListMyIdentities,
  mockLoginWithIdToken,
  mockRequestEmailChange,
  mockResolveAccessToken,
  mockSelectMyIcon,
  mockUpdateMe,
  mockUploadMyIcon,
  mockVerifyUserEmail,
} = vi.hoisted(() => ({
  mockBeginPasskeyLogin: vi.fn(),
  mockCacheLife: vi.fn(),
  mockCacheTag: vi.fn(),
  mockConfirmEmailChange: vi.fn(),
  mockCreateUser: vi.fn(),
  mockDeleteMe: vi.fn(),
  mockDeleteMyIcon: vi.fn(),
  mockFinishPasskeyLogin: vi.fn(),
  mockGetMe: vi.fn(),
  mockGetNotificationSettings: vi.fn(),
  mockLinkIdentity: vi.fn(),
  mockListMyIdentities: vi.fn(),
  mockLogin: vi.fn(),
  mockLoginWithIdToken: vi.fn(),
  mockLogout: vi.fn(),
  mockRequestEmailChange: vi.fn(),
  mockResolveAccessToken: vi.fn(),
  mockSelectMyIcon: vi.fn(),
  mockUpdateMe: vi.fn(),
  mockUploadMyIcon: vi.fn(),
  mockVerifyUserEmail: vi.fn(),
}));

// The token-spending calls run without the Next.js cache runtime here, so the
// `"use cache: private"` helpers are stubbed rather than exercised.
vi.mock("next/cache", () => ({
  cacheLife: mockCacheLife,
  cacheTag: mockCacheTag,
}));

vi.mock("./api-client", () => ({
  apiClient: {
    auth: {
      beginPasskeyLogin: mockBeginPasskeyLogin,
      confirmEmailChange: mockConfirmEmailChange,
      createUser: mockCreateUser,
      deleteMe: mockDeleteMe,
      deleteMyIcon: mockDeleteMyIcon,
      finishPasskeyLogin: mockFinishPasskeyLogin,
      getMe: mockGetMe,
      getNotificationSettings: mockGetNotificationSettings,
      linkIdentity: mockLinkIdentity,
      listMyIdentities: mockListMyIdentities,
      login: mockLogin,
      loginWithIdToken: mockLoginWithIdToken,
      logout: mockLogout,
      requestEmailChange: mockRequestEmailChange,
      selectMyIcon: mockSelectMyIcon,
      updateMe: mockUpdateMe,
      uploadMyIcon: mockUploadMyIcon,
      verifyUserEmail: mockVerifyUserEmail,
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

const DROPPED_ENTRY = { expire: 0, revalidate: 0, stale: 0 };

const ICON_URL = "/images/users/U001/icon/original.png";

/** An account as the API answers it once an icon is set. */
const ICON_USER = {
  birthDate: "",
  email: "alice@example.com",
  iconImageVariants: [
    {
      contentType: "image/png",
      fileSizeBytes: 2048n,
      height: 512,
      label: "original",
      url: ICON_URL,
      width: 512,
    },
  ],
  name: "Alice",
  publicId: "U001",
  role: "reader",
};

describe("web-storefront auth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveAccessToken.mockResolvedValue("sid_001");
  });

  it("loginPublic: Refuses the credentials if session information is missing", async () => {
    const { loginPublic } = await importAuth();
    mockLogin.mockResolvedValueOnce({
      accessToken: {},
    });

    await expect(loginPublic("a@b.com", "pw", "TENANT001")).resolves.toEqual({
      ok: false,
      refusal: "credentials",
    });
  });

  it("loginPublic: Refuses the credentials on a wrong email or password", async () => {
    const { loginPublic } = await importAuth();
    mockLogin.mockRejectedValueOnce(
      new ConnectError("invalid credentials", Code.Unauthenticated)
    );

    await expect(loginPublic("a@b.com", "pw", "TENANT001")).resolves.toEqual({
      ok: false,
      refusal: "credentials",
    });
  });

  it("loginPublic: Reports too many attempts apart from wrong credentials", async () => {
    const { loginPublic } = await importAuth();
    mockLogin.mockRejectedValueOnce(
      new ConnectError("rate limited", Code.ResourceExhausted)
    );

    await expect(loginPublic("a@b.com", "pw", "TENANT001")).resolves.toEqual({
      ok: false,
      refusal: "rate-limited",
    });
  });

  it("loginPublic: Answers the session the API issued", async () => {
    const { loginPublic } = await importAuth();
    mockLogin.mockResolvedValueOnce({
      accessToken: { expiresAt: "2030-01-01T00:00:00Z", token: "tok" },
    });

    await expect(loginPublic("a@b.com", "pw", "TENANT001")).resolves.toEqual({
      ok: true,
      session: {
        accessToken: "tok",
        expiresAt: new Date("2030-01-01T00:00:00Z"),
      },
    });
  });

  it("beginPasskeyLoginPublic: answers the options, asked for from the reader's address", async () => {
    const { beginPasskeyLoginPublic } = await importAuth();
    mockBeginPasskeyLogin.mockResolvedValueOnce({
      requestOptionsJson: '{"challenge":"abc"}',
    });

    await expect(beginPasskeyLoginPublic("TENANT001")).resolves.toEqual({
      ok: true,
      optionsJson: '{"challenge":"abc"}',
    });
    expect(mockBeginPasskeyLogin).toHaveBeenCalledWith(
      { tenant: { tenantId: "TENANT001" } },
      { headers: { "X-Forwarded-For": "203.0.113.7" } }
    );
  });

  it("beginPasskeyLoginPublic: reports too many attempts", async () => {
    const { beginPasskeyLoginPublic } = await importAuth();
    mockBeginPasskeyLogin.mockRejectedValueOnce(
      new ConnectError("rate limited", Code.ResourceExhausted)
    );

    await expect(beginPasskeyLoginPublic("TENANT001")).resolves.toEqual({
      ok: false,
      refusal: "rate-limited",
    });
  });

  it("beginPasskeyLoginPublic: lets a failure it cannot explain through", async () => {
    const { beginPasskeyLoginPublic } = await importAuth();
    const failure = new ConnectError("boom", Code.Internal);
    mockBeginPasskeyLogin.mockRejectedValueOnce(failure);

    await expect(beginPasskeyLoginPublic("TENANT001")).rejects.toBe(failure);
  });

  it("finishPasskeyLoginPublic: answers the session the API issued", async () => {
    const { finishPasskeyLoginPublic } = await importAuth();
    mockFinishPasskeyLogin.mockResolvedValueOnce({
      accessToken: { expiresAt: "2030-01-01T00:00:00Z", token: "tok" },
    });

    await expect(
      finishPasskeyLoginPublic("TENANT001", '{"id":"cred"}')
    ).resolves.toEqual({
      ok: true,
      session: {
        accessToken: "tok",
        expiresAt: new Date("2030-01-01T00:00:00Z"),
      },
    });
    expect(mockFinishPasskeyLogin).toHaveBeenCalledWith(
      { credentialJson: '{"id":"cred"}', tenant: { tenantId: "TENANT001" } },
      { headers: { "X-Forwarded-For": "203.0.113.7" } }
    );
  });

  it.each([
    ["an assertion the API does not accept", Code.Unauthenticated],
    ["an account that cannot sign in", Code.FailedPrecondition],
  ])("finishPasskeyLoginPublic: refuses %s", async (_case, code) => {
    const { finishPasskeyLoginPublic } = await importAuth();
    mockFinishPasskeyLogin.mockRejectedValueOnce(new ConnectError("no", code));

    await expect(
      finishPasskeyLoginPublic("TENANT001", '{"id":"cred"}')
    ).resolves.toEqual({ ok: false, refusal: "refused" });
  });

  it("finishPasskeyLoginPublic: refuses an answer without a session", async () => {
    const { finishPasskeyLoginPublic } = await importAuth();
    mockFinishPasskeyLogin.mockResolvedValueOnce({ accessToken: {} });

    await expect(
      finishPasskeyLoginPublic("TENANT001", '{"id":"cred"}')
    ).resolves.toEqual({ ok: false, refusal: "refused" });
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

  it("linkMyIdentity: links the provider account of the fresh sign-in to the session's", async () => {
    const { linkMyIdentity } = await importAuth();
    mockLinkIdentity.mockResolvedValueOnce({});

    await expect(
      linkMyIdentity("TENANT001", {
        authorizationCode: "apple-code",
        idToken: "header.payload.signature",
        nonce: "nonce-value",
        provider: "apple",
        redirectUri: "https://reader.example/api/v1/auth/apple/callback",
      })
    ).resolves.toEqual({ kind: "linked" });
    expect(mockLinkIdentity).toHaveBeenCalledWith(
      {
        authorizationCode: "apple-code",
        idToken: "header.payload.signature",
        nonce: "nonce-value",
        provider: IdentityProvider.APPLE,
        redirectUri: "https://reader.example/api/v1/auth/apple/callback",
        tenant: { tenantId: "TENANT001" },
      },
      { headers: { Authorization: "Bearer sid_001" } }
    );
  });

  it.each([
    ["IDENTITY_LINKED_TO_ANOTHER_ACCOUNT", "linked_to_another_account"],
    ["PROVIDER_ALREADY_LINKED", "provider_already_linked"],
  ])("linkMyIdentity: names the %s refusal", async (reason, kind) => {
    const { linkMyIdentity } = await importAuth();
    mockLinkIdentity.mockRejectedValueOnce(
      new ConnectError("refused", Code.FailedPrecondition, undefined, [
        { desc: ErrorInfoSchema, value: { domain: "publira", reason } },
      ])
    );

    await expect(
      linkMyIdentity("TENANT001", {
        authorizationCode: "",
        idToken: "header.payload.signature",
        nonce: "nonce-value",
        provider: "google",
        redirectUri: "https://reader.example/api/v1/auth/google/callback",
      })
    ).resolves.toEqual({ kind });
  });

  it("linkMyIdentity: hands any other refusal back for the caller to word", async () => {
    const { linkMyIdentity } = await importAuth();
    const error = new ConnectError("invalid ID token", Code.InvalidArgument);
    mockLinkIdentity.mockRejectedValueOnce(error);

    await expect(
      linkMyIdentity("TENANT001", {
        authorizationCode: "",
        idToken: "header.payload.signature",
        nonce: "nonce-value",
        provider: "google",
        redirectUri: "https://reader.example/api/v1/auth/google/callback",
      })
    ).resolves.toEqual({ error, kind: "refused" });
  });

  it("linkMyIdentity: propagates an ended session for the caller to sign the reader in again", async () => {
    const { linkMyIdentity } = await importAuth();
    mockLinkIdentity.mockRejectedValueOnce(
      new ConnectError("session ended", Code.Unauthenticated)
    );

    await expect(
      linkMyIdentity("TENANT001", {
        authorizationCode: "",
        idToken: "header.payload.signature",
        nonce: "nonce-value",
        provider: "google",
        redirectUri: "https://reader.example/api/v1/auth/google/callback",
      })
    ).rejects.toThrow("session ended");
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

  it("signupPublic: answers a taken request as accepted", async () => {
    const { signupPublic } = await importAuth();
    mockCreateUser.mockResolvedValueOnce({ accepted: true });

    await expect(
      signupPublic({
        agreedPageVersionIds: [],
        birthDate: "",
        email: "reader@example.com",
        name: "Reader",
        password: "pw",
        tenantId: "TENANT001",
      })
    ).resolves.toEqual({ ok: true });
  });

  it.each([
    ["EMAIL_DISPOSABLE_DOMAIN", "disposable_domain"],
    ["EMAIL_REFUSED", "refused"],
  ] as const)(
    "signupPublic: reports an address the tenant refuses (%s)",
    async (reason, emailRefusal) => {
      const { signupPublic } = await importAuth();
      mockCreateUser.mockRejectedValueOnce(
        new ConnectError("refused", Code.InvalidArgument, undefined, [
          {
            desc: BadRequestSchema,
            value: { fieldViolations: [{ field: "email", reason }] },
          },
        ])
      );

      await expect(
        signupPublic({
          agreedPageVersionIds: [],
          birthDate: "",
          email: "reader@throwaway.example",
          name: "Reader",
          password: "pw",
          tenantId: "TENANT001",
        })
      ).resolves.toEqual({ emailRefusal, ok: false });
    }
  );

  it("signupPublic: names no refusal for another invalid field", async () => {
    const { signupPublic } = await importAuth();
    mockCreateUser.mockRejectedValueOnce(
      new ConnectError("weak", Code.InvalidArgument, undefined, [
        {
          desc: BadRequestSchema,
          value: { fieldViolations: [{ field: "password" }] },
        },
      ])
    );

    await expect(
      signupPublic({
        agreedPageVersionIds: [],
        birthDate: "",
        email: "reader@example.com",
        name: "Reader",
        password: "pw",
        tenantId: "TENANT001",
      })
    ).resolves.toEqual({ emailRefusal: undefined, ok: false });
  });

  it("requestPublicEmailChange: reports a new address the tenant refuses", async () => {
    const { requestPublicEmailChange } = await importAuth();
    mockRequestEmailChange.mockRejectedValueOnce(
      new ConnectError("refused", Code.InvalidArgument, undefined, [
        {
          desc: BadRequestSchema,
          value: {
            fieldViolations: [
              { field: "new_email", reason: "EMAIL_DISPOSABLE_DOMAIN" },
            ],
          },
        },
      ])
    );

    await expect(
      requestPublicEmailChange(
        "TENANT001",
        "old@example.com",
        "new@throwaway.example",
        { password: "pw" }
      )
    ).resolves.toEqual({ emailRefusal: "disposable_domain", ok: false });
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
    ).resolves.toEqual({ ok: false });
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
    ).resolves.toEqual({ ok: true });
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
    mockGetMe.mockResolvedValueOnce({
      user: { iconImageVariants: [], name: "Reader" },
    });

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
          iconImageVariants: [],
          name: "Alice",
          publicId: "U001",
          role: "reader",
        },
      });

    await expect(getMe("TENANT001")).resolves.toEqual({
      birthDate: "1990-04-02",
      email: "alice@example.com",
      icon: null,
      iconPresetId: null,
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

  it("getMe: carries the icon the account shows", async () => {
    const { getMe } = await importAuth();
    mockGetMe.mockResolvedValueOnce({ user: ICON_USER });

    await expect(getMe("TENANT001")).resolves.toMatchObject({
      icon: { height: 512, url: ICON_URL, width: 512 },
    });
  });

  it("getMyAccount: reads the account under the tag the account Actions refresh", async () => {
    const { getMyAccount } = await importAuth();
    mockGetMe.mockResolvedValueOnce({ user: ICON_USER });

    await expect(getMyAccount("TENANT001")).resolves.toMatchObject({
      icon: { url: ICON_URL },
      name: "Alice",
    });
    expect(mockCacheTag).toHaveBeenCalledWith("tenant:TENANT001:account");
  });

  it("getMyAccount: null without asking when the browser holds no session", async () => {
    const { getMyAccount } = await importAuth();
    mockResolveAccessToken.mockResolvedValueOnce("");

    await expect(getMyAccount("TENANT001")).resolves.toBeNull();
    expect(mockGetMe).not.toHaveBeenCalled();
  });

  it("getMyAccount: null for a session the API turns away, kept out of the cache", async () => {
    const { getMyAccount } = await importAuth();
    mockGetMe.mockRejectedValueOnce(
      new ConnectError("expired", Code.Unauthenticated)
    );

    await expect(getMyAccount("TENANT001")).resolves.toBeNull();
    expect(mockCacheLife).toHaveBeenCalledWith(DROPPED_ENTRY);
  });

  it("getMyAccount: throws outside the cached read for an unclassified failure", async () => {
    const { getMyAccount } = await importAuth();
    mockGetMe.mockRejectedValueOnce(new ConnectError("boom", Code.Internal));

    await expect(getMyAccount("TENANT001")).rejects.toThrow(
      "The account could not be read."
    );
    expect(mockCacheLife).toHaveBeenCalledWith(DROPPED_ENTRY);
  });

  it("uploadMyIcon: sends the image and answers the account with its new icon", async () => {
    const { uploadMyIcon } = await importAuth();
    mockUploadMyIcon.mockResolvedValueOnce({ user: ICON_USER });
    const data = new Uint8Array([1, 2, 3]);

    await expect(
      uploadMyIcon("TENANT001", { contentType: "image/png", data })
    ).resolves.toMatchObject({
      me: { icon: { url: ICON_URL } },
      ok: true,
    });
    expect(mockUploadMyIcon).toHaveBeenCalledWith(
      {
        iconContentType: "image/png",
        iconData: data,
        tenant: { tenantId: "TENANT001" },
      },
      { headers: { Authorization: "Bearer sid_001" } }
    );
  });

  it.each([
    ["icon_data", "image"],
    ["icon_crop", "image"],
  ] as const)(
    "uploadMyIcon: names an image the API refuses (%s)",
    async (field, refusal) => {
      const { uploadMyIcon } = await importAuth();
      mockUploadMyIcon.mockRejectedValueOnce(
        new ConnectError("refused", Code.InvalidArgument, undefined, [
          { desc: BadRequestSchema, value: { fieldViolations: [{ field }] } },
        ])
      );

      await expect(
        uploadMyIcon("TENANT001", {
          contentType: "image/png",
          data: new Uint8Array([1]),
        })
      ).resolves.toEqual({ ok: false, refusal });
    }
  );

  it("uploadMyIcon: names an install with no object store", async () => {
    const { uploadMyIcon } = await importAuth();
    mockUploadMyIcon.mockRejectedValueOnce(
      new ConnectError("storage", Code.FailedPrecondition, undefined, [
        {
          desc: ErrorInfoSchema,
          value: { domain: "publira", reason: "STORAGE_NOT_CONFIGURED" },
        },
      ])
    );

    await expect(
      uploadMyIcon("TENANT001", {
        contentType: "image/png",
        data: new Uint8Array([1]),
      })
    ).resolves.toEqual({ ok: false, refusal: "storage-not-configured" });
  });

  it("uploadMyIcon: hands any other refusal back by its disposition", async () => {
    const { uploadMyIcon } = await importAuth();
    mockUploadMyIcon.mockRejectedValueOnce(
      new ConnectError("slow down", Code.ResourceExhausted)
    );

    await expect(
      uploadMyIcon("TENANT001", {
        contentType: "image/png",
        data: new Uint8Array([1]),
      })
    ).resolves.toEqual({ ok: false, refusal: "rate-limited" });
  });

  it("uploadMyIcon: lets an unclassified failure reach the error boundary", async () => {
    const { uploadMyIcon } = await importAuth();
    const thrown = new ConnectError("boom", Code.Internal);
    mockUploadMyIcon.mockRejectedValueOnce(thrown);

    await expect(
      uploadMyIcon("TENANT001", {
        contentType: "image/png",
        data: new Uint8Array([1]),
      })
    ).rejects.toBe(thrown);
  });

  it("uploadMyIcon: refuses without asking when the browser holds no session", async () => {
    const { uploadMyIcon } = await importAuth();
    mockResolveAccessToken.mockResolvedValueOnce("");

    await expect(
      uploadMyIcon("TENANT001", {
        contentType: "image/png",
        data: new Uint8Array([1]),
      })
    ).resolves.toEqual({ ok: false, refusal: "unauthenticated" });
    expect(mockUploadMyIcon).not.toHaveBeenCalled();
  });

  it("uploadMyIcon: names a change the tenant's icon policy no longer allows", async () => {
    const { uploadMyIcon } = await importAuth();
    mockUploadMyIcon.mockRejectedValueOnce(
      new ConnectError("not allowed", Code.FailedPrecondition, undefined, [
        {
          desc: ErrorInfoSchema,
          value: { domain: "publira", reason: "READER_ICON_NOT_ALLOWED" },
        },
      ])
    );

    await expect(
      uploadMyIcon("TENANT001", {
        contentType: "image/png",
        data: new Uint8Array([1]),
      })
    ).resolves.toEqual({ ok: false, refusal: "not-allowed" });
  });

  it("selectMyIcon: sends the preset and answers the account showing it", async () => {
    const { selectMyIcon } = await importAuth();
    mockSelectMyIcon.mockResolvedValueOnce({
      user: { ...ICON_USER, iconPresetId: "PRESET_001" },
    });

    await expect(
      selectMyIcon("TENANT001", "PRESET_001")
    ).resolves.toMatchObject({
      me: { icon: { url: ICON_URL }, iconPresetId: "PRESET_001" },
      ok: true,
    });
    expect(mockSelectMyIcon).toHaveBeenCalledWith(
      { presetId: "PRESET_001", tenant: { tenantId: "TENANT001" } },
      { headers: { Authorization: "Bearer sid_001" } }
    );
  });

  it("selectMyIcon: hands a preset that is gone back by its disposition", async () => {
    const { selectMyIcon } = await importAuth();
    mockSelectMyIcon.mockRejectedValueOnce(
      new ConnectError("gone", Code.NotFound)
    );

    await expect(selectMyIcon("TENANT001", "PRESET_001")).resolves.toEqual({
      ok: false,
      refusal: "not-found",
    });
  });

  it("selectMyIcon: refuses without asking when the browser holds no session", async () => {
    const { selectMyIcon } = await importAuth();
    mockResolveAccessToken.mockResolvedValueOnce("");

    await expect(selectMyIcon("TENANT001", "PRESET_001")).resolves.toEqual({
      ok: false,
      refusal: "unauthenticated",
    });
    expect(mockSelectMyIcon).not.toHaveBeenCalled();
  });

  it("deleteMyIcon: answers the account with no icon", async () => {
    const { deleteMyIcon } = await importAuth();
    mockDeleteMyIcon.mockResolvedValueOnce({
      user: { ...ICON_USER, iconImageVariants: [] },
    });

    await expect(deleteMyIcon("TENANT001")).resolves.toMatchObject({
      me: { icon: null },
      ok: true,
    });
    expect(mockDeleteMyIcon).toHaveBeenCalledWith(
      { tenant: { tenantId: "TENANT001" } },
      { headers: { Authorization: "Bearer sid_001" } }
    );
  });

  it("deleteMyIcon: hands an expired session back as a refusal", async () => {
    const { deleteMyIcon } = await importAuth();
    mockDeleteMyIcon.mockRejectedValueOnce(
      new ConnectError("expired", Code.Unauthenticated)
    );

    await expect(deleteMyIcon("TENANT001")).resolves.toEqual({
      ok: false,
      refusal: "unauthenticated",
    });
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

  it("verifyPublicEmail: returns the API's answer, kept out of prefetches", async () => {
    const { verifyPublicEmail } = await importAuth();
    mockVerifyUserEmail.mockResolvedValueOnce({ verified: true });

    await expect(verifyPublicEmail("token_abc", "TENANT001")).resolves.toBe(
      true
    );
    expect(mockVerifyUserEmail).toHaveBeenCalledWith({
      tenant: { tenantId: "TENANT001" },
      token: "token_abc",
    });
    expect(mockCacheLife).toHaveBeenCalledWith({ stale: 0 });
    expect(mockCacheTag).toHaveBeenCalledWith(
      "tenant:TENANT001:email-verification"
    );
    expect(mockCacheLife).not.toHaveBeenCalledWith(DROPPED_ENTRY);
  });

  it("verifyPublicEmail: answers false and drops the entry when the API refuses the token", async () => {
    const { verifyPublicEmail } = await importAuth();
    mockVerifyUserEmail.mockRejectedValueOnce(
      new ConnectError("expired", Code.InvalidArgument)
    );

    await expect(verifyPublicEmail("token_abc", "TENANT001")).resolves.toBe(
      false
    );
    expect(mockCacheLife).toHaveBeenCalledWith(DROPPED_ENTRY);
  });

  it("verifyPublicEmail: throws an unexpected failure outside the cache scope, with the entry dropped", async () => {
    const { verifyPublicEmail } = await importAuth();
    mockVerifyUserEmail.mockRejectedValueOnce(
      new ConnectError("boom", Code.Internal)
    );

    await expect(verifyPublicEmail("token_abc", "TENANT001")).rejects.toThrow(
      "The email verification failed unexpectedly."
    );
    expect(mockCacheLife).toHaveBeenCalledWith(DROPPED_ENTRY);
  });

  it("confirmPublicEmailChange: returns the API's answer, kept out of prefetches", async () => {
    const { confirmPublicEmailChange } = await importAuth();
    mockConfirmEmailChange.mockResolvedValueOnce({
      changed: false,
      confirmed: true,
      pendingConfirmationFor: "new_email",
    });

    await expect(
      confirmPublicEmailChange("token_abc", "TENANT001")
    ).resolves.toEqual({
      changed: false,
      confirmed: true,
      pendingConfirmationFor: "new_email",
    });
    expect(mockConfirmEmailChange).toHaveBeenCalledWith(
      { tenant: { tenantId: "TENANT001" }, token: "token_abc" },
      { headers: { "X-Forwarded-For": "203.0.113.7" } }
    );
    expect(mockCacheLife).toHaveBeenCalledWith({ stale: 0 });
    expect(mockCacheTag).toHaveBeenCalledWith(
      "tenant:TENANT001:email-change-confirmation"
    );
    expect(mockCacheLife).not.toHaveBeenCalledWith(DROPPED_ENTRY);
  });

  it("confirmPublicEmailChange: answers null and drops the entry when the API refuses the token", async () => {
    const { confirmPublicEmailChange } = await importAuth();
    mockConfirmEmailChange.mockRejectedValueOnce(
      new ConnectError("expired", Code.InvalidArgument)
    );

    await expect(
      confirmPublicEmailChange("token_abc", "TENANT001")
    ).resolves.toBeNull();
    expect(mockCacheLife).toHaveBeenCalledWith(DROPPED_ENTRY);
  });

  it("confirmPublicEmailChange: throws a failure the reader cannot act on outside the cache scope, with the entry dropped", async () => {
    const { confirmPublicEmailChange } = await importAuth();
    mockConfirmEmailChange.mockRejectedValueOnce(
      new ConnectError("down", Code.Unavailable)
    );

    await expect(
      confirmPublicEmailChange("token_abc", "TENANT001")
    ).rejects.toThrow("The email change confirmation failed unexpectedly.");
    expect(mockCacheLife).toHaveBeenCalledWith(DROPPED_ENTRY);
  });
});
