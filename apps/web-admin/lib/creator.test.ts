import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockCacheTag, mockGetAccessToken, mockGetCreator, mockListCreators } =
  vi.hoisted(() => ({
    mockCacheTag: vi.fn(),
    mockGetAccessToken: vi.fn(),
    mockGetCreator: vi.fn(),
    mockListCreators: vi.fn(),
  }));

vi.mock("next/cache", () => ({
  cacheTag: mockCacheTag,
}));

vi.mock("./session", () => ({
  getAccessToken: mockGetAccessToken,
}));

vi.mock("./api", () => ({
  apiClient: {
    creator: {
      getCreator: mockGetCreator,
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

describe("listCreators", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockGetAccessToken.mockResolvedValue("session-token");
  });

  it("passes the cursor token and the limit through and returns the tokens of the response", async () => {
    mockListCreators.mockResolvedValue({
      creators: [],
      nextToken: "next-page",
      previousToken: "previous-page",
    });

    const { listCreators } = await import("./creator");
    const result = await listCreators("TENANT001", "ja", {
      limit: 20,
      token: "current-page",
    });

    expect(mockListCreators).toHaveBeenCalledWith(
      {
        limit: 20,
        tenant: { tenantId: "TENANT001" },
        token: "current-page",
      },
      { headers: { Authorization: "Bearer session-token" } }
    );
    expect(result).toMatchObject({
      nextToken: "next-page",
      ok: true,
      previousToken: "previous-page",
    });
  });

  it("fetches the first page with an empty token", async () => {
    mockListCreators.mockResolvedValue({ creators: [] });

    const { listCreators } = await import("./creator");
    const result = await listCreators("TENANT001", "ja", {});

    expect(mockListCreators).toHaveBeenCalledWith(
      {
        limit: 20,
        tenant: { tenantId: "TENANT001" },
        token: "",
      },
      { headers: { Authorization: "Bearer session-token" } }
    );
    // トークン未指定の応答でも、呼び出し側が分岐せずに済むよう空文字へそろえる。
    expect(result).toMatchObject({
      nextToken: "",
      ok: true,
      previousToken: "",
    });
  });

  it("returns the keyset order of the server without re-sorting it", async () => {
    mockListCreators.mockResolvedValue({
      creators: [
        { name: "ぬ", profileText: "", publicId: "CREATOR002" },
        { name: "あ", profileText: "", publicId: "CREATOR001" },
      ],
    });

    const { listCreators } = await import("./creator");
    const result = await listCreators("TENANT001", "ja", {});

    expect(result.creators.map((item) => item.publicId)).toEqual([
      "CREATOR002",
      "CREATOR001",
    ]);
  });

  it("returns a result with no token when the fetch fails", async () => {
    const { Code, ConnectError } = await import("@publira/api-client/errors");
    mockListCreators.mockRejectedValue(
      new ConnectError("upstream down", Code.Unavailable)
    );

    const { listCreators } = await import("./creator");
    const result = await listCreators("TENANT001", "ja", {
      token: "current-page",
    });

    expect(result).toMatchObject({
      creators: [],
      nextToken: "",
      ok: false,
      previousToken: "",
    });
  });
});

describe("getCreator", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockGetAccessToken.mockResolvedValue("session-token");
  });

  it("calls GetCreator once instead of walking the list", async () => {
    mockGetCreator.mockResolvedValue({
      creator: {
        name: "Target",
        profileText: "profile",
        publicId: "CREATOR101",
      },
    });

    const { getCreator } = await import("./creator");
    const result = await getCreator(
      {
        publicId: "CREATOR101",
        tenantId: "TENANT001",
      },
      "ja"
    );

    expect(mockGetCreator).toHaveBeenCalledExactlyOnceWith(
      {
        publicId: "CREATOR101",
        tenant: { tenantId: "TENANT001" },
      },
      { headers: { Authorization: "Bearer session-token" } }
    );
    expect(mockListCreators).not.toHaveBeenCalled();
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

  it("returns an error without calling the RPC when there is no session", async () => {
    mockGetAccessToken.mockResolvedValue(null);

    const { getCreator } = await import("./creator");
    const result = await getCreator(
      {
        publicId: "CREATOR001",
        tenantId: "TENANT001",
      },
      "ja"
    );

    expect(mockGetCreator).not.toHaveBeenCalled();
    expect(result).toEqual({
      message: "セッションが無効です。再ログインしてください。",
      ok: false,
      requiresSignIn: true,
    });
  });

  // 不在とテナント外はサーバーがどちらも not_found で返すため、区別せず
  // notFound へ落とす。
  it("returns notFound when the RPC answers not_found", async () => {
    const { Code, ConnectError } = await import("@publira/api-client/errors");
    mockGetCreator.mockRejectedValue(
      new ConnectError("creator not found", Code.NotFound)
    );

    const { getCreator } = await import("./creator");
    const result = await getCreator(
      {
        publicId: "MISSING",
        tenantId: "TENANT001",
      },
      "ja"
    );

    expect(result).toEqual({ notFound: true, ok: false });
  });

  it("returns a message for a failure other than not_found", async () => {
    const { Code, ConnectError } = await import("@publira/api-client/errors");
    mockGetCreator.mockRejectedValue(
      new ConnectError("upstream down", Code.Unavailable)
    );

    const { getCreator } = await import("./creator");
    const result = await getCreator(
      {
        publicId: "CREATOR001",
        tenantId: "TENANT001",
      },
      "ja"
    );

    expect(result.ok).toBe(false);
    expect(result).not.toMatchObject({ notFound: true });
  });

  it("treats a response with no creator as an error", async () => {
    mockGetCreator.mockResolvedValue({});

    const { getCreator } = await import("./creator");
    const result = await getCreator(
      {
        publicId: "CREATOR001",
        tenantId: "TENANT001",
      },
      "ja"
    );

    expect(result).toEqual({
      message: "著者一覧の取得に失敗しました。時間をおいて再試行してください。",
      ok: false,
    });
  });
});

describe("listAllCreators", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockGetAccessToken.mockResolvedValue("session-token");
  });

  it("follows the cursor to include the hundred-and-first entry onwards", async () => {
    mockListCreators
      .mockResolvedValueOnce({
        creators: creatorPage(100),
        nextToken: "page-2",
      })
      .mockResolvedValueOnce({
        creators: [
          { name: "Zebra", profileText: "", publicId: "CREATOR101" },
          { name: "Alpha", profileText: "", publicId: "CREATOR102" },
        ],
        nextToken: "",
      });

    const { listAllCreators } = await import("./creator");
    const result = await listAllCreators("TENANT001", "ja");

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
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.creators).toHaveLength(102);
    expect(result.creators.at(0)?.publicId).toBe("CREATOR102");
    expect(result.creators.at(-1)?.publicId).toBe("CREATOR101");
    expect(
      result.creators.some((creator) => creator.publicId === "CREATOR101")
    ).toBe(true);
  });

  it("does not call the RPC when there is no session", async () => {
    mockGetAccessToken.mockResolvedValue(null);

    const { listAllCreators } = await import("./creator");
    const result = await listAllCreators("TENANT001", "ja");

    expect(mockListCreators).not.toHaveBeenCalled();
    expect(result).toEqual({
      creators: [],
      message: "セッションが無効です。再ログインしてください。",
      nextToken: "",
      ok: false,
      previousToken: "",
      requiresSignIn: true,
    });
  });

  it("returns no partial result when nextToken repeats itself", async () => {
    mockListCreators
      .mockResolvedValueOnce({
        creators: creatorPage(100),
        nextToken: "page-2",
      })
      .mockResolvedValueOnce({
        creators: [
          { name: "Partial", profileText: "", publicId: "CREATOR101" },
        ],
        nextToken: "page-2",
      });

    const { listAllCreators } = await import("./creator");
    const result = await listAllCreators("TENANT001", "ja");

    expect(mockListCreators).toHaveBeenCalledTimes(2);
    expect(result).toEqual({
      creators: [],
      message: "著者一覧の取得に失敗しました。時間をおいて再試行してください。",
      nextToken: "",
      ok: false,
      previousToken: "",
      requiresSignIn: false,
    });
  });
});
