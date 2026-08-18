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

  it("cursor token と limit をそのまま渡し、応答のトークンを返す", async () => {
    mockListCreators.mockResolvedValue({
      creators: [],
      nextToken: "next-page",
      previousToken: "previous-page",
    });

    const { listCreators } = await import("./creator");
    const result = await listCreators("TENANT001", {
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

  it("最初のページは空のトークンで取得する", async () => {
    mockListCreators.mockResolvedValue({ creators: [] });

    const { listCreators } = await import("./creator");
    const result = await listCreators("TENANT001");

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

  it("サーバーのキーセット順を並べ替えずに返す", async () => {
    mockListCreators.mockResolvedValue({
      creators: [
        { name: "ぬ", profileText: "", publicId: "CREATOR002" },
        { name: "あ", profileText: "", publicId: "CREATOR001" },
      ],
    });

    const { listCreators } = await import("./creator");
    const result = await listCreators("TENANT001");

    expect(result.creators.map((item) => item.publicId)).toEqual([
      "CREATOR002",
      "CREATOR001",
    ]);
  });

  it("取得に失敗してもトークンなしの結果を返す", async () => {
    const { Code, ConnectError } = await import("@publira/api-client/errors");
    mockListCreators.mockRejectedValue(
      new ConnectError("upstream down", Code.Unavailable)
    );

    const { listCreators } = await import("./creator");
    const result = await listCreators("TENANT001", { token: "current-page" });

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

  it("一覧を走査せずGetCreatorを1回だけ呼ぶ", async () => {
    mockGetCreator.mockResolvedValue({
      creator: {
        name: "Target",
        profileText: "profile",
        publicId: "CREATOR101",
      },
    });

    const { getCreator } = await import("./creator");
    const result = await getCreator({
      publicId: "CREATOR101",
      tenantId: "TENANT001",
    });

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

  it("セッションがない場合はRPCを呼ばずにエラーを返す", async () => {
    mockGetAccessToken.mockResolvedValue(null);

    const { getCreator } = await import("./creator");
    const result = await getCreator({
      publicId: "CREATOR001",
      tenantId: "TENANT001",
    });

    expect(mockGetCreator).not.toHaveBeenCalled();
    expect(result).toEqual({
      message: "セッションが無効です。再ログインしてください。",
      ok: false,
      requiresSignIn: true,
    });
  });

  // 不在とテナント外はサーバーがどちらも not_found で返すため、区別せず
  // notFound へ落とす。
  it("not_foundが返った場合はnotFoundを返す", async () => {
    const { Code, ConnectError } = await import("@publira/api-client/errors");
    mockGetCreator.mockRejectedValue(
      new ConnectError("creator not found", Code.NotFound)
    );

    const { getCreator } = await import("./creator");
    const result = await getCreator({
      publicId: "MISSING",
      tenantId: "TENANT001",
    });

    expect(result).toEqual({ notFound: true, ok: false });
  });

  it("not_found以外の失敗はメッセージを返す", async () => {
    const { Code, ConnectError } = await import("@publira/api-client/errors");
    mockGetCreator.mockRejectedValue(
      new ConnectError("upstream down", Code.Unavailable)
    );

    const { getCreator } = await import("./creator");
    const result = await getCreator({
      publicId: "CREATOR001",
      tenantId: "TENANT001",
    });

    expect(result.ok).toBe(false);
    expect(result).not.toMatchObject({ notFound: true });
  });

  it("creatorが欠けた応答はエラーとして扱う", async () => {
    mockGetCreator.mockResolvedValue({});

    const { getCreator } = await import("./creator");
    const result = await getCreator({
      publicId: "CREATOR001",
      tenantId: "TENANT001",
    });

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

  it("cursor をたどって101件目以降も含める", async () => {
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
    const result = await listAllCreators("TENANT001");

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

  it("セッションがない場合RPCを呼ばない", async () => {
    mockGetAccessToken.mockResolvedValue(null);

    const { listAllCreators } = await import("./creator");
    const result = await listAllCreators("TENANT001");

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

  it("nextToken が繰り返されたら部分結果を返さない", async () => {
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
    const result = await listAllCreators("TENANT001");

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
