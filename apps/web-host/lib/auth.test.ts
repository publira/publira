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

  it("loginPublic: セッション情報が欠けると null を返す", async () => {
    const { loginPublic } = await importAuth();
    mockLogin.mockResolvedValueOnce({
      accessToken: {},
    });

    await expect(loginPublic("a@b.com", "pw", "TENANT001")).resolves.toBeNull();
  });

  it("loginPublic: expected error は null を返す", async () => {
    const { loginPublic } = await importAuth();
    mockLogin.mockRejectedValueOnce(
      new ConnectError("invalid credentials", Code.Unauthenticated)
    );

    await expect(loginPublic("a@b.com", "pw", "TENANT001")).resolves.toBeNull();
  });

  it("logoutPublic: accessToken 空なら API を呼ばない", async () => {
    const { logoutPublic } = await importAuth();
    await logoutPublic("   ", "TENANT001");

    expect(mockLogout).not.toHaveBeenCalled();
  });

  it("getPublicCurrentUser: session 解決不可なら null", async () => {
    const { getPublicCurrentUser } = await importAuth();
    mockResolveAccessToken.mockResolvedValueOnce("");

    await expect(getPublicCurrentUser("TENANT001")).resolves.toBeNull();
    expect(mockGetMe).not.toHaveBeenCalled();
  });

  it("getPublicCurrentUser: expected error は null", async () => {
    const { getPublicCurrentUser } = await importAuth();
    mockGetMe.mockRejectedValueOnce(
      new ConnectError("forbidden", Code.PermissionDenied)
    );

    await expect(getPublicCurrentUser("TENANT001")).resolves.toBeNull();
  });

  it("getPublicCurrentUser: 分類できない RPC エラーは伝播する", async () => {
    const { getPublicCurrentUser } = await importAuth();
    mockGetMe.mockRejectedValueOnce(new ConnectError("boom", Code.Internal));

    await expect(getPublicCurrentUser("TENANT001")).rejects.toThrow("boom");
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

  it("getMe: 未認証は再試行せず呼び出し元へ伝播する", async () => {
    const { getMe } = await importAuth();
    mockGetMe.mockRejectedValueOnce(
      new ConnectError("invalid credentials", Code.Unauthenticated)
    );

    await expect(getMe("TENANT001")).rejects.toMatchObject({
      code: Code.Unauthenticated,
    });
    expect(mockGetMe).toHaveBeenCalledOnce();
  });

  it("getMe: expected error が続く場合は null", async () => {
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

  it("getMe: 直後の read に見えなかったセッションは再試行で解決する", async () => {
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

  it("getMe: 分類できない RPC エラーは再試行せずそのまま伝播する", async () => {
    const { getMe } = await importAuth();
    mockGetMe.mockRejectedValueOnce(new ConnectError("boom", Code.Internal));

    await expect(getMe("TENANT001")).rejects.toMatchObject({
      code: Code.Internal,
      message: "[internal] boom",
    });
    expect(mockGetMe).toHaveBeenCalledOnce();
  });

  it("updateMe: expected error は null", async () => {
    const { updateMe } = await importAuth();
    mockUpdateMe.mockRejectedValueOnce(
      new ConnectError("name too long", Code.InvalidArgument)
    );

    await expect(updateMe("TENANT001", "NewName")).resolves.toBeNull();
  });

  it("deleteMe: 未認証は再ログインへ誘導できるよう伝播する", async () => {
    const { deleteMe } = await importAuth();
    mockDeleteMe.mockRejectedValueOnce(
      new ConnectError("invalid credentials", Code.Unauthenticated)
    );

    await expect(deleteMe("TENANT001", "pw")).rejects.toMatchObject({
      code: Code.Unauthenticated,
    });
  });

  it("deleteMe: 分類できないエラーは伝播する", async () => {
    const { deleteMe } = await importAuth();
    mockDeleteMe.mockRejectedValueOnce(new Error("network"));

    await expect(deleteMe("TENANT001", "pw")).rejects.toThrow("network");
  });

  it("getNotificationSettings: session 無しなら null", async () => {
    const { getNotificationSettings } = await importAuth();
    mockResolveAccessToken.mockResolvedValueOnce("");

    await expect(getNotificationSettings("TENANT001")).resolves.toBeNull();
  });
});
