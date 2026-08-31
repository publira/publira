import { Code, ConnectError } from "@publira/api-client/errors";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockLogin,
  mockDeleteMe,
  mockLogout,
  mockGetMe,
  mockGetNotificationSettings,
  mockRequestEmailChange,
  mockResolveAccessToken,
  mockUpdateMe,
} = vi.hoisted(() => ({
  mockDeleteMe: vi.fn(),
  mockGetMe: vi.fn(),
  mockGetNotificationSettings: vi.fn(),
  mockLogin: vi.fn(),
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
      login: mockLogin,
      logout: mockLogout,
      requestEmailChange: mockRequestEmailChange,
      updateMe: mockUpdateMe,
    },
  },
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
        "pw"
      )
    ).resolves.toBe(false);
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
        user: { name: "Alice", publicId: "U001", role: "reader" },
      });

    await expect(getMe("TENANT001")).resolves.toEqual({
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

    await expect(updateMe("TENANT001", "NewName")).resolves.toBeNull();
  });

  it("deleteMe: Propagate unauthenticated users to prompt them to log in again", async () => {
    const { deleteMe } = await importAuth();
    mockDeleteMe.mockRejectedValueOnce(
      new ConnectError("invalid credentials", Code.Unauthenticated)
    );

    await expect(deleteMe("TENANT001", "pw")).rejects.toMatchObject({
      code: Code.Unauthenticated,
    });
  });

  it("deleteMe: Unclassifiable errors are propagated", async () => {
    const { deleteMe } = await importAuth();
    mockDeleteMe.mockRejectedValueOnce(new Error("network"));

    await expect(deleteMe("TENANT001", "pw")).rejects.toThrow("network");
  });

  it("getNotificationSettings: null if no session", async () => {
    const { getNotificationSettings } = await importAuth();
    mockResolveAccessToken.mockResolvedValueOnce("");

    await expect(getNotificationSettings("TENANT001")).resolves.toBeNull();
  });
});
