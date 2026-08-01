import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockLogin,
  mockDeleteMe,
  mockLogout,
  mockGetMe,
  mockGetNotificationSettings,
  mockRequestEmailChange,
  mockResolveSessionId,
  mockUpdateMe,
} = vi.hoisted(() => ({
  mockDeleteMe: vi.fn(),
  mockGetMe: vi.fn(),
  mockGetNotificationSettings: vi.fn(),
  mockLogin: vi.fn(),
  mockLogout: vi.fn(),
  mockRequestEmailChange: vi.fn(),
  mockResolveSessionId: vi.fn(),
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
  resolveSessionId: mockResolveSessionId,
}));

const importAuth = () => import("./auth");

describe("web-host auth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveSessionId.mockResolvedValue("sid_001");
  });

  it("loginPublic: セッション情報が欠けると null を返す", async () => {
    const { loginPublic } = await importAuth();
    mockLogin.mockResolvedValueOnce({
      accessToken: {},
    });

    await expect(loginPublic("a@b.com", "pw", "TENANT001")).resolves.toBeNull();
  });

  it("loginPublic: expected error は null を返す", async () => {
    const { loginPublic } = await importAuth();
    mockLogin.mockRejectedValueOnce(new Error("unauthenticated"));

    await expect(loginPublic("a@b.com", "pw", "TENANT001")).resolves.toBeNull();
  });

  it("logoutPublic: sessionId 空なら API を呼ばない", async () => {
    const { logoutPublic } = await importAuth();
    await logoutPublic("   ", "TENANT001");

    expect(mockLogout).not.toHaveBeenCalled();
  });

  it("getPublicCurrentUser: session 解決不可なら null", async () => {
    const { getPublicCurrentUser } = await importAuth();
    mockResolveSessionId.mockResolvedValueOnce("");

    await expect(getPublicCurrentUser("TENANT001")).resolves.toBeNull();
    expect(mockGetMe).not.toHaveBeenCalled();
  });

  it("getPublicCurrentUser: expected error は null", async () => {
    const { getPublicCurrentUser } = await importAuth();
    mockGetMe.mockRejectedValueOnce(new Error("permission_denied"));

    await expect(getPublicCurrentUser("TENANT001")).resolves.toBeNull();
  });

  it("getPublicCurrentUser: 正常時はユーザー情報を返す", async () => {
    const { getPublicCurrentUser } = await importAuth();
    mockGetMe.mockResolvedValueOnce({
      user: { name: "Alice", publicId: "U001" },
    });

    await expect(getPublicCurrentUser("TENANT001")).resolves.toEqual({
      name: "Alice",
      publicId: "U001",
    });
  });

  it("requestPublicEmailChange: session が無ければ false", async () => {
    const { requestPublicEmailChange } = await importAuth();
    mockResolveSessionId.mockResolvedValueOnce("");

    await expect(
      requestPublicEmailChange(
        "TENANT001",
        "old@example.com",
        "new@example.com",
        "pw"
      )
    ).resolves.toBe(false);
  });

  it("getMe: expected error 後の2回目成功でユーザーを返す", async () => {
    const { getMe } = await importAuth();
    mockGetMe
      .mockRejectedValueOnce(new Error("unauthenticated"))
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

  it("getMe: expected error が続く場合は null", async () => {
    const { getMe } = await importAuth();
    mockGetMe
      .mockRejectedValueOnce(new Error("permission_denied"))
      .mockRejectedValueOnce(new Error("permission_denied"));

    await expect(getMe("TENANT001")).resolves.toBeNull();
  });

  it("updateMe: expected error は null", async () => {
    const { updateMe } = await importAuth();
    mockUpdateMe.mockRejectedValueOnce(new Error("invalid_argument"));

    await expect(updateMe("TENANT001", "NewName")).resolves.toBeNull();
  });

  it("deleteMe: API 失敗時は false", async () => {
    const { deleteMe } = await importAuth();
    mockDeleteMe.mockRejectedValueOnce(new Error("network"));

    await expect(deleteMe("TENANT001", "pw")).resolves.toBe(false);
  });

  it("getNotificationSettings: session 無しなら null", async () => {
    const { getNotificationSettings } = await importAuth();
    mockResolveSessionId.mockResolvedValueOnce("");

    await expect(getNotificationSettings("TENANT001")).resolves.toBeNull();
  });
});
