import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockCreateSession,
  mockDeleteSession,
  mockGetMe,
  mockResolveSessionId,
} = vi.hoisted(() => ({
  mockCreateSession: vi.fn(),
  mockDeleteSession: vi.fn(),
  mockGetMe: vi.fn(),
  mockResolveSessionId: vi.fn(),
}));

vi.mock("./api-client", () => ({
  apiClient: {
    auth: {
      createSession: mockCreateSession,
      deleteSession: mockDeleteSession,
      getMe: mockGetMe,
    },
  },
  buildSessionHeaders: (sessionId: string) => ({
    headers: { "X-Publira-Session-Id": sessionId },
  }),
  resolveSessionId: mockResolveSessionId,
}));

const importAuth = () => import("./auth");

describe("web-public auth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveSessionId.mockResolvedValue("sid_001");
  });

  it("loginPublic: セッション情報が欠けると null を返す", async () => {
    const { loginPublic } = await importAuth();
    mockCreateSession.mockResolvedValueOnce({
      session: { sessionId: "sid_001" },
    });

    await expect(loginPublic("a@b.com", "pw")).resolves.toBeNull();
  });

  it("loginPublic: expected error は null を返す", async () => {
    const { loginPublic } = await importAuth();
    mockCreateSession.mockRejectedValueOnce(new Error("unauthenticated"));

    await expect(loginPublic("a@b.com", "pw")).resolves.toBeNull();
  });

  it("logoutPublic: sessionId 空なら API を呼ばない", async () => {
    const { logoutPublic } = await importAuth();
    await logoutPublic("   ");

    expect(mockDeleteSession).not.toHaveBeenCalled();
  });

  it("getPublicCurrentUser: session 解決不可なら null", async () => {
    const { getPublicCurrentUser } = await importAuth();
    mockResolveSessionId.mockResolvedValueOnce("");

    await expect(getPublicCurrentUser()).resolves.toBeNull();
    expect(mockGetMe).not.toHaveBeenCalled();
  });

  it("getPublicCurrentUser: expected error は null", async () => {
    const { getPublicCurrentUser } = await importAuth();
    mockGetMe.mockRejectedValueOnce(new Error("permission_denied"));

    await expect(getPublicCurrentUser()).resolves.toBeNull();
  });

  it("getPublicCurrentUser: 正常時はユーザー情報を返す", async () => {
    const { getPublicCurrentUser } = await importAuth();
    mockGetMe.mockResolvedValueOnce({
      user: { name: "Alice", publicId: "U001" },
    });

    await expect(getPublicCurrentUser()).resolves.toEqual({
      name: "Alice",
      publicId: "U001",
    });
  });
});
