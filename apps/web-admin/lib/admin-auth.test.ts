import { beforeEach, describe, expect, it, vi } from "vitest";

import { getAdminCurrentUser, isAdminSessionValid } from "./admin-auth";

const { mockGetMe, mockGetSessionId } = vi.hoisted(() => ({
  mockGetMe: vi.fn(),
  mockGetSessionId: vi.fn(),
}));

vi.mock("./session", () => ({
  getSessionId: mockGetSessionId,
}));

vi.mock("@publira/api-client/admin/client", () => ({
  createAdminApiClient: () => ({
    auth: {
      createSession: vi.fn(),
      deleteSession: vi.fn(),
      getMe: mockGetMe,
    },
  }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockGetSessionId.mockResolvedValue("valid-token");
});

describe("getAdminCurrentUser", () => {
  it("空の sessionId に対して null を返す", async () => {
    mockGetSessionId.mockResolvedValueOnce("");
    const result = await getAdminCurrentUser("tenant_001");
    expect(result).toBeNull();
    expect(mockGetMe).not.toHaveBeenCalled();
  });

  it("空白のみの sessionId に対して null を返す", async () => {
    // getSessionId は常にトリム済みの値を返すため、空白のみのケースは空文字と同等
    mockGetSessionId.mockResolvedValueOnce("");
    const result = await getAdminCurrentUser("tenant_001");
    expect(result).toBeNull();
    expect(mockGetMe).not.toHaveBeenCalled();
  });

  it("API が user を返さない場合に null を返す", async () => {
    mockGetMe.mockResolvedValueOnce({});
    const result = await getAdminCurrentUser("tenant_001");
    expect(result).toBeNull();
  });

  it("API が publicId 空の user を返した場合に null を返す", async () => {
    mockGetMe.mockResolvedValueOnce({
      user: { name: "テスト", publicId: "", role: "admin" },
    });
    const result = await getAdminCurrentUser("tenant_001");
    expect(result).toBeNull();
  });

  it("有効なレスポンスからユーザー情報を返す", async () => {
    mockGetMe.mockResolvedValueOnce({
      user: { name: "山田太郎", publicId: "user-001", role: "admin" },
    });
    const result = await getAdminCurrentUser("tenant_001");
    expect(result).toEqual({
      name: "山田太郎",
      publicId: "user-001",
      role: "admin",
    });
  });

  it("getSessionId が返したセッション ID をそのまま API に渡す", async () => {
    mockGetSessionId.mockResolvedValueOnce("valid-token");
    mockGetMe.mockResolvedValueOnce({
      user: { name: "テスト", publicId: "user-001", role: "admin" },
    });
    await getAdminCurrentUser("tenant_001");
    expect(mockGetMe).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "valid-token",
        tenant: { tenantPublicId: "tenant_001" },
      })
    );
  });

  it("API がエラーをスローした場合に null を返す", async () => {
    mockGetMe.mockRejectedValueOnce(new Error("Network error"));
    const result = await getAdminCurrentUser("tenant_001");
    expect(result).toBeNull();
  });

  it("name と role が空文字の場合も publicId があれば返す", async () => {
    mockGetMe.mockResolvedValueOnce({
      user: { name: "  ", publicId: "user-002", role: "" },
    });
    const result = await getAdminCurrentUser("tenant_001");
    expect(result).toEqual({ name: "", publicId: "user-002", role: "" });
  });
});

describe("isAdminSessionValid", () => {
  it("空の sessionId に対して false を返す", async () => {
    mockGetSessionId.mockResolvedValueOnce("");
    const result = await isAdminSessionValid("tenant_001");
    expect(result).toBe(false);
  });

  it("有効なユーザーが取得できる場合 true を返す", async () => {
    mockGetMe.mockResolvedValueOnce({
      user: { name: "テスト", publicId: "user-001", role: "admin" },
    });
    const result = await isAdminSessionValid("tenant_001");
    expect(result).toBe(true);
  });

  it("API がエラーをスローした場合に false を返す", async () => {
    mockGetMe.mockRejectedValueOnce(new Error("Unauthorized"));
    const result = await isAdminSessionValid("tenant_001");
    expect(result).toBe(false);
  });
});
