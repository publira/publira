import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockCacheTag, mockGetAccessToken, mockListCreators } = vi.hoisted(
  () => ({
    mockCacheTag: vi.fn(),
    mockGetAccessToken: vi.fn(),
    mockListCreators: vi.fn(),
  })
);

vi.mock("next/cache", () => ({
  cacheTag: mockCacheTag,
}));

vi.mock("./session", () => ({
  getAccessToken: mockGetAccessToken,
}));

vi.mock("./api", () => ({
  apiClient: {
    creator: {
      listCreators: mockListCreators,
    },
  },
  withSessionHeaders: (sessionId: string) => ({
    headers: { Authorization: `Bearer ${sessionId}` },
  }),
}));

const creatorPage = (count: number) =>
  Array.from({ length: count }, (_, index) => ({
    name: `Creator ${index + 1}`,
    profileText: "",
    publicId: `CREATOR${String(index + 1).padStart(3, "0")}`,
  }));

describe("creator lib", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockGetAccessToken.mockResolvedValue("session-token");
  });

  it("cursor をたどって101件目の著者を取得する", async () => {
    mockListCreators
      .mockResolvedValueOnce({
        creators: creatorPage(100),
        nextToken: "page-2",
      })
      .mockResolvedValueOnce({
        creators: [
          { name: "Target", profileText: "profile", publicId: "CREATOR101" },
        ],
        nextToken: "",
      });

    const { getCreator } = await import("./creator");
    const result = await getCreator({
      publicId: "CREATOR101",
      tenantId: "TENANT001",
    });

    expect(mockListCreators).toHaveBeenNthCalledWith(
      1,
      {
        limit: 100,
        tenant: { tenantId: "TENANT001" },
        token: "",
      },
      { headers: { Authorization: "Bearer session-token" } }
    );
    expect(mockListCreators).toHaveBeenNthCalledWith(
      2,
      {
        limit: 100,
        tenant: { tenantId: "TENANT001" },
        token: "page-2",
      },
      { headers: { Authorization: "Bearer session-token" } }
    );
    expect(result).toEqual({
      creator: {
        iconImageFileSizeBytes: 0,
        iconImageUpdatedAt: "",
        iconImageUrl: "",
        name: "Target",
        profileText: "profile",
        publicId: "CREATOR101",
      },
      ok: true,
    });
  });

  it("セッションがない場合はRPCを呼ばずにエラーを返す", async () => {
    mockGetAccessToken.mockResolvedValue(null);

    const { getCreator } = await import("./creator");
    const result = await getCreator({
      publicId: "CREATOR001",
      tenantId: "TENANT001",
    });

    expect(mockListCreators).not.toHaveBeenCalled();
    expect(result).toEqual({
      message: "セッションが無効です。再ログインしてください。",
      ok: false,
    });
  });

  it("全ページに一致する著者がなければnotFoundを返す", async () => {
    mockListCreators
      .mockResolvedValueOnce({
        creators: creatorPage(100),
        nextToken: "page-2",
      })
      .mockResolvedValueOnce({
        creators: [],
        nextToken: "",
      });

    const { getCreator } = await import("./creator");
    const result = await getCreator({
      publicId: "MISSING",
      tenantId: "TENANT001",
    });

    expect(mockListCreators).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ notFound: true, ok: false });
  });

  it("同じnextTokenが返された場合はページ走査を停止する", async () => {
    mockListCreators
      .mockResolvedValueOnce({
        creators: creatorPage(100),
        nextToken: "page-2",
      })
      .mockResolvedValueOnce({
        creators: [],
        nextToken: "page-2",
      });

    const { getCreator } = await import("./creator");
    const result = await getCreator({
      publicId: "MISSING",
      tenantId: "TENANT001",
    });

    expect(mockListCreators).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ notFound: true, ok: false });
  });
});
