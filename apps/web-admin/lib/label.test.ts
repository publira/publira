import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockCacheTag, mockGetAccessToken, mockGetLabel, mockListLabels } =
  vi.hoisted(() => ({
    mockCacheTag: vi.fn(),
    mockGetAccessToken: vi.fn(),
    mockGetLabel: vi.fn(),
    mockListLabels: vi.fn(),
  }));

vi.mock("next/cache", () => ({
  cacheTag: mockCacheTag,
}));

vi.mock("./session", () => ({
  getAccessToken: mockGetAccessToken,
}));

vi.mock("./api", () => ({
  apiClient: {
    label: {
      getLabel: mockGetLabel,
      listLabels: mockListLabels,
    },
  },
  withSessionHeaders: (sessionId: string) => ({
    headers: { Authorization: `Bearer ${sessionId}` },
  }),
}));

describe("listLabels", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockGetAccessToken.mockResolvedValue("session-token");
  });

  it("cursor token と limit をそのまま渡し、応答のトークンを返す", async () => {
    mockListLabels.mockResolvedValue({
      labels: [],
      nextToken: "next-page",
      previousToken: "previous-page",
    });

    const { listLabels } = await import("./label");
    const result = await listLabels("TENANT001", {
      limit: 20,
      token: "current-page",
    });

    expect(mockListLabels).toHaveBeenCalledWith(
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
    mockListLabels.mockResolvedValue({ labels: [] });

    const { listLabels } = await import("./label");
    const result = await listLabels("TENANT001");

    expect(mockListLabels).toHaveBeenCalledWith(
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
    mockListLabels.mockResolvedValue({
      labels: [
        { name: "ぬ", publicId: "LABEL002" },
        { name: "あ", publicId: "LABEL001" },
      ],
    });

    const { listLabels } = await import("./label");
    const result = await listLabels("TENANT001");

    expect(result.labels.map((item) => item.publicId)).toEqual([
      "LABEL002",
      "LABEL001",
    ]);
  });

  it("取得に失敗してもトークンなしの結果を返す", async () => {
    const { Code, ConnectError } = await import("@publira/api-client/errors");
    mockListLabels.mockRejectedValue(
      new ConnectError("upstream down", Code.Unavailable)
    );

    const { listLabels } = await import("./label");
    const result = await listLabels("TENANT001", { token: "current-page" });

    expect(result).toMatchObject({
      labels: [],
      nextToken: "",
      ok: false,
      previousToken: "",
    });
  });
});

describe("getLabel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockGetAccessToken.mockResolvedValue("session-token");
  });

  it("一覧を走査せずGetLabelを1回だけ呼ぶ", async () => {
    mockGetLabel.mockResolvedValue({
      label: {
        eyeCatchImageUpdatedAt: "2026-01-02T03:04:05Z",
        eyeCatchImageVariants: [
          {
            contentType: "image/webp",
            fileSizeBytes: 2048,
            height: 512,
            label: "md",
            url: "/images/labels/img/square/512",
            variantType: "square",
            width: 512,
          },
        ],
        name: "Target",
        publicId: "LABEL101",
      },
    });

    const { getLabel } = await import("./label");
    const result = await getLabel({
      publicId: "LABEL101",
      tenantId: "TENANT001",
    });

    expect(mockGetLabel).toHaveBeenCalledExactlyOnceWith(
      {
        publicId: "LABEL101",
        tenant: { tenantId: "TENANT001" },
      },
      { headers: { Authorization: "Bearer session-token" } }
    );
    expect(mockListLabels).not.toHaveBeenCalled();
    expect(result).toEqual({
      label: {
        eyeCatchImageUpdatedAt: "2026-01-02T03:04:05Z",
        eyeCatchImageVariants: [
          {
            contentType: "image/webp",
            fileSizeBytes: 2048,
            height: 512,
            label: "md",
            url: "/images/labels/img/square/512",
            variantType: "square",
            width: 512,
          },
        ],
        name: "Target",
        publicId: "LABEL101",
      },
      ok: true,
    });
  });

  it("セッションがない場合はRPCを呼ばずにエラーを返す", async () => {
    mockGetAccessToken.mockResolvedValue(null);

    const { getLabel } = await import("./label");
    const result = await getLabel({
      publicId: "LABEL001",
      tenantId: "TENANT001",
    });

    expect(mockGetLabel).not.toHaveBeenCalled();
    expect(result).toEqual({
      message: "セッションが無効です。再ログインしてください。",
      ok: false,
    });
  });

  // 不在とテナント外はサーバーがどちらも not_found で返すため、区別せず
  // notFound へ落とす。
  it("not_foundが返った場合はnotFoundを返す", async () => {
    const { Code, ConnectError } = await import("@publira/api-client/errors");
    mockGetLabel.mockRejectedValue(
      new ConnectError("label not found", Code.NotFound)
    );

    const { getLabel } = await import("./label");
    const result = await getLabel({
      publicId: "MISSING",
      tenantId: "TENANT001",
    });

    expect(result).toEqual({ notFound: true, ok: false });
  });

  it("not_found以外の失敗はメッセージを返す", async () => {
    const { Code, ConnectError } = await import("@publira/api-client/errors");
    mockGetLabel.mockRejectedValue(
      new ConnectError("upstream down", Code.Unavailable)
    );

    const { getLabel } = await import("./label");
    const result = await getLabel({
      publicId: "LABEL001",
      tenantId: "TENANT001",
    });

    expect(result.ok).toBe(false);
    expect(result).not.toMatchObject({ notFound: true });
  });

  it("labelが欠けた応答はエラーとして扱う", async () => {
    mockGetLabel.mockResolvedValue({});

    const { getLabel } = await import("./label");
    const result = await getLabel({
      publicId: "LABEL001",
      tenantId: "TENANT001",
    });

    expect(result).toEqual({
      message:
        "レーベル一覧の取得に失敗しました。時間をおいて再試行してください。",
      ok: false,
    });
  });
});

describe("listAllLabels", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockGetAccessToken.mockResolvedValue("session-token");
  });

  it("cursor をたどって101件目以降も含める", async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) => ({
      name: `Label ${String(index + 1).padStart(3, "0")}`,
      publicId: `LABEL${String(index + 1).padStart(3, "0")}`,
    }));
    mockListLabels
      .mockResolvedValueOnce({
        labels: firstPage,
        nextToken: "page-2",
      })
      .mockResolvedValueOnce({
        labels: [
          { name: "Zebra", publicId: "LABEL101" },
          { name: "Alpha", publicId: "LABEL102" },
        ],
        nextToken: "",
      });

    const { listAllLabels } = await import("./label");
    const result = await listAllLabels("TENANT001");

    expect(mockListLabels).toHaveBeenNthCalledWith(
      1,
      {
        limit: 100,
        tenant: { tenantId: "TENANT001" },
        token: "",
      },
      { headers: { Authorization: "Bearer session-token" } }
    );
    expect(mockListLabels).toHaveBeenNthCalledWith(
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
    expect(result.labels).toHaveLength(102);
    expect(result.labels.at(0)?.publicId).toBe("LABEL102");
    expect(result.labels.at(-1)?.publicId).toBe("LABEL101");
    expect(result.labels.some((label) => label.publicId === "LABEL101")).toBe(
      true
    );
  });

  it("セッションがない場合RPCを呼ばない", async () => {
    mockGetAccessToken.mockResolvedValue(null);

    const { listAllLabels } = await import("./label");
    const result = await listAllLabels("TENANT001");

    expect(mockListLabels).not.toHaveBeenCalled();
    expect(result).toEqual({
      labels: [],
      message: "セッションが無効です。再ログインしてください。",
      nextToken: "",
      ok: false,
      previousToken: "",
    });
  });

  it("nextToken が繰り返されたら部分結果を返さない", async () => {
    mockListLabels
      .mockResolvedValueOnce({
        labels: Array.from({ length: 100 }, (_, index) => ({
          name: `Label ${index + 1}`,
          publicId: `LABEL${String(index + 1).padStart(3, "0")}`,
        })),
        nextToken: "page-2",
      })
      .mockResolvedValueOnce({
        labels: [{ name: "Partial", publicId: "LABEL101" }],
        nextToken: "page-2",
      });

    const { listAllLabels } = await import("./label");
    const result = await listAllLabels("TENANT001");

    expect(mockListLabels).toHaveBeenCalledTimes(2);
    expect(result).toEqual({
      labels: [],
      message:
        "レーベル一覧の取得に失敗しました。時間をおいて再試行してください。",
      nextToken: "",
      ok: false,
      previousToken: "",
    });
  });
});
